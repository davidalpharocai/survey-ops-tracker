import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProject, isActiveOperational, getMe } from './data'
import { stageDurations } from '@/lib/utils/stageTiming'
import { isKnownSalesperson, ALL_SALESPERSON_VALUES } from '@/lib/utils/salespeople'

// Data-integrity + pipeline-throughput reads for the connector. All read-only.
//   - reconcileProject: cross-field consistency for one project
//   - dataHealth: portfolio-wide anomaly scan (bulk, no N+1)
//   - pipelineThroughput: per-stage cycle time / WIP / aging from project_stage_history
//
// The canonical spend formula (recompute_project_spend, migration 060 + the third
// term added by 080 + the blast coalesce in 091 + the SEND term in 095) is
//   actual_spend = Σ(coalesce(blast.bid,0) × coalesce(blast.completes,0))
//                + Σ(coalesce(blast.people,0) × coalesce(blast.cost_per_send,0))
//                + Σ(supplier.cpi × supplier.n_collected)
//                + Σ(cost.amount)
// so a stored actual_spend that disagrees means the recompute trigger didn't fire.
// `num()` below coalesces the same way, so check 1 still reconciles exactly once
// blast figures can be NULL — and that is precisely why an unrecorded blast needs
// its OWN check (7): check 1 sees stored and computed agree, both at $0, and
// reports the project as perfectly consistent while its real cost is unknown.
// This MUST stay in lockstep with the SQL: when 060 added the blast term, one read
// that hadn't been updated with it reported $0 spend on every blast project until a
// hotfix. Here the failure is louder still — a missing term makes the integrity
// checker itself accuse a perfectly-consistent project of a trigger failure.

type Row = Record<string, unknown>
type SupRow = { cpi: number | null; n_collected: number | null }
/** `blast_at` is here for check 7 (how long a blast has been waiting for its
 *  completes). It must also be named in BOTH explicit selects below — an
 *  explicit select that omits a column buildChecks reads does NOT error, it
 *  just leaves the value undefined and the check silently never fires. That
 *  mistake has been made in this file before; see the note on `salesperson`. */
type BlastRow = {
  bid: number | null; completes: number | null; blast_at: string | null
  /** 095: a blast's SEND cost is people x cost_per_send, independent of the
   *  reward. Both columns must stay named in BOTH selects below -- an omitted
   *  column does not error here, it just leaves the value undefined and the
   *  check silently never fires. */
  people: number | null; cost_per_send: number | null
}
/** `kind` is here for check 9 (the send-cost double count) and must stay named in
 *  fetchCosts' select below — an omitted column does not error, it just leaves
 *  the value undefined and the check silently never fires. */
type CostRow = { amount: number | null; kind: string | null }
type SegRow = { n_target: number | null; n_collected: number | null; n_actual: number | null }

const num = (v: unknown): number => (v == null ? 0 : Number(v))

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export interface Check {
  check: string
  ok: boolean
  /** advisory checks (expected to differ in normal operation) don't count as "issues". */
  advisory: boolean
  detail: string
  expected?: number | string | null
  actual?: number | string | null
}

/** The consistency checks for one project, given its child rows. Pure — no I/O —
 *  so reconcileProject and dataHealth share exactly one definition. */
function buildChecks(p: Row, sup: SupRow[], blasts: BlastRow[], costs: CostRow[], segs: SegRow[]): Check[] {
  const checks: Check[] = []

  // 1) actual_spend vs the canonical recompute formula — only when there's a
  //    supplier/blast/cost source to reconcile against. A stored spend with NO source
  //    rows is legacy ($/bid model, pre-054) or manual, not a trigger failure, so it's
  //    an advisory, not a false "issue". Cost lines are a source like any other: leave
  //    them out of the gate and a costs-only project gets told its money is
  //    "not reconcilable against the current model" when in fact it reconciles exactly.
  const supSpend = sup.reduce((s, r) => s + num(r.cpi) * num(r.n_collected), 0)
  // 095: a blast costs a reward AND a send. This expression is a hand-copy of
  // recompute_project_spend and its whole job is to agree with the SQL to the
  // cent — omitting the send term here would have reported EVERY blast project
  // as having a broken recompute trigger, because the stored spend would be
  // higher than this by exactly the send cost (which was $4,096 across the
  // portfolio on 2026-09-01 and $9,074 a day later — hence a dated figure
  // rather than a bare one).
  // coalesce-to-0 on both, matching the SQL's treatment of an unrecorded figure.
  const blastSpend = blasts.reduce(
    (s, r) => s + num(r.bid) * num(r.completes) + num(r.people) * num(r.cost_per_send),
    0
  )
  const costSpend = costs.reduce((s, r) => s + num(r.amount), 0)
  const expectedSpend = Math.round(supSpend + blastSpend + costSpend)
  const actualSpend = Math.round(num(p.actual_spend))
  if (sup.length || blasts.length || costs.length) {
    const ok = Math.abs(expectedSpend - actualSpend) <= 1
    checks.push({
      check: 'spend', ok, advisory: false, expected: expectedSpend, actual: actualSpend,
      detail: ok
        ? 'actual_spend matches Σ(cpi×collected)+Σ(bid×completes)+Σ(people×$/send)+Σ(cost amount)'
        : `stored actual_spend $${actualSpend.toLocaleString('en-US')} ≠ computed $${expectedSpend.toLocaleString('en-US')} — the recompute trigger may not have fired`,
    })
  } else if (num(p.actual_spend) > 0) {
    checks.push({
      check: 'spend_no_source', ok: false, advisory: true, actual: actualSpend,
      detail: `actual_spend $${actualSpend.toLocaleString('en-US')} recorded with no supplier/blast/cost rows — legacy ($/bid) or manual spend, not reconcilable against the current model`,
    })
  }

  // 2) Segment totals must equal the project totals (a trigger keeps them synced,
  //    so a mismatch is real drift). Only for segmented projects.
  if (segs.length) {
    // The sync trigger sets project.n_target = sum(segment n_target), which is NULL
    // when every segment target is NULL. Mirror that exactly (null-aware) so an
    // all-null-segments project with a stale non-null project n_target is still caught.
    {
      const allNull = segs.every(s => s.n_target == null)
      const expectedT: number | null = allNull ? null : segs.reduce((s, r) => s + num(r.n_target), 0)
      const projT: number | null = p.n_target == null ? null : num(p.n_target)
      const ok = expectedT === projT
      checks.push({
        check: 'segments_n_target', ok, advisory: false, expected: expectedT, actual: projT,
        detail: ok
          ? 'segment N targets match the project N target'
          : `expected project n_target ${expectedT ?? 'null'} (sum of segment targets) ≠ stored ${projT ?? 'null'}`,
      })
    }
    const sumC = segs.reduce((s, r) => s + num(r.n_collected), 0)
    const okC = sumC === num(p.n_collected)
    checks.push({
      check: 'segments_n_collected', ok: okC, advisory: false, expected: sumC, actual: num(p.n_collected),
      detail: okC ? 'segment N collected sum to the project N collected' : `Σ segment N collected ${sumC} ≠ project n_collected ${num(p.n_collected)}`,
    })
  }

  // 3) Supplier N collected vs the project's delivered N — ADVISORY: they legitimately
  //    differ (QA attrition between fielded and delivered), so this informs, not fails.
  if (sup.length) {
    const supCollected = sup.reduce((s, r) => s + num(r.n_collected), 0)
    const hasActual = p.n_actual != null
    const projN = hasActual ? num(p.n_actual) : num(p.n_collected)
    const label = hasActual ? 'n_actual' : 'n_collected'
    const ok = supCollected === projN
    checks.push({
      check: 'suppliers_vs_n', ok, advisory: true, expected: supCollected, actual: projN,
      detail: ok ? `supplier N collected matches project ${label}` : `Σ supplier N collected ${supCollected} vs project ${label} ${projN} (advisory — confirm which is authoritative)`,
    })
  }

  // 4) A stored survey-ID discrepancy flag (app vs sheet).
  const disc = p.survey_id_discrepancy
  if (disc != null && String(disc).trim() !== '') {
    checks.push({ check: 'survey_id_discrepancy', ok: false, advisory: false, detail: `survey ID mismatch flagged: ${String(disc)}` })
  }

  // (The old `sheet_stale` advisory lived here. It compared sheet_synced_at against
  //  updated_at, and both of those were only ever written by the SOCC->Surveys
  //  write-back, which is deleted. sheet_synced_at is now frozen at whatever the
  //  July-2026 runs left, so the check could only ever report "sheet copy is behind"
  //  forever — a permanent false alarm. Dropped with the feature.)

  // 5) Date-order sanity: launched after delivered is impossible.
  const launch = p.launch_date as string | null
  const deliver = p.deliver_date as string | null
  if (launch && deliver && launch > deliver) {
    checks.push({ check: 'date_order', ok: false, advisory: false, detail: `launch_date ${launch} is after deliver_date ${deliver}` })
  }

  // 6) The salesperson must be a name this app recognises.
  //
  //    Not cosmetic. `salesperson` is free text and is the ONLY link between a
  //    project and the person who sold it — a scoped sales view resolves the
  //    signed-in account to a canonical name (salespersonForEmail) and filters on
  //    it. A project holding "Jenna" instead of "Jenna Shrove" therefore vanishes
  //    from her own view, with nothing on screen to explain why. Five rows had
  //    drifted that way and were normalised on 2026-08-27; this is what stops it
  //    happening again quietly.
  //
  //    Advisory, because the value is still perfectly readable to a human and
  //    nothing is broken today — it only bites once the sales view ships.
  const sp = p.salesperson as string | null
  if (sp && sp.trim() !== '' && !isKnownSalesperson(sp)) {
    checks.push({
      check: 'salesperson_unknown', ok: false, advisory: true, actual: sp,
      detail: `salesperson "${sp}" is not one of the known names (${ALL_SALESPERSON_VALUES.join(', ')}) — a scoped sales view would not match this project to anyone`,
    })
  }

  // 7) Blast completes that were never logged.
  //
  //    Blast cost is $/bid × completes, so an unrecorded completes count makes a
  //    blast contribute $0 to actual_spend — indistinguishable, in every total
  //    downstream, from a blast that genuinely produced nothing. Check 1 cannot
  //    catch it: the stored spend and the computed spend agree perfectly, both at
  //    the wrong number. That is what makes this its own check rather than a
  //    refinement of the spend one.
  //
  //    Two signals, weakest first:
  //
  //    7a) A blast sent more than 7 days ago with completes still unrecorded.
  //        Completes trickle in for days, so a fresh blast having none is normal
  //        and must not nag — hence ADVISORY and hence the 7-day floor. Only
  //        blasts with a blast_at can be aged; one with no send date at all is
  //        picked up by 7b if it produced anything.
  //
  //    7b) The project collected N while the sum of its blast completes is 0.
  //        Not a heuristic — a PROOF that the completes were never logged, for a
  //        B2B project whose only respondent source is its blasts: the responses
  //        exist, so they came through some blast, so at least one blast's count
  //        is missing. Measured 2026-08-28: 8 of the 12 projects with blasts were
  //        in exactly this state (PR00307 collected 86, PR00309 26 across 6
  //        blasts, PR00363 24, PR00270 34) and all 8 reported $0 blast spend.
  //        A real issue, not advisory.
  if (blasts.length) {
    const DAYS_TO_RECORD = 7
    const cutoff = Date.now() - DAYS_TO_RECORD * 86_400_000
    const stale = blasts.filter(b =>
      b.completes == null && b.blast_at != null && Date.parse(b.blast_at) < cutoff)
    if (stale.length) {
      checks.push({
        check: 'blast_completes_unrecorded', ok: false, advisory: true,
        expected: 0, actual: stale.length,
        detail: `${stale.length} of ${blasts.length} blast(s) went out over ${DAYS_TO_RECORD} days ago with # completes still unrecorded — each contributes $0 of REWARD cost to actual_spend (its send cost still counts), so the project's cost is a floor, not the total`,
      })
    }

    // Sum treats unrecorded as 0 on purpose: this asks "did ANY blast get a
    // count?", and both NULL and 0 answer no. `> 0` guards the direction — a
    // project that collected nothing yet proves nothing about its blasts.
    const blastCompletes = blasts.reduce((s, b) => s + num(b.completes), 0)
    const nCollected = num(p.n_collected)
    // Gated on the blasts being the ONLY respondent source, which is what makes
    // this a proof rather than a guess. A project can legitimately run suppliers
    // AND a blast (OverviewFieldGrid renders both widgets for Rerun and untyped
    // projects), and there the N could have arrived entirely through the
    // suppliers while the blast genuinely returned nothing — a correctly-recorded
    // project that this would otherwise hard-fail. Every project with blasts in
    // production today is blast-only, so the gate changes nothing now; it stops
    // the first mixed-source project being accused.
    const blastIsOnlySource = sup.length === 0
    if (nCollected > 0 && blastCompletes === 0 && blastIsOnlySource) {
      checks.push({
        check: 'blast_completes_missing', ok: false, advisory: false,
        expected: nCollected, actual: 0,
        detail: `project collected ${nCollected.toLocaleString('en-US')} N but its ${blasts.length} blast(s) sum to 0 completes, and blasts are its only respondent source — the completes were never logged, so blast spend reads $0 and the response rate reads 0%`,
      })
    } else if (nCollected > 0 && blastCompletes === 0) {
      checks.push({
        check: 'blast_completes_missing', ok: false, advisory: true,
        expected: nCollected, actual: 0,
        detail: `project collected ${nCollected.toLocaleString('en-US')} N with 0 completes across its ${blasts.length} blast(s). It also has ${sup.length} supplier row(s), so the N may have come from those and the blast may genuinely have returned nothing — advisory rather than an error, but worth confirming the blast completes were not simply missed`,
      })
    }
  }

  // 8) The audience pair (migration 094): total available vs used.
  //
  //    THE REASON THIS LIVES HERE and not in a CHECK constraint: 094 considered
  //    a `used <= size` table constraint and rejected it, because these two
  //    cells save ONE FIELD PER SAVE and the numbers arrive weeks apart — the
  //    team hands over a list, sends happen later — so a hard guard would make
  //    the normal order of work an error. 078 already paid that price for the
  //    n_target range pair. The contradiction still has to surface, so it
  //    surfaces here.
  //
  //    Found in production on 2026-08-31 — SIX rows, all from the era when this
  //    field had one ambiguous label and half the team read it as "the target":
  //      PR00054 size 17  vs 99 collected     PR00075 size 14  vs 120 collected
  //      PR00060 size 1   vs 178 collected    PR00066 size 1   vs 78 collected
  //      PR00101 size 50  vs 442 collected    PR00171 size 300 vs 400 collected
  //    PR00101 is the ONLY row whose audience_size equals its own n_target
  //    exactly (50/50) — the clearest single case of the label being read as
  //    "the target".
  //      (Migration 094's copy of this note says "four" and also names PR00182,
  //       which is 108 vs a target of 110 and so is not an exact match. It was
  //       written before the numbers were checked against the table and is left
  //       alone because the migration is already applied; this is the corrected
  //       count, verified by query.)
  const aSize = p.audience_size == null ? null : Number(p.audience_size)
  const aUsed = p.audience_used == null ? null : Number(p.audience_used)

  // Used above total is a PURE internal contradiction — no second respondent
  // source can explain it away, unlike the n_collected comparison below — so it
  // is a real issue, not advisory.
  if (aSize != null && aUsed != null && aUsed > aSize) {
    checks.push({
      check: 'audience_used_over_total', ok: false, advisory: false,
      expected: aSize, actual: aUsed,
      detail: `audience used ${aUsed.toLocaleString('en-US')} is above the total available ${aSize.toLocaleString('en-US')} — one of the two is wrong, and "contacts still available" reads as a negative number until it is fixed`,
    })
  }

  // ADVISORY, and the gate is the point: more responses than contacts is
  // impossible only if EVERY response came from this audience. A project running
  // suppliers alongside a blast can legitimately exceed its blast list, and
  // check 7 sets the precedent for not hard-failing a mixed-source project. So
  // this reports the arithmetic and names both explanations rather than
  // picking one.
  if (aSize != null && aSize > 0 && num(p.n_collected) > aSize) {
    checks.push({
      check: 'audience_size_below_collected', ok: false, advisory: true,
      expected: num(p.n_collected), actual: aSize,
      detail: `total available audience ${aSize.toLocaleString('en-US')} is below the ${num(p.n_collected).toLocaleString('en-US')} responses collected — either the audience figure is wrong (this field meant two different things before 2026-08-31, and some rows hold the N target instead) or responses came from a source outside it`,
    })
  }

  // ADVISORY: sends have happened and nobody recorded how much of the list they
  // consumed. This is the gap that leaves "send again or buy more contacts"
  // unanswerable — the pool is known, the spend against it is not. Gated on the
  // blast having actually gone out, so a project still being set up is not
  // nagged about a figure that does not exist yet.
  if (aSize != null && aUsed == null && blasts.some(b => b.blast_at != null)) {
    checks.push({
      check: 'audience_used_unrecorded', ok: false, advisory: true,
      expected: aSize, actual: null,
      detail: `${aSize.toLocaleString('en-US')} contacts available and blast(s) already sent, but audience used was never recorded — so how much of the list is left is unknown, and blast reach cannot substitute for it (repeat sends over one list inflate reach: PR00309 reads 95,788 against a pool of 31,545)`,
    })
  }

  // 9) The send cost, recorded twice.
  //
  //    Migration 080 gave project_costs a kind called `sms_email_blast`, which
  //    CostLines described as "the VENDOR SEND FEE, what the sending platform
  //    bills us for the send itself". Migration 095 then started COMPUTING that
  //    same cost as people × cost_per_send on the blast. Two ways to record one
  //    charge — and 095's header ruled project_costs out against the WRONG kind
  //    (contacts_export, from 092) without ever looking at this one.
  //
  //    It was not hypothetical. PR00362 held a hand-computed row of $1,876.70
  //    described "93,835 contacts x $0.02" — the send cost, typed in by a human
  //    before the app could work it out. 095 charged the same sends again and
  //    took the project to $4,228.58, or 141% of a $3,000 budget, when the true
  //    all-in was $2,351.88 and it was NOT over budget.
  //
  //    Nothing else can catch this. Check 1 reconciles actual_spend against the
  //    same formula the trigger uses, so a doubled figure reconciles PERFECTLY:
  //    the money is internally consistent and simply wrong. Hence a check on the
  //    SHAPE of the data rather than its arithmetic.
  //
  //    ADVISORY, because the two CAN legitimately coexist: a fixed platform
  //    charge that does not scale with volume is a real cost and belongs on a
  //    cost line. This reports the overlap and lets a human judge.
  const sendSpend = blasts.reduce((s, b) => s + num(b.people) * num(b.cost_per_send), 0)
  const sendFeeLines = costs.filter(c => c.kind === 'sms_email_blast' && num(c.amount) > 0)
  if (sendSpend > 0 && sendFeeLines.length > 0) {
    const lineTotal = sendFeeLines.reduce((s, c) => s + num(c.amount), 0)
    checks.push({
      check: 'send_cost_double_counted', ok: false, advisory: true,
      expected: Math.round(sendSpend), actual: Math.round(sendSpend + lineTotal),
      detail: `this project computes $${sendSpend.toFixed(2)} of send cost from its blasts AND carries $${lineTotal.toFixed(2)} of hand-entered "SMS/Email Blast" cost line(s) — if that line is the per-message send charge, it is now counted twice and the project's spend is overstated by that much. The app works the per-message cost out from # people × $/send; a cost line should only hold a FIXED platform fee that does not scale with volume.`,
    })
    // 7c) A SENT COUNT that is provably wrong rather than merely absent.
    //
    //     Check 7a/7b do this for completes; there was no equivalent for the
    //     sent count, even though 095 made it a money field. The proof is the
    //     same shape: completes cannot arrive from a send that reached nobody,
    //     so `people = 0` alongside recorded completes is not a result, it is a
    //     figure nobody entered.
    //
    //     Live example this was written from (2026-09-02): PR00375 has two
    //     blasts at people = 0 with 39 and 17 completes. Its send cost therefore
    //     reads $0, and no other check objects.
    //
    //     NULL is handled by the plain-unrecorded arm below rather than here,
    //     because a null sent count on a blast logged minutes ago is normal.
    const provablyUnsentCounted = blasts.filter(
      b => (b.people ?? 0) === 0 && (b.completes ?? 0) > 0
    )
    if (provablyUnsentCounted.length) {
      checks.push({
        check: 'blast_sent_count_missing', ok: false, advisory: false,
        expected: null, actual: 0,
        detail: `${provablyUnsentCounted.length} blast(s) record 0 sent but a non-zero number of completes — nobody can complete a survey they were never sent, so the sent count was never entered. Its send cost ($/send × # people) therefore reads $0 and the completion rate reads as divide-by-zero`,
      })
    }

    // 7d) A sent count simply not recorded yet, on a blast old enough that it
    //     should be. Mirrors 7a's shape and cutoff for completes.
    const staleSend = blasts.filter(
      b => b.people == null && b.blast_at != null && Date.parse(b.blast_at) < Date.now() - 7 * 86_400_000
    )
    if (staleSend.length) {
      checks.push({
        check: 'blast_sent_count_unrecorded', ok: false, advisory: true,
        expected: 0, actual: staleSend.length,
        detail: `${staleSend.length} of ${blasts.length} blast(s) went out over 7 days ago with the sent count still unrecorded — each contributes $0 of send cost, so the project's spend is a floor`,
      })
    }
  }

  return checks
}

/** The flat vendor cost lines for one or many projects (migration 080). Read through an
 *  UNTYPED handle, with the failure swallowed, deliberately on both counts:
 *   - David applies the SQL BY HAND, hours or days after the code deploys, so there is a
 *     window in which project_costs doesn't exist. inChunks throws on error and neither
 *     caller catches, so an untolerated read would 500 data_health AND reconcile_project
 *     for everyone until the migration lands. Same trade as lib/auth/capabilities.ts:
 *     swallow it and answer "no cost lines". Nothing is actually lost in that window —
 *     with no table there are no cost rows, so the pre-080 two-term formula is still the
 *     correct expectation. (A swallowed failure for any OTHER reason would under-count
 *     the expected spend, so it's logged rather than silent; the sibling reads in the
 *     same Promise.all share fate with a real outage anyway, and this is a re-runnable
 *     read-only report.)
 *  The table IS in the Database type now (added when 078 landed), so this reads through
 *  the normal typed client — only the failure tolerance above is still deliberate. */
async function fetchCosts(
  supabase: ReturnType<typeof createAdminClient>,
  projectIds: string[],
): Promise<(CostRow & { project_id: string })[]> {
  try {
    return await inChunks<CostRow & { project_id: string }>(
      projectIds,
      c => supabase.from('project_costs').select('project_id, amount, kind').in('project_id', c),
    )
  } catch (err) {
    console.error('[health] project_costs read failed — treating as no cost lines:', err)
    return []
  }
}

/** Full consistency report for one project (all checks + the failing subset). */
export async function reconcileProject(projectRef: string) {
  const resolved = await resolveProject(projectRef)
  if (resolved === null) return { error: `No project found matching "${projectRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
  }
  const p = resolved as Row
  const pid = p.id as string
  const supabase = createAdminClient()
  const [supRes, blastRes, costRows, segRes] = await Promise.all([
    supabase.from('project_suppliers').select('cpi, n_collected').eq('project_id', pid),
    supabase.from('project_blasts').select('bid, completes, people, cost_per_send, blast_at').eq('project_id', pid),
    fetchCosts(supabase, [pid]),
    supabase.from('project_segments').select('n_target, n_collected, n_actual').eq('project_id', pid),
  ])
  const checks = buildChecks(
    p,
    (supRes.data ?? []) as unknown as SupRow[],
    (blastRes.data ?? []) as unknown as BlastRow[],
    costRows,
    (segRes.data ?? []) as unknown as SegRow[],
  )
  const issues = checks.filter(c => !c.ok && !c.advisory)
  const advisories = checks.filter(c => !c.ok && c.advisory)
  return {
    project_code: p.project_code as string | null,
    project_name: p.project_name as string,
    ok: issues.length === 0,
    issues, advisories, checks,
    summary: issues.length === 0
      ? (advisories.length ? `No integrity issues; ${advisories.length} advisory note(s).` : 'No data-integrity issues found.')
      : `${issues.length} issue(s): ${issues.map(i => i.check).join(', ')}${advisories.length ? ` (+${advisories.length} advisory)` : ''}.`,
  }
}

function groupByProject<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const a = m.get(r.project_id) ?? []
    a.push(r)
    m.set(r.project_id, a)
  }
  return m
}

/** Run a `.in('project_id', chunk)` query in batches and concatenate. A single IN
 *  over the whole portfolio can blow the PostgREST GET URL length (HTTP 414); 100
 *  UUIDs/batch keeps every request well under the limit no matter how large the set. */
async function inChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const CHUNK = 100
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await run(ids.slice(i, i + CHUNK))
    if (error) throw new Error(String((error as { message?: string } | null)?.message ?? error))
    out.push(...((data ?? []) as unknown as T[]))
  }
  return out
}

/** Portfolio anomaly scan. Bulk-loads children (no N+1) and runs buildChecks over
 *  every project. Defaults to the active operational set; active_only:false widens
 *  to all non-deleted, non-internal projects. */
export async function dataHealth(args: { active_only?: boolean; limit?: number } = {}) {
  const supabase = createAdminClient()
  const { data: projData, error } = await supabase.from('survey_projects')
    // `salesperson` rides along for check 6. An explicit select that omits a column
    // buildChecks reads does not error — `p.salesperson` is simply undefined and the
    // check silently never fires, which is the quietest way for an integrity checker
    // to stop checking something.
    .select('id, project_code, project_name, status, phase, board_column, n_target, n_collected, n_actual, actual_spend, survey_id_discrepancy, launch_date, deliver_date, salesperson, audience_size, audience_used')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (error) throw error
  let projects = (projData ?? []) as unknown as Row[]
  const activeOnly = args.active_only ?? true
  if (activeOnly) projects = projects.filter(isActiveOperational)
  const ids = projects.map(p => p.id as string)
  if (ids.length === 0) return { scanned: 0, with_issues: 0, counts_by_check: {}, advisory_counts: {}, projects: [], summary: 'No projects to scan.' }

  const [supRows, blastRows, costRows, segRows] = await Promise.all([
    inChunks<SupRow & { project_id: string }>(ids, c => supabase.from('project_suppliers').select('project_id, cpi, n_collected').in('project_id', c)),
    inChunks<BlastRow & { project_id: string }>(ids, c => supabase.from('project_blasts').select('project_id, bid, completes, people, cost_per_send, blast_at').in('project_id', c)),
    fetchCosts(supabase, ids),
    inChunks<SegRow & { project_id: string }>(ids, c => supabase.from('project_segments').select('project_id, n_target, n_collected, n_actual').in('project_id', c)),
  ])
  const supMap = groupByProject(supRows)
  const blastMap = groupByProject(blastRows)
  const costMap = groupByProject(costRows)
  const segMap = groupByProject(segRows)

  const countsByCheck: Record<string, number> = {}
  const advisoryCounts: Record<string, number> = {}
  const flagged: { project_code: unknown; project_name: unknown; issues: { check: string; detail: string }[] }[] = []
  for (const p of projects) {
    const pid = p.id as string
    const checks = buildChecks(p, supMap.get(pid) ?? [], blastMap.get(pid) ?? [], costMap.get(pid) ?? [], segMap.get(pid) ?? [])
    const issues = checks.filter(c => !c.ok && !c.advisory)
    for (const a of checks.filter(c => !c.ok && c.advisory)) advisoryCounts[a.check] = (advisoryCounts[a.check] ?? 0) + 1
    if (issues.length) {
      for (const i of issues) countsByCheck[i.check] = (countsByCheck[i.check] ?? 0) + 1
      flagged.push({ project_code: p.project_code, project_name: p.project_name, issues: issues.map(i => ({ check: i.check, detail: i.detail })) })
    }
  }
  flagged.sort((a, b) => b.issues.length - a.issues.length)
  const limit = Math.min(args.limit ?? 50, 200)
  const shown = flagged.slice(0, limit)
  // SALES SCOPING DRIFT — a system-level check, not a per-project one.
  //
  // Two lists name salespeople, on purpose and with different jobs: the
  // `salespeople` TABLE (093) is what RLS resolves a signed-in account through,
  // and SALESPEOPLE in lib/utils/salespeople.ts is what the project dropdown
  // offers. They must agree, and nothing structural forces them to.
  //
  // The failure is silent and one-directional: add someone to the dropdown but
  // not the table, projects get assigned to them, and when they sign in RLS
  // matches nothing — they see an empty pipeline with no error. That is
  // indistinguishable from having no work, so it would be reported as "the tool
  // is broken" rather than "a row is missing". Cheap to detect, so detect it.
  //
  // Read through an untyped handle with the failure swallowed: David applies
  // migrations by hand, so there is a window where `salespeople` does not exist
  // yet, and data_health must not start failing because of a check about a table
  // that has not been created.
  let salesDrift: string[] = []
  try {
    const { data: spRows } = await (supabase as unknown as {
      from: (t: string) => { select: (c: string) => Promise<{ data: { canonical_name: string; active: boolean }[] | null }> }
    }).from('salespeople').select('canonical_name, active')
    if (spRows) {
      const inTable = new Set(spRows.map(r => r.canonical_name))
      const missing = ALL_SALESPERSON_VALUES
        .filter(n => n !== 'Internal' && !inTable.has(n))
      if (missing.length) {
        salesDrift = missing.map(n =>
          `${n} can be set as a project's salesperson but has no row in the salespeople table — if they sign in, RLS will match none of their projects and they will see an empty pipeline`)
      }
    }
  } catch {
    // salespeople table not there yet (093 unapplied). Nothing to report.
  }

  return {
    scanned: projects.length,
    with_issues: flagged.length,
    counts_by_check: countsByCheck,
    advisory_counts: advisoryCounts,
    projects: shown,
    truncated: flagged.length > shown.length,
    ...(salesDrift.length ? { sales_scoping_drift: salesDrift } : {}),
    summary: flagged.length === 0
      ? `Scanned ${projects.length} project(s) — no data-integrity issues found.`
      : `${flagged.length}/${projects.length} project(s) have issues — ${Object.entries(countsByCheck).map(([k, v]) => `${k}: ${v}`).join(', ')}.`,
  }
}

// The active board columns, in order. Delivery is intentionally omitted: an active-only
// scan never contains a delivered project, and a Delivery history row is always the last
// (ongoing) one, so there's no completed dwell to measure. Submitted is included so its
// WIP shows even though its timing isn't tracked (the clock starts at Doc Programming).
const REPORT_STAGES = ['Submitted', 'Doc Programming', 'Survey Programming', 'EdWin QA', 'Fielding', 'Data QA'] as const

/** Per-stage cycle time (median/avg over COMPLETED stage passes) + current WIP (from the
 *  live board column, which is authoritative) + projects aging in their current stage past
 *  `stuck_days` (default 14). Reads project_stage_history (clock starts at Doc Programming).
 *  Active work only. mine:true scopes to the caller's captained projects. */
export async function pipelineThroughput(args: { mine?: boolean; userId?: string; stuck_days?: number } = {}) {
  const supabase = createAdminClient()
  const { data: projData, error } = await supabase.from('survey_projects')
    .select('id, project_code, project_name, board_column, status, phase, captain:team_members(name, initials)')
    .eq('status', 'Open').eq('phase', 'Active').is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (error) throw error
  let projects = ((projData ?? []) as unknown as Row[]).filter(isActiveOperational)

  if (args.mine && args.userId) {
    const me = await getMe(args.userId)
    if (!me) return { error: "Could not resolve your team-member record (no matching Team Members row) — can't scope this to you." }
    const ci = me.initials.toLowerCase()
    projects = projects.filter(r => ((r.captain as { initials?: string } | null)?.initials ?? '').toLowerCase() === ci)
  }
  const ids = projects.map(p => p.id as string)
  if (ids.length === 0) return { ok: true, active_projects: 0, untracked: 0, per_stage: [], stuck: [], summary: 'No active projects.' }

  const histRows = await inChunks<{ project_id: string; stage: string; entered_at: string }>(
    ids, c => supabase.from('project_stage_history').select('project_id, stage, entered_at').in('project_id', c),
  )
  const histByPid = groupByProject(histRows)

  const now = new Date().toISOString()
  const stuckDays = Math.max(1, args.stuck_days ?? 14)
  const completedDays: Record<string, number[]> = {}
  // WIP = the CURRENT board_column distribution (authoritative + always known). We do NOT
  // read the current stage from the last history row: for a project already mid-pipeline
  // at the 062 backfill, that row can still say "Doc Programming" while the real column is
  // e.g. Fielding.
  const wip: Record<string, number> = {}
  const stuck: { project_code: unknown; project_name: unknown; stage: string; days: number; captain: string | null }[] = []
  let untracked = 0 // active projects with no stage history yet (e.g. still in Submitted)

  for (const p of projects) {
    const bc = p.board_column as string
    wip[bc] = (wip[bc] ?? 0) + 1
    const rows = histByPid.get(p.id as string) ?? []
    if (rows.length === 0) { untracked++; continue }
    const durs = stageDurations(rows, now)
    for (const d of durs) {
      if (!d.ongoing) (completedDays[d.stage] ??= []).push(d.days)
    }
    // Aging: only trust the current-stage dwell when the latest history row matches the
    // authoritative board_column (otherwise we don't know when it entered that column).
    const last = durs[durs.length - 1]
    if (last && last.ongoing && last.stage === bc && last.days >= stuckDays) {
      stuck.push({
        project_code: p.project_code, project_name: p.project_name, stage: bc, days: last.days,
        captain: (p.captain as { initials?: string } | null)?.initials ?? null,
      })
    }
  }

  const per_stage = REPORT_STAGES.map(stage => {
    const days = completedDays[stage] ?? []
    return {
      stage,
      wip: wip[stage] ?? 0,
      completed_count: days.length,
      median_days: median(days),
      avg_days: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    }
  })
  stuck.sort((a, b) => b.days - a.days)

  return {
    ok: true,
    active_projects: projects.length,
    untracked,
    stuck_days: stuckDays,
    per_stage,
    stuck,
    summary:
      `Throughput over ${projects.length} active project(s) — WIP ` +
      REPORT_STAGES.map(s => `${s.split(' ')[0]} ${wip[s] ?? 0}`).join('/') +
      `; ${stuck.length} stuck ≥${stuckDays}d.` +
      (untracked ? ` (${untracked} not yet in a tracked stage)` : ''),
  }
}

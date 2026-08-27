import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProject, isActiveOperational, getMe } from './data'
import { stageDurations } from '@/lib/utils/stageTiming'

// Data-integrity + pipeline-throughput reads for the connector. All read-only.
//   - reconcileProject: cross-field consistency for one project
//   - dataHealth: portfolio-wide anomaly scan (bulk, no N+1)
//   - pipelineThroughput: per-stage cycle time / WIP / aging from project_stage_history
//
// The canonical spend formula (recompute_project_spend, migration 060 + the third
// term added by 080) is
//   actual_spend = Σ(blast.bid × blast.completes) + Σ(supplier.cpi × supplier.n_collected)
//                                                + Σ(cost.amount)
// so a stored actual_spend that disagrees means the recompute trigger didn't fire.
// This MUST stay in lockstep with the SQL: when 060 added the blast term, one read
// that hadn't been updated with it reported $0 spend on every blast project until a
// hotfix. Here the failure is louder still — a missing term makes the integrity
// checker itself accuse a perfectly-consistent project of a trigger failure.

type Row = Record<string, unknown>
type SupRow = { cpi: number | null; n_collected: number | null }
type BlastRow = { bid: number | null; completes: number | null }
type CostRow = { amount: number | null }
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
  const blastSpend = blasts.reduce((s, r) => s + num(r.bid) * num(r.completes), 0)
  const costSpend = costs.reduce((s, r) => s + num(r.amount), 0)
  const expectedSpend = Math.round(supSpend + blastSpend + costSpend)
  const actualSpend = Math.round(num(p.actual_spend))
  if (sup.length || blasts.length || costs.length) {
    const ok = Math.abs(expectedSpend - actualSpend) <= 1
    checks.push({
      check: 'spend', ok, advisory: false, expected: expectedSpend, actual: actualSpend,
      detail: ok
        ? 'actual_spend matches Σ(cpi×collected)+Σ(bid×completes)+Σ(cost amount)'
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
      c => supabase.from('project_costs').select('project_id, amount').in('project_id', c),
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
    supabase.from('project_blasts').select('bid, completes').eq('project_id', pid),
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
    .select('id, project_code, project_name, status, phase, board_column, n_target, n_collected, n_actual, actual_spend, survey_id_discrepancy, launch_date, deliver_date')
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
    inChunks<BlastRow & { project_id: string }>(ids, c => supabase.from('project_blasts').select('project_id, bid, completes').in('project_id', c)),
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
  return {
    scanned: projects.length,
    with_issues: flagged.length,
    counts_by_check: countsByCheck,
    advisory_counts: advisoryCounts,
    projects: shown,
    truncated: flagged.length > shown.length,
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

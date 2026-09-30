import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  runCleanup, resultsByGroup,
  CHECKS, CLEANUP_PROJECT_SELECT, DEFAULT_SCOPE, LEGACY_IMPORT_CUTOFF,
  GROUP_LABEL, GROUP_ORDER, SEVERITY_LABEL, SOURCE_LABEL,
  demoAccountIds, isRerunWave, withoutDemoAccounts,
  type AccountFlag, type CheckResult, type CleanupCheck, type CleanupReport, type CleanupRow,
  type CleanupSource, type FieldFacts,
} from '@/lib/admin/cleanup'
import { spendOf } from '@/lib/finance/hub'
import { buildCleanupCsv, cleanupCsvFilename, cleanupCsvNotes } from '@/lib/admin/cleanupCsv'
import { todayEastern } from '@/lib/mcp/toolHelpers'

/**
 * The connector's half of the admin data-cleanup dashboard (/admin/cleanup).
 *
 * WHAT THIS FILE IS NOT. It is not a second definition of "what counts as a
 * gap". Every rule lives in lib/admin/cleanup.ts and is read from `CHECKS`
 * here — so a check added, narrowed or renamed there shows up in the assistant
 * the same day, and the tile and the tool can never disagree about a number.
 * This file only does the two things the pure model deliberately cannot: talk
 * to the database, and phrase the answer.
 *
 * ── HOW IT DIFFERS FROM data_health ────────────────────────────────────────
 * data_health (lib/mcp/health.ts) asks whether the NUMBERS AGREE — stored spend
 * against sum(cpi x collected) + …, segment N against project N, supplier
 * collected against delivered N. It is an arithmetic checker and it reports
 * money. This asks whether the FIELDS ARE FILLED — is there a salesperson, a
 * captain, a due date, a type, an N target. It is a completeness checker and it
 * reports no money at all. A survey can pass one and fail the other, which is
 * why both exist; the two descriptions in registry.ts say so in as many words,
 * so the model picks the right one instead of guessing from the word "data".
 *
 * ── NO MONEY ───────────────────────────────────────────────────────────────
 * Nothing this file returns carries an amount. `actual_spend` is read once,
 * server-side, and collapsed into a single boolean (`spendIsZero`) before the
 * row is handed on — the one spend-related check says "the total was never
 * recomputed", never how much. The figure it is compared against comes from
 * `spendOf` (lib/finance/hub.ts), the app's ONE spend formula, called here for
 * the same reason the page calls it: an inline re-implementation drifted from it
 * within a day — it charged for email sends the SQL makes free (migration 112)
 * — and the tile and the tool then disagreed about the same survey.
 * `n_internal_target` is read for a similar kind of reason (without it, surveys
 * scoped on an internal-only target are falsely accused of having no N target at
 * all) and is likewise never returned: it is collapsed to a list of ids before
 * the rows are handed to the model, and no check names it as a field to fill in.
 *
 * ── A FAILED READ IS NOT A CLEAN DATABASE ──────────────────────────────────
 * That distinction is the whole point of the feature, so it is enforced twice.
 * Each child read is settled independently and its source named in `blocked`;
 * the model then reports those checks as unmeasured rather than as zero, and
 * `clean` is false while anything is unmeasured. Drilling into a blocked check
 * refuses outright rather than handing back an empty list that reads as "all
 * clear".
 */

/* ── LOADING ────────────────────────────────────────────────────────────── */

/** PostgREST silently truncates at 1,000 rows. There are 3,439 supplier rows
 *  alone, so every read below is paged — a missing page would show up as
 *  surveys with no fielding evidence, i.e. as FEWER gaps, which is the
 *  direction of error nobody notices. */
const PAGE = 1000

type Read<T> = PromiseLike<{ data: T[] | null; error: { message?: string } | null }>

async function pageAll<T>(label: string, run: (from: number, to: number) => Read<T>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) throw new Error(`${label}: ${error.message ?? 'read failed'}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

/** A survey row as it comes back, before the captain join is flattened and
 *  before the two restricted columns are dropped. */
type RawProject = CleanupRow & {
  captain?: { id: string; name: string | null; initials: string | null } | null
  actual_spend?: number | null
  n_internal_target?: number | null
}

type ChildRow = { project_id: string }
/** `channel` is selected because the spend formula needs it: email sends are
 *  free (migration 112), and omitting the column made this file charge for them
 *  while the page did not. */
type BlastRow = ChildRow & {
  bid: number | null; completes: number | null; people: number | null
  cost_per_send: number | null; channel: string | null
}
type SupplierRow = ChildRow & { cpi: number | null; n_collected: number | null }
type CostRow = ChildRow & { amount: number | null }
type ContactRow = { id: string; occam_invited: boolean | null }

const num = (v: unknown): number => (v == null ? 0 : Number(v))

/** Child rows keyed by survey, so each survey's spend is computed from its own. */
function by<T extends ChildRow>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const a = m.get(r.project_id)
    if (a) a.push(r)
    else m.set(r.project_id, [r])
  }
  return m
}

export interface LoadedCleanup {
  report: CleanupReport
  /** Set when the SURVEY read itself failed. Nothing can be measured, so the
   *  tool refuses rather than returning an empty, clean-looking report. */
  fatal?: string
}

/**
 * Read everything the checks need and run them.
 *
 * The survey read follows CLEANUP_LOADER_CONTRACT to the letter:
 *   · `deleted_at is null`
 *   · not Cancelled — and written as `status.is.null,status.neq.Cancelled`,
 *     because `status <> 'Cancelled'` is NULL for a row with no status and
 *     PostgREST would therefore DROP those rows instead of keeping them. A
 *     survey with no status is exactly the kind of row this dashboard exists
 *     to surface; filtering it out would be the quietest possible bug.
 *   · paged and ordered.
 *
 * Demo and test accounts are dropped exactly as the page drops them, through
 * the model's own `withoutDemoAccounts` — this tool has to agree row-for-row
 * with the tiles on /admin/cleanup, and a connector that quietly scanned a
 * different population produces two different "how far from zero are we"
 * answers on the same afternoon (it did: 438 rows against 437, and every check
 * that one demo survey failed read one higher in the assistant than on screen).
 * Deliberately NOT filtered, on the other hand: the active-only set data_health
 * defaults to. The one scope that does exist — the legacy sheet import — is the
 * model's own, and is applied by runCleanup rather than by the query.
 */
export async function loadCleanup(opts: { includeLegacyImport?: boolean } = {}): Promise<LoadedCleanup> {
  const supabase = createAdminClient()
  const today = todayEastern()
  const scope = { includeLegacyImport: opts.includeLegacyImport ?? DEFAULT_SCOPE.includeLegacyImport }

  let raw: RawProject[]
  let accounts: AccountFlag[]
  try {
    // Both reads must succeed. Without the accounts list there is no way to tell
    // a real survey from a demo one, and this tool would count a population the
    // dashboard does not — which is exactly the divergence it exists to avoid.
    ;[raw, accounts] = await Promise.all([
      pageAll<RawProject>('studies', (from, to) =>
        supabase.from('survey_projects')
          // `actual_spend` and `n_internal_target` ride along ONLY to be
          // collapsed into a boolean and a membership below, and are deleted
          // from the row before anything else sees it. Neither is in
          // CLEANUP_PROJECT_COLUMNS on purpose (that list is what the browser
          // gets); reading them here, on the server, is what lets the "costs
          // recorded, total never updated" and "no N target" checks exist
          // without this tool ever stating a restricted figure.
          .select(`${CLEANUP_PROJECT_SELECT}, actual_spend, n_internal_target`)
          .is('deleted_at', null)
          .or('status.is.null,status.neq.Cancelled')
          .order('id')
          .range(from, to) as unknown as Read<RawProject>
      ),
      pageAll<AccountFlag>('accounts', (from, to) =>
        supabase.from('clients').select('id, is_demo')
          .order('id').range(from, to) as unknown as Read<AccountFlag>),
    ])
  } catch (err) {
    return {
      fatal: (err as Error).message,
      report: runCleanup({ projects: [], today, scope, blocked: ['projects'] }),
    }
  }

  // Flatten the captain join, and take the two restricted columns off the row so
  // neither survives into anything returned.
  const spendIsZero = new Map<string, boolean>()
  const internalTargets: string[] = []
  const projects: CleanupRow[] = withoutDemoAccounts(
    raw.map(r => {
      const { captain, actual_spend, n_internal_target, ...rest } = r as RawProject & Record<string, unknown>
      spendIsZero.set(r.id, !(num(actual_spend) > 0))
      if (n_internal_target != null) internalTargets.push(r.id)
      return { ...(rest as unknown as CleanupRow), captain_name: captain?.name ?? null }
    }),
    demoAccountIds(accounts),
  )

  const ids = new Set(projects.map(p => p.id))

  const [blasts, suppliers, launches, costs, contacts] = await Promise.allSettled([
    pageAll<BlastRow>('blasts', (from, to) =>
      supabase.from('project_blasts').select('project_id, bid, completes, people, cost_per_send, channel')
        .order('id').range(from, to) as unknown as Read<BlastRow>),
    pageAll<SupplierRow>('suppliers', (from, to) =>
      supabase.from('project_suppliers').select('project_id, cpi, n_collected')
        .order('id').range(from, to) as unknown as Read<SupplierRow>),
    pageAll<ChildRow>('launches', (from, to) =>
      supabase.from('project_launches').select('project_id')
        .order('id').range(from, to) as unknown as Read<ChildRow>),
    pageAll<CostRow>('costs', (from, to) =>
      supabase.from('project_costs').select('project_id, amount')
        .order('id').range(from, to) as unknown as Read<CostRow>),
    pageAll<ContactRow>('contacts', (from, to) =>
      supabase.from('client_contacts').select('id, occam_invited')
        .order('id').range(from, to) as unknown as Read<ContactRow>),
  ])

  const blocked: CleanupSource[] = []
  function settled<T>(res: PromiseSettledResult<T[]>, source: CleanupSource): T[] {
    if (res.status === 'fulfilled') return res.value
    // Named, never swallowed. The checks that depend on it report "not
    // measured" instead of 0.
    console.error(`[cleanup] ${source} read failed — reporting it as unmeasured:`, res.reason)
    blocked.push(source)
    return []
  }

  const blastRows = settled(blasts, 'blasts').filter(r => ids.has(r.project_id))
  const supplierRows = settled(suppliers, 'suppliers').filter(r => ids.has(r.project_id))
  const launchRows = settled(launches, 'launches').filter(r => ids.has(r.project_id))
  const costRows = settled(costs, 'costs').filter(r => ids.has(r.project_id))
  const contactRows = settled(contacts, 'contacts')

  // One FieldFacts per survey, built exactly as app/(app)/admin/cleanup/load.ts
  // builds it. `recordsSpend` is `spendOf` — the app's ONE spend formula, the
  // same one recompute_project_spend implements (migrations 060/080/091/095 and
  // 112) — evaluated here and reduced to a yes/no: the amount is computed and
  // immediately thrown away. It is NOT re-implemented inline; it was, and the
  // copy charged for the email sends the formula makes free, so one survey
  // counted as a gap here while the tile beside it read clear.
  const blastsBy = by(blastRows)
  const suppliersBy = by(supplierRows)
  const costsBy = by(costRows)
  const launchesBy = by(launchRows)

  const fielding = new Map<string, FieldFacts>()
  for (const r of projects) {
    const b = blastsBy.get(r.id) ?? []
    const s = suppliersBy.get(r.id) ?? []
    const c = costsBy.get(r.id) ?? []
    const l = launchesBy.get(r.id) ?? []
    // A survey with no child rows at all has nothing to say; `facts()` answers
    // NO_FIELD_FACTS for an absent id.
    if (b.length + s.length + c.length + l.length === 0) continue
    fielding.set(r.id, {
      blasts: b.length, suppliers: s.length, launches: l.length, costs: c.length,
      recordsSpend: spendOf(r, b, s, c).total > 0,
      spendIsZero: spendIsZero.get(r.id) ?? true,
    })
  }

  // A contact absent from this map makes the Occam check NOT APPLY, which is
  // honest; mapping "absent" to false would invent a gap on every survey whose
  // contact row we could not read.
  const contactMap = new Map<string, boolean>()
  for (const c of contactRows) contactMap.set(c.id, c.occam_invited === true)

  return {
    report: runCleanup({
      projects, fielding, contacts: contactMap,
      internalTargets: internalTargets.filter(id => ids.has(id)),
      blocked, today, scope,
    }),
  }
}

/* ── ANSWERING ──────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

/** Resolve what the caller typed to one check: its id, its id written with
 *  spaces or dashes, or a distinctive piece of its label. Ambiguity is reported
 *  rather than resolved by picking the first — "date" matches five tiles, and
 *  silently choosing one of them would answer a question nobody asked. */
export function resolveCheck(ref: string): CleanupCheck | { ambiguous: { id: string; label: string }[] } | null {
  const want = ref.trim().toLowerCase()
  if (!want) return null
  const exact = CHECKS.find(c => c.id === want || norm(c.id) === norm(want) || norm(c.label) === norm(want))
  if (exact) return exact
  const hits = CHECKS.filter(c => norm(c.id).includes(norm(want)) || c.label.toLowerCase().includes(want))
  if (hits.length === 1) return hits[0]
  if (hits.length > 1) return { ambiguous: hits.map(c => ({ id: c.id, label: c.label })) }
  return null
}

/** What the scope toggle did, in words — so an answer never states a count
 *  without saying which surveys it counted. */
function scopeNote(report: CleanupReport): string {
  return report.scope.includeLegacyImport
    ? `All ${report.inScope} live studies, INCLUDING the legacy sheet import of ${LEGACY_IMPORT_CUTOFF} and earlier.`
    : `The ${report.inScope} studies created after the legacy sheet import (${LEGACY_IMPORT_CUTOFF}); ` +
      `${report.excludedLegacy} imported rows are excluded — pass include_legacy_import:true to count them too.`
}

/** One survey, as the model should read it. Context only: no money, and no
 *  column beyond the ones this check asks somebody to fill in. */
function surveyOut(r: CleanupRow, check: CleanupCheck) {
  const current: Record<string, unknown> = {}
  for (const f of check.fields) current[f.column] = f.current(r) ?? null
  return {
    project_code: r.project_code,
    project_name: r.project_name,
    client: r.client,
    stage: r.board_column,
    status: r.status,
    requested_by: r.requested_by_name,
    rerun_wave: isRerunWave(r),
    current,
  }
}

function blockedSentence(res: CheckResult): string {
  const names = res.blockedBy.map(s => SOURCE_LABEL[s]).join(' and ')
  return `"${res.check.label}" could NOT be measured: the ${names} read failed. ` +
    'That is not a count of 0 — it is an unknown, and must not be reported as clean.'
}

export interface CleanupArgs {
  check?: string
  group?: string
  include_legacy_import?: boolean
  include_waves?: boolean
  csv?: boolean
  limit?: number
}

export async function dataCleanup(args: CleanupArgs = {}) {
  const { report, fatal } = await loadCleanup({ includeLegacyImport: args.include_legacy_import })
  if (fatal) {
    return {
      error:
        `The studies table did not load (${fatal}), so nothing was checked. ` +
        'This is not a count of 0 and not a clean database — it is an unmeasured one. ' +
        'Say the read failed rather than reporting anything as clean.',
    }
  }
  return formatCleanup(report, args)
}

/**
 * Turn a report into the tool's answer. Pure, and separate from `loadCleanup`
 * for one reason: the interesting behaviour here is what the tool says when a
 * source is BLOCKED, and a null that should never have been a zero is not
 * something to leave to a mocked database. See cleanup.test.ts.
 */
export function formatCleanup(report: CleanupReport, args: CleanupArgs = {}) {
  /* ---- drill into one check ---- */
  if (args.check) {
    const resolved = resolveCheck(args.check)
    if (resolved === null) {
      return {
        error: `No cleanup check matches "${args.check}".`,
        available_checks: CHECKS.map(c => ({ id: c.id, label: c.label })),
      }
    }
    if ('ambiguous' in resolved) {
      return { note: `"${args.check}" matches more than one check — name one.`, candidates: resolved.ambiguous }
    }
    const res = report.results.find(r => r.check.id === resolved.id)!
    if (!res.available) {
      return { error: blockedSentence(res), check: resolved.id, blocked_by: res.blockedBy, measured: false }
    }
    const limit = Math.min(args.limit ?? 50, 200)
    const rows = args.include_waves ? [...res.rows, ...res.waves] : res.rows
    const shown = rows.slice(0, limit)
    // The worksheet is never truncated the way the preview list is: a CSV that
    // quietly dropped rows would be edited and handed back as if it were the
    // whole set, and the missing surveys would look fixed.
    const csv = args.csv ? buildCleanupCsv(res, { includeWaves: args.include_waves }) : undefined
    return {
      ok: true,
      check: {
        id: resolved.id, label: resolved.label, help: resolved.help, why: resolved.why,
        group: GROUP_LABEL[resolved.group], severity: SEVERITY_LABEL[resolved.severity],
        // Empty for the checks nothing is typed to fix; `remedy` is what to do
        // instead, and it is stated rather than left to be inferred from an
        // empty list.
        fields_to_fill: cleanupCsvNotes(resolved),
        ...(resolved.remedy ? { remedy: resolved.remedy } : {}),
      },
      measured: true,
      scope: {
        legacy_import_included: report.scope.includeLegacyImport,
        in_scope: report.inScope,
        excluded_legacy: report.excludedLegacy,
      },
      applies_to: res.applies,
      count: res.count,
      wave_count: res.waveCount,
      surveys: shown.map(r => surveyOut(r, resolved)),
      truncated: rows.length > shown.length,
      ...(csv ? { csv, csv_filename: cleanupCsvFilename(resolved, report.today), csv_rows: rows.length } : {}),
      summary:
        `${resolved.label}: ${res.count} ${res.count === 1 ? 'study' : 'studies'}` +
        (res.waveCount ? `, plus ${res.waveCount} rerun wave(s) not yet picked up` : '') +
        ` — out of the ${res.applies} this check applies to. ${scopeNote(report)}` +
        (!args.include_waves && res.waveCount ? ' The waves are listed only with include_waves:true.' : ''),
    }
  }

  /* ---- every tile ---- */
  const wantGroup = args.group?.trim().toLowerCase()
  const groups = GROUP_ORDER
    .filter(g => !wantGroup || g === wantGroup || GROUP_LABEL[g].toLowerCase() === wantGroup)
    .map(g => ({
      group: g,
      label: GROUP_LABEL[g],
      checks: resultsByGroup(report, g).map(res => ({
        check_id: res.check.id,
        label: res.check.label,
        severity: SEVERITY_LABEL[res.check.severity],
        measured: res.available,
        // null, never 0, when the read failed. The two read very differently to
        // a model summarising this, and only one of them is true.
        surveys: res.available ? res.count : null,
        rerun_waves: res.available ? res.waveCount : null,
        applies_to: res.available ? res.applies : null,
        ...(res.available ? {} : { blocked_by: res.blockedBy, note: blockedSentence(res) }),
      })),
    }))
    .filter(g => g.checks.length > 0)

  if (wantGroup && groups.length === 0) {
    return {
      error: `No cleanup group called "${args.group}".`,
      available_groups: GROUP_ORDER.map(g => ({ group: g, label: GROUP_LABEL[g] })),
    }
  }

  const measured = report.results.filter(r => r.available)
  const openItems = measured.reduce((s, r) => s + r.count, 0)
  const openWaves = measured.reduce((s, r) => s + r.waveCount, 0)
  const atZero = measured.filter(r => r.count === 0 && r.waveCount === 0).length
  const unmeasured = report.results.filter(r => !r.available)

  return {
    ok: true,
    scope: {
      legacy_import_included: report.scope.includeLegacyImport,
      legacy_import_cutoff: LEGACY_IMPORT_CUTOFF,
      scanned: report.scanned,
      in_scope: report.inScope,
      excluded_legacy: report.excludedLegacy,
      rerun_waves_in_scope: report.waves,
      note: scopeNote(report),
    },
    // False while ANYTHING is unmeasured: not knowing is not the same as being
    // clean, and this is the flag an answer will quote.
    clean: report.clean,
    tiles_at_zero: atZero,
    tiles_measured: measured.length,
    tiles_total: report.results.length,
    open_items: openItems,
    open_wave_items: openWaves,
    surveys_needing_work: report.surveysNeedingWork,
    groups,
    blocked: [...new Set(report.blocked)].map(s => SOURCE_LABEL[s]),
    summary:
      (report.clean
        ? `Every tile is at zero across the ${report.inScope} studies in scope.`
        : `${atZero} of ${measured.length} measured tiles are at zero. ` +
          `${report.surveysNeedingWork} ${report.surveysNeedingWork === 1 ? 'study needs' : 'studies need'} work, ${openItems} field(s) to fill in all told` +
          (openWaves ? `, plus ${openWaves} on rerun waves` : '') + '.') +
      (unmeasured.length
        ? ` ${unmeasured.length} check(s) could NOT be measured (${[...new Set(report.blocked)].map(s => SOURCE_LABEL[s]).join(', ')} did not load) — say so rather than calling those clean.`
        : '') +
      ` ${scopeNote(report)}`,
  }
}

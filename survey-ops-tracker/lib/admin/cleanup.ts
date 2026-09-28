/**
 * The data-cleanup dashboard, as a pure function: `runCleanup(input)`.
 *
 * David, 2026-09-28: "i also need an admin dashboard for data cleanup … they
 * can just be tiles with numbers and then i can click into them to see more
 * details + the ability to export as csv so i can update in the csv and return
 * it to you. the idea is that every tile should be 0."
 *
 * ── EVERY CHECK IS A ROW IN `CHECKS`, NOT A BRANCH IN A COMPONENT ───────────
 * The tiles, the drill-down list, the CSV export and the connector all read the
 * one `CHECKS` array. A check added here appears in all four with no other
 * edit, and none of them can drift out of step with the others. A check carries
 * not just its predicate but what it is FOR (`why`) and which database columns a
 * person would fill in (`fields`) — the CSV is generated from those columns, so
 * the file David edits and hands back names the real fields by their real names.
 *
 * ── NO MONEY ────────────────────────────────────────────────────────────────
 * This page is about completeness, not value. Nothing here reads or renders
 * `budget`, `actual_spend` as an amount, a price or a margin. The single
 * spend-adjacent check (`spend_not_recomputed`) takes a BOOLEAN from the loader
 * — "the child rows add up to something and the stored total is zero" — and
 * never sees or states a figure.
 *
 * ── NO SUPABASE, NO REACT ───────────────────────────────────────────────────
 * Same discipline as lib/insights/model.ts and lib/sales/home.ts: the page
 * passes rows in and renders what comes out, so every count on the dashboard is
 * tested against fixtures (cleanup.test.ts) instead of against production.
 *
 * ── A FAILED READ IS NOT ZERO ───────────────────────────────────────────────
 * Four checks need child tables (blasts, panel launches, cost lines, contacts).
 * If one of those reads fails, the checks that depend on it come back
 * `available: false` with the source named, NOT a confident 0. A cleanup tile
 * reading "0" because the query died is worse than no tile at all: it is the
 * dashboard telling you the work is done.
 *
 * ── WHERE THE NUMBERS IN THE COMMENTS COME FROM ─────────────────────────────
 * Measured against production THROUGH THIS PAGE'S OWN LOADER — demo accounts
 * dropped, exactly as the page drops them — on 2026-09-28: 437 live
 * non-cancelled surveys, 176 of them created by the legacy sheet import, 261 in
 * the default scope, 20 of those empty placeholder shells.
 *
 * Every "Measured" comment below carries that date. They exist so that a future
 * edit which changes a number by an order of magnitude is visibly a change; an
 * undated one cannot tell drift (the book moves every day) from a miscount, and
 * the first set was taken through the connector, which was then scanning one row
 * more than the page.
 */

import { isRerunProject } from '@/lib/reruns/isRerun'
import { isKnownSalesperson } from '@/lib/utils/salespeople'
import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'

/* ── SCOPE ──────────────────────────────────────────────────────────────── */

/**
 * The day the legacy sheet import landed. 176 of the 437 live surveys were
 * created on this date in one batch (2026-09-28).
 *
 * David asked for "records after 6/1/26, like the other dashboards" — but a
 * 1 June cutoff filters NOTHING, because `created_at` on an imported row is the
 * import stamp, not when the work happened, and every row in the table is
 * therefore stamped after 1 June. The scope that does what he meant is: exclude
 * the import batch itself.
 *
 * Compared as a DATE, never as a raw timestamp. `'2026-06-10T14:22:00Z' >
 * '2026-06-10'` is true for a string compare, which silently readmits the whole
 * import — the exact mistake this constant exists to prevent.
 */
export const LEGACY_IMPORT_CUTOFF = '2026-06-10'

/** The date part of a timestamp, for comparing against a bare YYYY-MM-DD. */
export const dateOf = (ts: string | null | undefined): string | null =>
  ts ? String(ts).slice(0, 10) : null

export interface CleanupScope {
  /**
   * Off by default: the tiles count the surveys the team created themselves.
   * Turning it on adds the 176 legacy-import rows, which is a much larger and
   * much older backlog — worth being able to see, never the default.
   */
  includeLegacyImport: boolean
}

export const DEFAULT_SCOPE: CleanupScope = { includeLegacyImport: false }

/** A row the legacy sheet import created (or anything older than it). */
export function isLegacyImport(r: Pick<CleanupRow, 'created_at'>): boolean {
  const d = dateOf(r.created_at)
  // No created_at at all is treated as legacy: an undated row is certainly not
  // something the team typed this quarter, and guessing the other way would put
  // rows nobody can date into the headline count.
  return d === null || d <= LEGACY_IMPORT_CUTOFF
}

export function inScope(r: Pick<CleanupRow, 'created_at'>, scope: CleanupScope): boolean {
  return scope.includeLegacyImport || !isLegacyImport(r)
}

/* ── ROWS ───────────────────────────────────────────────────────────────── */

/**
 * The survey fields every check reads. Structural rather than the generated
 * `Row` type, so fixtures stay small and the loader is free to select exactly
 * these columns (and, notably, no money column).
 */
export interface CleanupRow {
  id: string
  project_code: string | null
  project_name: string | null
  client: string | null
  client_id: string | null
  captain_id: string | null
  captain_name?: string | null
  salesperson: string | null
  requested_by_contact_id: string | null
  requested_by_name: string | null
  project_type: string | null
  phase: string | null
  status: string | null
  board_column: string | null
  scoping_stage?: string | null
  submitted_date: string | null
  launch_date: string | null
  due_date: string | null
  deliver_date: string | null
  delivered_at: string | null
  rerun_date: string | null
  n_target: number | null
  n_target_max: number | null
  n_collected: number | null
  n_actual: number | null
  survey_tool_id: string | null
  longitudinal: boolean | null
  row_level_data: boolean | null
  occam: boolean | null
  series_id: string | null
  rerun_number: number | null
  is_placeholder: boolean | null
  created_at: string | null
}

/**
 * The survey columns a loader must select to build a `CleanupRow`, named one by
 * one rather than `*`.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * `budget`, `actual_spend`, `credits` and every price. Hiding a column in the
 * UI is not enough — anything selected arrives in the browser and can be read
 * in the network panel. The one spend-related check gets a BOOLEAN from the
 * server instead (see `FieldFacts.spendIsZero`); the loader that computes it may
 * read `actual_spend`, but only server-side, and only a yes/no crosses to the
 * page.
 *
 * `n_internal_target` is not money, but it IS restricted from the sales tier
 * (migrations 102/105/107 exist to keep it there), and the same rule applies to
 * it: a column selected but never rendered still travels to the browser inside
 * the RSC payload. It is read SERVER-SIDE only and reaches the model as a set of
 * survey ids (`CleanupInput.internalTargets`) — enough for `no_n_target` not to
 * accuse a survey scoped on an internal-only target, and not one figure more.
 *
 * A column added to `CleanupRow` later must not be named here until its
 * migration is applied: PostgREST rejects the WHOLE select, which would blank
 * the dashboard rather than drop one field.
 */
export const CLEANUP_PROJECT_COLUMNS = [
  'id', 'project_code', 'project_name', 'client', 'client_id', 'captain_id', 'salesperson',
  'requested_by_contact_id', 'requested_by_name', 'project_type', 'phase', 'status',
  'board_column', 'scoping_stage', 'submitted_date', 'launch_date', 'due_date', 'deliver_date',
  'delivered_at', 'rerun_date', 'n_target', 'n_target_max', 'n_collected',
  'n_actual', 'survey_tool_id', 'longitudinal', 'row_level_data', 'occam', 'series_id',
  'rerun_number', 'is_placeholder', 'created_at',
] as const

/** The captain join, for `captain_name`. Map it onto the row after the read. */
export const CLEANUP_CAPTAIN_JOIN = 'captain:team_members(id, name, initials)'

export const CLEANUP_PROJECT_SELECT = `${CLEANUP_PROJECT_COLUMNS.join(', ')}, ${CLEANUP_CAPTAIN_JOIN}`

/**
 * What the loader must do that this file cannot:
 *   · `deleted_at is null` on every read.
 *   · Drop `status = 'Cancelled'` rows. A cancelled survey is not a data gap.
 *   · Page every read (`.order(col).range(f, f + 999)`): PostgREST truncates at
 *     1,000 rows without saying so, and there are 3,439 supplier rows alone.
 *   · Promise.allSettled across the tables, and pass the name of anything that
 *     failed as `blocked` — so its checks report "we could not measure this"
 *     instead of a confident zero.
 */
export const CLEANUP_LOADER_CONTRACT = [
  'deleted_at is null',
  "status != 'Cancelled'",
  'demo and test accounts dropped (`withoutDemoAccounts`)',
  'every read paged and ordered',
  'failed reads named in `blocked`, never swallowed',
] as const

/* ── DEMO ACCOUNTS, DROPPED THE SAME WAY BY EVERY LOADER ────────────────── */

/** The `clients` rows a loader needs to apply the exclusion below. */
export interface AccountFlag { id: string; is_demo: boolean | null }

/** The accounts that are not real work (migration 113). */
export const demoAccountIds = (accounts: AccountFlag[]): Set<string> =>
  new Set(accounts.filter(a => a.is_demo === true).map(a => a.id))

/**
 * Drop the surveys on a demo or test account.
 *
 * Here, in the model, rather than twice in two loaders: the page and the
 * connector have to scan the SAME population or they answer "how far from zero
 * are we" differently on the same afternoon — which they did, 438 rows against
 * 437, the difference being one demo survey that made every check it failed read
 * one higher in the assistant than on the tile.
 *
 * Filtered in JS rather than in the query because `client_id not in (…)` is NULL
 * for a survey with no account at all, which would drop exactly the surveys the
 * "not linked to an account" tile exists to find.
 */
export function withoutDemoAccounts<T extends Pick<CleanupRow, 'client_id'>>(
  rows: T[], demo: ReadonlySet<string>,
): T[] {
  return rows.filter(r => !(r.client_id && demo.has(r.client_id)))
}

/** A repeat wave. The app's own definition (lib/reruns/isRerun.ts) — a local
 *  test keyed on `rerun_number != null` would call the whole book a rerun,
 *  because that column DEFAULTS TO 1 on every row. 125 of the 261 surveys in the
 *  default scope are waves (2026-09-28). */
export const isRerunWave = (r: CleanupRow): boolean =>
  isRerunProject({ series_id: r.series_id, rerun_number: r.rerun_number, project_type: r.project_type })

/** How far along the pipeline, as an index into STAGE_ORDER. -1 for a board
 *  column outside the survey pipeline (the internal-project columns) and for a
 *  row with none set, so "has reached stage X" is false for both rather than
 *  accidentally true. */
export function stageIndex(r: Pick<CleanupRow, 'board_column'>): number {
  return STAGE_ORDER.indexOf(r.board_column as BoardColumn)
}

/** Has this survey reached `stage` (or gone past it)? */
export function reached(r: Pick<CleanupRow, 'board_column'>, stage: BoardColumn): boolean {
  const i = stageIndex(r)
  return i >= 0 && i >= STAGE_ORDER.indexOf(stage)
}

export const isDelivered = (r: Pick<CleanupRow, 'board_column'>): boolean => r.board_column === 'Delivery'

/**
 * Still being scoped and priced: pre-sale, not committed work.
 *
 * `phase === 'Scoping'` ALONE is not enough. 330 of 374 non-null `scoping_stage`
 * rows still read "New Inquiry" and most of those are long delivered, and
 * lib/finance/lifecycle.ts found a survey marked Scoping while it was being
 * fielded. Requiring `status === 'Open'` and a board column no further than
 * Submitted keeps the exemption to the 11 surveys that really are pre-sale (13
 * rows are phase Scoping and status Open; two of them sit at Doc Programming or
 * Survey Programming and are not excused, 2026-09-28) —
 * because this predicate EXCUSES missing data, and an exemption that is too
 * generous is how a dashboard quietly stops reporting real gaps.
 */
export function isScoping(r: Pick<CleanupRow, 'phase' | 'status' | 'board_column'>): boolean {
  return r.phase === 'Scoping' && r.status === 'Open' && stageIndex(r) <= 0
}

/** The survey tool IDs on one row. `survey_tool_id` is a COMMA-SEPARATED LIST,
 *  never an id — exact-matching it once hid 22 studies. */
export function toolIds(r: Pick<CleanupRow, 'survey_tool_id'>): string[] {
  return String(r.survey_tool_id ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

/* ── WHAT THE CHILD TABLES SAY ──────────────────────────────────────────── */

/** Which read a check depends on. A blocked source makes its checks
 *  `available: false` instead of 0. */
export type CleanupSource = 'projects' | 'blasts' | 'suppliers' | 'launches' | 'costs' | 'contacts'

export const SOURCE_LABEL: Record<CleanupSource, string> = {
  projects: 'surveys',
  blasts: 'blasts',
  suppliers: 'panel suppliers',
  launches: 'panel launches',
  costs: 'cost lines',
  contacts: 'client contacts',
}

/**
 * What one survey's child rows say about it — counts and one boolean, never an
 * amount. `recordsSpend` is computed by the loader from the canonical formula
 * and arrives here as a yes/no, which is how this file stays money-free while
 * still being able to say "the money was recorded and the total never updated".
 */
export interface FieldFacts {
  blasts: number
  suppliers: number
  launches: number
  costs: number
  /** The child rows add up to more than nothing. No figure crosses this line. */
  recordsSpend: boolean
  /** The survey's own `actual_spend` is zero or unset. Also a boolean on purpose. */
  spendIsZero: boolean
}

export const NO_FIELD_FACTS: FieldFacts = {
  blasts: 0, suppliers: 0, launches: 0, costs: 0, recordsSpend: false, spendIsZero: true,
}

/** Everything a predicate needs beyond the row itself. Built once per run by
 *  `buildContext` so no check does an O(n) scan of its own. */
export interface CleanupContext {
  fielding: ReadonlyMap<string, FieldFacts>
  /** Occam-invited state per client contact id. Absent = contact not loaded. */
  contacts: ReadonlyMap<string, boolean>
  /** Survey ids carrying an `n_internal_target`. The VALUE is restricted from
   *  the sales tier and never leaves the server, so the model is handed the
   *  membership and nothing else — see CLEANUP_PROJECT_COLUMNS. */
  hasInternalTarget: ReadonlySet<string>
  /** Survey tool id → how many DISTINCT surveys carry it. Built across every
   *  live survey, in or out of scope: an id shared with an excluded legacy row
   *  is still a collision. */
  toolIdOwners: ReadonlyMap<string, number>
  blocked: ReadonlySet<CleanupSource>
  today: string
}

export const facts = (ctx: CleanupContext, r: CleanupRow): FieldFacts =>
  ctx.fielding.get(r.id) ?? NO_FIELD_FACTS

/** Any record at all of how this survey was fielded. */
export const hasFieldRows = (ctx: CleanupContext, r: CleanupRow): boolean => {
  const f = facts(ctx, r)
  return f.blasts + f.suppliers + f.launches > 0
}

/* ── THE SHELLS THE RERUN SPAWNER MADE ──────────────────────────────────── */

/** The reads that have to have succeeded before a row can be called EMPTY. */
const PLACEHOLDER_SOURCES: CleanupSource[] = ['blasts', 'suppliers', 'launches', 'costs']

/**
 * A placeholder wave with nothing behind it: `is_placeholder`, no blast, panel,
 * launch or cost row, no responses and no final N.
 *
 * The same test lib/finance/lifecycle.ts uses (`classify` → 'placeholder'), and
 * for the same reason. scripts/backfill-placeholders.mjs INSERTS these rows with
 * no captain, no salesperson, no type, no target and no survey ID on purpose —
 * migration 075: "Placeholders carry no real N/data yet" — so they fail ten
 * completeness checks the moment they are created and NO amount of data entry
 * clears them. A dashboard whose contract is "every tile should be 0" cannot ask
 * a person to invent a captain for a wave that never ran; it can ask them to
 * delete the shell or reconcile it, which is what `empty_placeholder_wave` does.
 *
 * A placeholder that DOES hold data is not empty and falls through to every
 * ordinary check — the flag on it is then a data error to clear, not a class.
 *
 * Honest when a read failed: if any child read is blocked we cannot know the row
 * is empty, so it is NOT excused and stays in the ordinary counts.
 */
export function isEmptyPlaceholder(r: CleanupRow, ctx: CleanupContext): boolean {
  if (r.is_placeholder !== true) return false
  if (PLACEHOLDER_SOURCES.some(src => ctx.blocked.has(src))) return false
  const f = facts(ctx, r)
  if (f.blasts + f.suppliers + f.launches + f.costs > 0) return false
  return !((r.n_collected ?? 0) > 0) && r.n_actual == null
}

/* ── SEVERITY AND GROUPING ──────────────────────────────────────────────── */

export type Severity = 'high' | 'medium' | 'low'

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'Blocks something',
  medium: 'Worth fixing',
  low: 'Tidy-up',
}

export const SEVERITY_HELP: Record<Severity, string> = {
  high: 'Something downstream is already wrong or unreachable because this is missing.',
  medium: 'Nothing is broken today, but a report, a filter or a handover is incomplete.',
  low: 'Cosmetic or machine-fixable. Clear it when convenient.',
}

/** Meaning-encoding tone, defined once here so every surface that draws a
 *  severity uses the same colour. Semantic tokens only — no literals. */
export const SEVERITY_TONE: Record<Severity, string> = {
  high: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
  low: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30',
}

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low']

export type CheckGroup = 'ownership' | 'dates' | 'classification' | 'measurement' | 'consistency'

export const GROUP_ORDER: CheckGroup[] = ['ownership', 'dates', 'classification', 'measurement', 'consistency']

export const GROUP_LABEL: Record<CheckGroup, string> = {
  ownership: 'Who owns it',
  dates: 'When it happened',
  classification: 'What it is',
  measurement: 'What we got',
  consistency: 'Rows that disagree with each other',
}

export const GROUP_HELP: Record<CheckGroup, string> = {
  ownership: 'The people and the account a survey belongs to.',
  dates: 'The dates every report, calendar and cycle-time figure is built from.',
  classification: 'Type, flags and identifiers — what the survey IS.',
  measurement: 'The numbers we promised and the numbers we got.',
  consistency: 'Nothing is missing; two fields simply cannot both be right.',
}

/* ── CHECKS ─────────────────────────────────────────────────────────────── */

/**
 * A database column a person would fill in, and what to type into it.
 *
 * `column` is the REAL column name and becomes the CSV header, because the file
 * goes out, gets edited in a spreadsheet, and comes back for Claude to apply —
 * a header reading "Salesperson" would leave the mapping to be guessed, and a
 * guess is how the wrong field gets written.
 */
export interface CleanupField {
  column: string
  /** What to type, in words. Shown in the UI and carried in the CSV's note row. */
  entry: string
  /** The value on the row today, as it should read in a spreadsheet. */
  current: (r: CleanupRow) => unknown
  /**
   * Context, not a question. The worksheet carries `<column> (current)` and NO
   * blank cell beside it — `delivered_at` is on the "copy the stamp across"
   * sheet because you cannot copy a value the file does not show you, not
   * because anybody should type a timestamp in.
   */
  readOnly?: true
  /**
   * The column stores an id, and what a person can actually write in a
   * spreadsheet is a name. The editable header is written `<column> (by name)`
   * so the file says out loud that the cell needs resolving before a write —
   * rather than looking like a direct-write column and coming back with "Sree"
   * sitting in a uuid field.
   */
  lookup?: true
}

export interface CleanupCheck {
  id: string
  /** The tile's title. A noun phrase naming what is MISSING or WRONG. */
  label: string
  /** One sentence: what the check looks for. The tile's (i). */
  help: string
  /** What breaks downstream while this is unfixed. The reason to care. */
  why: string
  group: CheckGroup
  severity: Severity
  /** Reads this check depends on beyond the survey table itself. */
  sources: CleanupSource[]
  /**
   * The columns a person fills in to clear it. Drives the CSV.
   *
   * MAY BE EMPTY, and two checks use that: nothing is typed to fix them, so
   * they carry a `remedy` in prose instead. A blank editable column headed
   * `actual_spend` in a file that leaves the building is an invitation to
   * hand-write into a trigger-maintained money column, on the one dashboard
   * built to carry no money at all.
   */
  fields: CleanupField[]
  /** What clears it when there is no column to type into. Required whenever
   *  `fields` is empty; shown beside the download and returned by the tool. */
  remedy?: string
  /**
   * Empty placeholder shells (`isEmptyPlaceholder`) are held back from EVERY
   * check except the one that is about them, which sets this. Without it the 20
   * shells fail ten tiles permanently and `clean` can never be true. See
   * `isEmptyPlaceholder` for why they cannot be filled in.
   */
  placeholders?: true
  /**
   * Which surveys the check is even meaningful for. A check that fires where a
   * field is legitimately empty teaches people to ignore the whole dashboard,
   * so every non-trivial `applies` below carries the measured reason it is
   * narrowed the way it is.
   */
  applies: (r: CleanupRow, ctx: CleanupContext) => boolean
  /** True when this survey needs attention. */
  fails: (r: CleanupRow, ctx: CleanupContext) => boolean
}

const blank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === ''
const date = (column: string, current: (r: CleanupRow) => unknown): CleanupField =>
  ({ column, entry: 'a date, YYYY-MM-DD', current })

/**
 * Not still being scoped. Used by every check that a pre-sale deal is excused
 * from — 13 live surveys, so it narrows almost nothing and costs no honesty.
 *
 * A survey on HOLD is deliberately NOT excused here. lib/finance/lifecycle.ts
 * gives 'hold' its own class and keeps it out of live totals, and that is right
 * for money; it is not right for completeness. A hold is sold work that stopped,
 * so the client was already promised something and somebody already owns it —
 * and David's standing aim is to minimise holds, which a tile that quietly
 * excused them would work against. 10 live surveys sit at Hold, 8 of them with
 * no due date; they are counted, and this comment is the decision rather than an
 * oversight. Flip it here, in one place, if that ever stops being what he wants.
 */
const sold = (r: CleanupRow) => !isScoping(r)

/**
 * Every check, in the order the dashboard shows them.
 *
 * The counts in each comment are what this predicate returned against
 * production on 2026-09-28, read through the page's own loader — first across
 * all 437 live surveys, then across the 261 in the default scope (legacy import
 * excluded). Rerun waves are stated separately, as "+n waves", the way the tile
 * states them. They are here so that a future edit which changes a number by an
 * order of magnitude is visibly a change, not a silent one.
 */
export const CHECKS: CleanupCheck[] = [
  /* ── OWNERSHIP ──────────────────────────────────────────────────────── */
  {
    id: 'no_salesperson',
    label: 'No salesperson',
    help: 'No sales lead recorded on the survey.',
    why: 'A salesperson only sees their own book, so a survey with no name on it is invisible to every sales view and belongs to nobody at renewal.',
    group: 'ownership',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'salesperson',
      entry: 'the full name, e.g. Alex Pinsky — or Internal when there is no external sales lead',
      current: r => r.salesperson,
    }],
    // Applies to a scoping deal too: a deal being priced certainly has someone
    // selling it. Measured 2026-09-28: 69 live (+27 waves) / 1 in the default
    // scope (+22 waves).
    applies: () => true,
    fails: r => blank(r.salesperson),
  },
  {
    id: 'unknown_salesperson',
    label: 'Salesperson not on the list',
    help: 'The name in `salesperson` is not one this app recognises.',
    why: 'Sales views filter on an exact name. Drifted text ("Jenna", "Shanu") hides the survey from the person who owns it, with no error to explain why.',
    group: 'ownership',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'salesperson',
      entry: 'the canonical full name from the dropdown',
      current: r => r.salesperson,
    }],
    // Measured 0 live (2026-09-28). It was 5 before the 2026-08-27 normalisation
    // and will be non-zero again the moment anything writes this column without
    // the picker.
    applies: r => !blank(r.salesperson),
    fails: r => !isKnownSalesperson(r.salesperson),
  },
  {
    id: 'no_captain',
    label: 'No captain',
    help: 'No team member assigned to run the survey.',
    why: 'The board, the workload split and every "who do I ask about this" question key off the captain.',
    group: 'ownership',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'captain_id',
      // A uuid column a person cannot type into: the worksheet heads it
      // `captain_id (by name)` so a returned "Sree" is visibly a name to
      // resolve, not a value to write.
      lookup: true,
      entry: "the captain's initials or full name (Claude resolves it to the team member)",
      current: r => r.captain_name ?? r.captain_id,
    }],
    // Measured 2026-09-28: 8 live (+4 waves) / 0 in the default scope (+2
    // waves). It read 22 in scope before the empty placeholder shells were held
    // back — 20 rows inserted with no captain on purpose, which no amount of
    // data entry was ever going to clear. See `isEmptyPlaceholder`.
    applies: () => true,
    fails: r => blank(r.captain_id),
  },
  {
    id: 'no_client_account',
    label: 'Not linked to an account',
    help: 'No `client_id`, so the survey hangs off a text label only.',
    why: 'The account is the key, not the label: `client` is stale free text that splits one account across as many as nine spellings. Anything grouped by account misses this survey entirely.',
    group: 'ownership',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'client_id',
      lookup: true,
      entry: 'the account name (Claude resolves it to the client record)',
      current: r => r.client,
    }],
    // Measured 0 live (2026-09-28) — and worth keeping at 0, which is the whole
    // point of a tile that reads zero.
    applies: () => true,
    fails: r => blank(r.client_id),
  },
  {
    id: 'no_requested_by',
    label: 'No requested-by contact',
    help: 'Nobody recorded as the person at the client who asked for this survey.',
    why: 'The Occam onboarding gate, the delivery email and the contact pages all run off this. Without it we cannot say who the deliverable goes to.',
    group: 'ownership',
    severity: 'medium',
    sources: [],
    fields: [{
      column: 'requested_by_name',
      entry: "the contact's full name (Claude links it to the client contact record)",
      current: r => r.requested_by_name,
    }],
    // Measured 2026-09-28: 149 live (+49 waves) / 19 in the default scope (+39
    // waves). The largest ownership gap in the book by some way.
    applies: () => true,
    fails: r => blank(r.requested_by_contact_id) && blank(r.requested_by_name),
  },

  /* ── DATES ──────────────────────────────────────────────────────────── */
  {
    id: 'no_due_date',
    label: 'No due date',
    help: 'No date the client was promised.',
    why: 'On-time delivery, the calendar and every "what is late" flag are computed against this date. A survey without one can never be late and never appears in a risk list.',
    group: 'dates',
    severity: 'high',
    sources: [],
    fields: [date('due_date', r => r.due_date)],
    // Excuses pre-sale deals ONLY — a survey on hold is still counted, and the
    // reason is written out on `sold` above (8 live holds carry no due date, 3
    // of them in the default scope). Measured 2026-09-28: 76 live (+31 waves) of
    // the 404 it applies to / 12 in the default scope (+26 waves) of 228.
    applies: sold,
    fails: r => blank(r.due_date),
  },
  {
    id: 'no_submitted_date',
    label: 'No submitted date',
    help: 'No date the survey was accepted into operations. Repeat waves are excluded — a wave is spawned, not submitted.',
    why: 'Cycle time is submitted-to-delivered. Without this date the survey is missing from every turnaround figure, which is how an average silently describes half the book.',
    group: 'dates',
    severity: 'medium',
    sources: [],
    fields: [date('submitted_date', r => r.submitted_date)],
    // David named this one "excluding reruns" himself. Measured 2026-09-28: 130
    // live of the 276 non-rerun surveys it applies to / 6 in the default scope —
    // almost entirely a legacy-import gap, which is what the scope toggle is for.
    applies: r => !isRerunWave(r) && sold(r),
    fails: r => blank(r.submitted_date),
  },
  {
    id: 'no_launch_date',
    label: 'No launch date',
    help: 'The survey has been fielded — it reached Fielding, has responses, or has blast/panel rows — but no launch date is recorded.',
    why: 'Days-in-field, the calendar and the rerun cadence all start from the launch date. It is also the only way to tell a study that ran fast from one that sat.',
    group: 'dates',
    severity: 'medium',
    sources: ['blasts', 'suppliers', 'launches'],
    fields: [date('launch_date', r => r.launch_date)],
    // A launch date means nothing for a survey still in Doc Programming, so this
    // asks for EVIDENCE that it launched rather than reading the column cold.
    // Measured 2026-09-28: it applies to 365 of the 417 live surveys — the 52 it
    // does not ask are the false positives a bare null check would have produced
    // — and 123 of them fail (+53 waves) / 3 in the default scope (+43 waves).
    applies: (r, ctx) => reached(r, 'Fielding') || (r.n_collected ?? 0) > 0 || hasFieldRows(ctx, r),
    fails: r => blank(r.launch_date),
  },
  {
    id: 'no_deliver_date',
    label: 'Delivered, no delivery date',
    help: 'The survey reached the Delivery column but carries no delivery date at all — not even the automatic stamp.',
    why: 'A delivered survey with no date cannot be placed in any month, so it is missing from every period comparison and makes an earlier quarter look thinner than it was.',
    group: 'dates',
    severity: 'high',
    sources: [],
    fields: [date('deliver_date', r => r.deliver_date)],
    // Measured 2026-09-28: 68 delivered surveys have no deliver_date, but 26 of
    // them DO carry the automatic `delivered_at` stamp, which is a date a machine
    // can copy across — see `deliver_date_only_stamped` below. This tile is the
    // 42 that need a person (40 live +2 waves; 0 in the default scope).
    // Splitting them is what makes both numbers reachable.
    applies: isDelivered,
    fails: r => blank(r.deliver_date) && blank(r.delivered_at),
  },
  {
    id: 'deliver_date_only_stamped',
    label: 'Delivery date only auto-stamped',
    help: 'The survey has the automatic `delivered_at` timestamp but the `deliver_date` column is empty.',
    why: 'Nothing is lost — the date exists — but every report reads `deliver_date`, so these surveys sit outside the month they belong to until the stamp is copied across. No typing required: this one is machine-fixable.',
    group: 'dates',
    severity: 'low',
    sources: [],
    // The stamp rides along READ-ONLY. The whole claim of this tile is that the
    // date already exists, and a worksheet that said "fill in deliver_date"
    // without showing `delivered_at` would send a person to open 27 surveys one
    // at a time to read the value they are copying.
    fields: [
      {
        column: 'delivered_at',
        readOnly: true,
        entry: 'nothing — this is the automatic stamp, shown so the date can be copied across',
        current: r => r.delivered_at,
      },
      date('deliver_date', r => r.deliver_date),
    ],
    // Measured 2026-09-28: 21 live (+5 waves) / 0 in the default scope (+5
    // waves). Deliberately its own tile rather than folded into the one above:
    // mixing "we need you to remember a date" with "copy this field" makes a
    // 68-row tile that nobody can clear in an afternoon.
    applies: isDelivered,
    fails: r => blank(r.deliver_date) && !blank(r.delivered_at),
  },

  /* ── CLASSIFICATION ─────────────────────────────────────────────────── */
  {
    id: 'no_project_type',
    label: 'No survey type',
    help: 'Neither PS nor B2B (nor Rerun/Internal) is set.',
    why: 'Type decides which Money section the survey even has, which cost model applies and how it is priced. An untyped survey falls out of every by-type split.',
    group: 'classification',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'project_type',
      entry: 'PS, B2B, Rerun or Internal',
      current: r => r.project_type,
    }],
    // Measured 2026-09-28: 4 live (+6 waves) / 1 in the default scope (+6
    // waves). It read 19 in scope while the 12 untyped placeholder shells were
    // still being counted here.
    applies: () => true,
    fails: r => blank(r.project_type),
  },
  {
    id: 'no_survey_tool_id',
    label: 'Past programming, no survey ID',
    help: 'The survey reached EdWin QA or later with no survey tool ID recorded.',
    why: 'The survey tool ID is how a PureSpectrum export, a supplier file or a blast report is matched back to this survey. Without it a reconciliation has nothing to join on and the survey silently takes no share of what was imported.',
    group: 'classification',
    severity: 'medium',
    sources: [],
    fields: [{
      column: 'survey_tool_id',
      entry: 'the survey ID, or several separated by commas',
      current: r => r.survey_tool_id,
    }],
    // A survey cannot be QA'd in Edwin without existing in the tool, so EdWin QA
    // is the first stage where this is certainly missing rather than merely
    // absent. Measured 2026-09-28: it applies to 358 of the 417 live surveys;
    // 131 fail (+57 waves) / 12 in the default scope (+46 waves).
    applies: r => reached(r, 'EdWin QA'),
    fails: r => toolIds(r).length === 0,
  },
  {
    id: 'shared_survey_tool_id',
    label: 'Survey ID claimed by two surveys',
    help: 'A survey tool ID on this row also appears on another survey.',
    why: 'Any import keyed on that ID lands on both surveys, so one study’s responses and costs are counted twice and the other’s are wrong. It is the single most expensive kind of duplicate in this database.',
    group: 'classification',
    severity: 'high',
    sources: [],
    fields: [{
      column: 'survey_tool_id',
      entry: 'the ID list with the wrongly-claimed ID removed',
      current: r => r.survey_tool_id,
    }],
    // Measured 2026-09-28: 8 live surveys share an id (1 +7 waves), 1 +5 of them
    // in the default scope. Counted per SURVEY, not per id, so the tile counts
    // the rows a person has to open.
    applies: r => toolIds(r).length > 0,
    fails: (r, ctx) => toolIds(r).some(id => (ctx.toolIdOwners.get(id) ?? 0) > 1),
  },
  {
    id: 'repeated_survey_tool_id',
    label: 'Survey ID listed twice on one row',
    help: 'The same survey tool ID appears more than once inside this row’s own comma-separated list.',
    why: 'Harmless to read, but it makes the row look like two studies and doubles the ID in anything that splits the list without de-duplicating first.',
    group: 'classification',
    severity: 'low',
    sources: [],
    fields: [{
      column: 'survey_tool_id',
      entry: 'the ID list with the repeat removed',
      current: r => r.survey_tool_id,
    }],
    // Measured 2 live, both waves (2026-09-28).
    applies: r => toolIds(r).length > 1,
    fails: r => new Set(toolIds(r)).size !== toolIds(r).length,
  },

  /* ── MEASUREMENT ────────────────────────────────────────────────────── */
  {
    id: 'no_n_target',
    label: 'No N target',
    help: 'No N promised to the client, no maximum and no internal target.',
    why: 'Without a target there is nothing to measure delivery against: the survey cannot be behind, cannot over-deliver, and shows no progress bar anywhere.',
    group: 'measurement',
    severity: 'medium',
    sources: [],
    fields: [{
      column: 'n_target',
      entry: 'the N promised to the client, as a number',
      current: r => r.n_target,
    }],
    // All three targets are checked, so a survey scoped as a range (n_target_max)
    // or on an internal-only target is not accused of having none. The internal
    // one is read server-side and arrives as a set of ids — the value is
    // restricted from the sales tier and never crosses to the browser.
    // Measured 2026-09-28: 42 live (+37 waves) / 9 in the default scope (+32).
    applies: sold,
    fails: (r, ctx) => r.n_target == null && r.n_target_max == null && !ctx.hasInternalTarget.has(r.id),
  },
  {
    id: 'delivered_no_n_actual',
    label: 'Delivered, no final N',
    help: 'The survey was delivered without recording how many completes were actually handed over.',
    why: 'n_actual is what the client received. Every per-respondent figure, every "did we hit the target" answer and the whole delivered-N history are built on it.',
    group: 'measurement',
    severity: 'medium',
    sources: [],
    fields: [{
      column: 'n_actual',
      entry: 'the number of completes delivered',
      current: r => r.n_actual,
    }],
    // Measured 2026-09-28: 72 live (+34 waves) / 4 in the default scope (+25).
    // Many of those did collect responses, so the number is usually recoverable
    // from n_collected rather than lost.
    applies: isDelivered,
    fails: r => r.n_actual == null,
  },
  {
    id: 'fielded_no_completes',
    label: 'Fielded, no responses recorded',
    help: 'The survey reached Fielding or beyond and `n_collected` is still zero.',
    why: 'Either the survey collected nothing (which is a fielding problem somebody should know about) or nobody recorded what it collected. Both are worth a look; neither should be silent.',
    group: 'measurement',
    severity: 'low',
    sources: [],
    fields: [{
      column: 'n_collected',
      entry: 'the completes collected, as a number',
      current: r => r.n_collected,
    }],
    // Measured 2026-09-28: 25 live (+26 waves) / 1 in the default scope (+22).
    applies: r => reached(r, 'Fielding'),
    fails: r => !((r.n_collected ?? 0) > 0),
  },

  /* ── CONSISTENCY ────────────────────────────────────────────────────── */
  {
    id: 'fielding_before_stage',
    label: 'Fielding recorded before the stage says so',
    help: 'Blasts, panel launches or suppliers are recorded, but the survey is still sitting before Fielding on the board.',
    why: 'The board is what the team works from. A survey that has bought respondents while its card sits in Doc Programming is being worked in one place and tracked in another.',
    group: 'consistency',
    severity: 'high',
    sources: ['blasts', 'suppliers', 'launches'],
    fields: [{
      column: 'board_column',
      entry: 'the stage the survey is really at (Fielding, Data QA, Delivery …)',
      current: r => r.board_column,
    }],
    // David's eleventh check. Measured 1 live, a rerun wave (2026-09-28) — and
    // it moves during the day: a survey cancelled between two reads leaves it.
    applies: (r, ctx) => hasFieldRows(ctx, r),
    fails: r => !reached(r, 'Fielding'),
  },
  {
    id: 'closed_never_delivered',
    label: 'Closed without ever being delivered',
    help: 'Status is Closed but the survey never reached the Delivery column, and it was not cancelled.',
    why: 'A finished survey reads Delivered. These read as neither delivered nor live, so they are counted as neither — they vanish from the delivered book and from the pipeline at the same time.',
    group: 'consistency',
    severity: 'medium',
    sources: [],
    fields: [
      { column: 'board_column', entry: 'Delivery if it was delivered; otherwise leave blank', current: r => r.board_column },
      // All four legal statuses are offered (migrations 002/012). Offering only
      // 'Cancelled' left a row that was neither delivered nor called off with no
      // expressible fix, so it round-tripped as no change and stayed on the tile.
      {
        column: 'status',
        entry: 'Cancelled if it was called off, Open or Hold if it is still live, otherwise leave blank',
        current: r => r.status,
      },
    ],
    // Measured 2026-09-28: 20 live (+7 waves) / 0 in the default scope (+3).
    // Almost all legacy imports with no delivery date at all, which is why they
    // end up in this state.
    applies: () => true,
    fails: r => r.status === 'Closed' && !isDelivered(r),
  },
  {
    id: 'delivered_before_submitted',
    label: 'Delivered before it was submitted',
    help: 'The delivery date is earlier than the submitted date.',
    why: 'Cycle time comes out negative, so the survey is thrown out of the turnaround figures rather than counted. One of the two dates is simply a typo.',
    group: 'consistency',
    severity: 'medium',
    sources: [],
    fields: [
      date('submitted_date', r => r.submitted_date),
      date('deliver_date', r => r.deliver_date),
    ],
    // Measured 2026-09-28: 0 live surveys and 4 rerun waves.
    applies: r => !blank(r.submitted_date) && !blank(r.deliver_date),
    fails: r => (r.deliver_date as string) < (r.submitted_date as string),
  },
  {
    id: 'launched_before_submitted',
    label: 'Launched before it was submitted',
    help: 'The launch date is earlier than the submitted date.',
    why: 'A survey cannot go into field before it was accepted into operations. One of the two dates is wrong, and both feed the cycle-time and calendar views.',
    group: 'consistency',
    severity: 'low',
    sources: [],
    fields: [
      date('submitted_date', r => r.submitted_date),
      date('launch_date', r => r.launch_date),
    ],
    // Measured 2026-09-28: 1 live (+1 wave).
    applies: r => !blank(r.submitted_date) && !blank(r.launch_date),
    fails: r => (r.launch_date as string) < (r.submitted_date as string),
  },
  {
    id: 'flag_longitudinal_contradicted',
    label: 'Repeat wave not flagged longitudinal',
    help: 'The survey is part of a rerun series, is a later wave, or has a rerun date — yet `longitudinal` is false.',
    why: 'On a survey with no series, `longitudinal` plus `rerun_date` IS the auto-spawn: the nightly cron reads exactly that pair (app/api/cron/spawn-reruns), so a due repeat study with the flag off is one that will simply never produce its next wave, and nobody finds out until the wave is not there.',
    group: 'consistency',
    severity: 'medium',
    sources: [],
    fields: [{
      column: 'longitudinal',
      entry: 'TRUE if this really is a repeat study; otherwise fix the series link instead',
      current: r => r.longitudinal,
    }],
    // THE FLAG CHECK, and it is deliberately NOT "no flags set".
    //
    // David asked for "surveys without at least one tag selected", meaning
    // longitudinal / row_level_data / occam. Measured: all three columns are
    // NEVER null — they default to false — so "nobody has reviewed this" is
    // indistinguishable from "reviewed, and this survey genuinely has none". 243
    // of the 437 live surveys have none of the three true (2026-09-28). A tile
    // showing 243 that can never reach zero is the opposite of what he asked for.
    //
    // ── AND IT IS NARROWED TO THE ROWS WHERE THE FLAG DOES SOMETHING ────────
    // It first asked every repeat wave for the flag, which was both make-work
    // and self-refilling: lib/reruns/series.ts `nextWaveInherit` returns no
    // `longitudinal` key, so every auto-spawned wave takes the column default
    // (false, migration 009) and is born failing — the tile could be driven to 0
    // and be non-zero the next morning. And the edit changed no behaviour: the
    // series path never reads the flag (lib/reruns/spawn.ts `isLegacyEligible`
    // returns false when `series_id != null`, the cron filters `.is('series_id',
    // null)`, and lib/reruns/seriesOps.ts says "`longitudinal` is deliberately
    // left alone — it describes the study, and on its own it spawns nothing").
    //
    // A survey with a rerun_date and NO series is the one place the flag is
    // still load-bearing, so that is the only place this asks for it. A row in a
    // series is driven by the series record; fix the series link, not the flag.
    // Measured 2026-09-28: it applies to 2 live surveys and 0 fail — where it
    // used to accuse 89 series waves that the spawner never reads the flag for.
    applies: r => blank(r.series_id) && !blank(r.rerun_date),
    fails: r => r.longitudinal !== true,
  },
  {
    id: 'flag_longitudinal_unsupported',
    label: 'Flagged longitudinal, no repeat anywhere',
    help: '`longitudinal` is true but the survey is in no series, is wave 1, and has no rerun date.',
    why: 'The reverse of the check above, and it fails the same way: the rerun radar has nothing to schedule, so the study looks managed and never repeats.',
    group: 'consistency',
    severity: 'low',
    sources: [],
    fields: [{
      column: 'rerun_date',
      entry: 'the date the next wave is due — or set longitudinal FALSE if it is not a repeat study',
      current: r => r.rerun_date,
    }],
    // Measured 2026-09-28: 7 live, of the 65 flagged longitudinal.
    applies: r => r.longitudinal === true,
    fails: r => !isRerunWave(r) && blank(r.rerun_date),
  },
  {
    id: 'flag_occam_not_onboarded',
    label: 'Occam delivered, contact never invited',
    help: 'An Occam survey was delivered and the requested-by contact is not marked as invited to Occam — or there is no contact on the row to check.',
    why: 'The onboarding gate exists so that no client gets an Occam deliverable before they have an Occam account. Either the invite went out and was never recorded, or a client is holding a link they cannot open — and a delivered Occam survey with nobody recorded as having received it is the strongest version of the same gap.',
    group: 'consistency',
    severity: 'medium',
    sources: ['contacts'],
    // The field to set lives on the CONTACT, not the survey — which is why the
    // worksheet carries `requested_by` as a context column: it names the person
    // whose record changes.
    fields: [
      // Named first because it is the fix for the harder half: an Occam
      // deliverable with no contact at all has nobody to invite until this is
      // filled in.
      {
        column: 'requested_by_name',
        entry: "the contact who received it — only needed where this cell is empty",
        current: r => r.requested_by_name,
      },
      {
        column: 'client_contacts.occam_invited',
        entry: 'TRUE once the Occam invite has actually been sent to that contact',
        // Blank where there is no contact to speak for, rather than the word
        // "No" — nobody said no; there is nobody to ask.
        current: r => (blank(r.requested_by_contact_id) ? '' : false),
      },
    ],
    // The only evidence-backed `occam` contradiction available. Measured
    // 2026-09-28: 41 delivered Occam surveys, 14 of them failing (7 +7 waves),
    // and 4 of those 14 are the ones with NO resolvable contact — they used to
    // fall out of `applies` entirely and appeared on no tile, in no count and in
    // no blocked note, which is the strongest version of the gap disappearing
    // rather than reporting itself. The reverse — a contact marked invited on a
    // survey with occam false — is NOT a contradiction: the invite was earned by
    // a different survey, and flagging it would put 47 correct rows on the
    // dashboard.
    applies: r => r.occam === true && isDelivered(r),
    fails: (r, ctx) =>
      blank(r.requested_by_contact_id) ||
      ctx.contacts.get(r.requested_by_contact_id as string) !== true,
  },
  {
    id: 'spend_not_recomputed',
    label: 'Costs recorded, total never updated',
    help: 'The survey has blast, panel or cost rows that add up to something, while its stored total is zero.',
    why: 'The stored total is maintained by a trigger. Zero against non-empty child rows means the trigger did not fire, so every roll-up that reads the stored figure is short by this survey. No amount is shown here — this dashboard is about completeness, not value.',
    group: 'consistency',
    severity: 'high',
    sources: ['blasts', 'suppliers', 'costs'],
    // NOTHING TO TYPE, so nothing to type into. An editable column headed
    // `actual_spend` would go out in a file, be edited a week later by somebody
    // who no longer has the sentence beside the download button, and come back
    // as a hand-written figure in a trigger-maintained money column — on the one
    // dashboard built to carry no money. The remedy is prose instead.
    fields: [],
    remedy: 'Nothing to type. Re-save any cost, blast or supplier row on the survey and the trigger recomputes the stored total; or ask Claude to run reconcile_project on these codes.',
    // Measured 0 live (2026-09-28), against the 150 surveys whose child rows add
    // up to anything. Deliberately gated on the child rows adding up to MORE THAN
    // NOTHING: several surveys have child rows and a zero total, but their rows
    // are themselves zero, which is consistent rather than broken. The one row
    // that used to appear here was an artefact of the connector's own copy of the
    // spend formula charging for email sends the app makes free (migration 112);
    // both surfaces call `spendOf` now.
    applies: (r, ctx) => facts(ctx, r).recordsSpend,
    fails: (r, ctx) => facts(ctx, r).spendIsZero,
  },
  {
    id: 'empty_placeholder_wave',
    label: 'Placeholder wave with nothing behind it',
    help: 'The row is flagged `is_placeholder` and holds no blast, panel, launch or cost row, no responses and no final N — a shell the rerun spawner created ahead of time.',
    why: 'It is not work: the finance hub leaves it out of every figure, and it cannot be given a captain, a type or a target because there is no study behind it. Left in the book it reads as a survey that never ran, and it is what keeps ten other tiles off zero. Clear it by deleting the shell or by entering the wave it stands for — not by filling anything in.',
    group: 'consistency',
    severity: 'medium',
    // Every child read, because "empty" is a claim about all four of them.
    sources: ['blasts', 'suppliers', 'launches', 'costs'],
    fields: [],
    remedy: 'Nothing to type. Either delete the shell, or enter the wave it stands for and clear `is_placeholder` — ask Claude and hand back this list of codes.',
    // THE ONE CHECK THESE ROWS ARE HELD TO. Every other check excuses them (see
    // `isEmptyPlaceholder`), which is what makes those tiles reachable; this one
    // is reachable too, because a person really can delete or reconcile a shell.
    // Measured 2026-09-28: 22 rows carry `is_placeholder`; 20 of them are empty
    // and all 20 are rerun waves inside the default scope. The other 2 hold real
    // data (PR00352, PR00344) and are checked like any other survey.
    placeholders: true,
    applies: (r, ctx) => isEmptyPlaceholder(r, ctx),
    fails: () => true,
  },
]

export function checkById(id: string): CleanupCheck | null {
  return CHECKS.find(c => c.id === id) ?? null
}

/* ── RUNNING ────────────────────────────────────────────────────────────── */

export interface CleanupInput {
  /** Live surveys: `deleted_at` null and NOT cancelled. Both exclusions belong
   *  to the loader, because a cancelled survey is not a data gap — it is a
   *  survey that stopped, and demanding a launch date for it would put twelve
   *  permanently-unfixable rows on a dashboard whose whole point is reaching 0. */
  projects: CleanupRow[]
  fielding?: ReadonlyMap<string, FieldFacts>
  contacts?: ReadonlyMap<string, boolean>
  /** Ids of the surveys carrying an `n_internal_target`. Read server-side; the
   *  value itself is restricted and never travels. */
  internalTargets?: Iterable<string>
  /** Reads that failed. Their checks report `available: false`, never 0. */
  blocked?: readonly CleanupSource[]
  today: string
  scope?: CleanupScope
}

export function buildContext(input: CleanupInput): CleanupContext {
  // Built across EVERY row handed in, in scope or not: an id shared with an
  // excluded legacy survey is still claimed twice.
  const owners = new Map<string, Set<string>>()
  for (const r of input.projects) {
    for (const id of new Set(toolIds(r))) {
      const set = owners.get(id) ?? new Set<string>()
      set.add(r.id)
      owners.set(id, set)
    }
  }
  const toolIdOwners = new Map<string, number>()
  for (const [id, set] of owners) toolIdOwners.set(id, set.size)

  return {
    fielding: input.fielding ?? new Map(),
    contacts: input.contacts ?? new Map(),
    hasInternalTarget: new Set(input.internalTargets ?? []),
    toolIdOwners,
    blocked: new Set(input.blocked ?? []),
    today: input.today,
  }
}

export interface CheckResult {
  check: CleanupCheck
  /**
   * False when a read this check depends on failed. `count`, `waveCount` and
   * the row lists are then all zero/empty and MUST NOT be drawn as a number —
   * the tile says which source is missing instead.
   */
  available: boolean
  blockedBy: CleanupSource[]
  /** How many in-scope surveys the check was meaningful for. The denominator. */
  applies: number
  /** Failing surveys that are NOT repeat waves. The actionable number. */
  rows: CleanupRow[]
  /** Failing surveys that ARE repeat waves, kept separate so the headline is
   *  the work a person would actually pick up, and nothing is hidden. */
  waves: CleanupRow[]
  count: number
  waveCount: number
}

export interface CleanupReport {
  results: CheckResult[]
  scope: CleanupScope
  /** Rows handed in (live surveys). */
  scanned: number
  /** Rows the scope kept. */
  inScope: number
  /** Rows the legacy-import exclusion removed. 0 when the toggle is on. */
  excludedLegacy: number
  /** Of the in-scope rows, how many are repeat waves. */
  waves: number
  blocked: CleanupSource[]
  today: string
  /** Every AVAILABLE check is at zero. A blocked check makes this false: we do
   *  not know that it is clean, so we do not say it is. */
  clean: boolean
  /** Failing in-scope surveys that are not waves, across every check. A survey
   *  failing three checks counts once. */
  surveysNeedingWork: number
}

/**
 * Run every check over the rows.
 *
 * One pass per check rather than one pass over the rows: the check list is
 * short, the row list is a few hundred, and keeping each check's own `applies`
 * and `fails` adjacent is what makes them auditable against the comments above.
 */
export function runCleanup(input: CleanupInput): CleanupReport {
  const scope = input.scope ?? DEFAULT_SCOPE
  const ctx = buildContext(input)
  const rows = input.projects.filter(r => inScope(r, scope))
  const blocked = [...ctx.blocked]

  const results: CheckResult[] = CHECKS.map(check => {
    const blockedBy = check.sources.filter(s => ctx.blocked.has(s))
    if (blockedBy.length > 0) {
      return { check, available: false, blockedBy, applies: 0, rows: [], waves: [], count: 0, waveCount: 0 }
    }
    // Empty placeholder shells are held back from every check but their own —
    // they were inserted with these fields null on purpose and no data entry
    // clears them. `isEmptyPlaceholder` says why, and reports false whenever a
    // child read failed, so a blocked source can never excuse a row by accident.
    const eligible = check.placeholders
      ? rows
      : rows.filter(r => !isEmptyPlaceholder(r, ctx))
    const scoped = eligible.filter(r => check.applies(r, ctx))
    const failing = scoped.filter(r => check.fails(r, ctx))
    const live: CleanupRow[] = []
    const waves: CleanupRow[] = []
    for (const r of failing) (isRerunWave(r) ? waves : live).push(r)
    byCode(live)
    byCode(waves)
    return {
      check, available: true, blockedBy: [], applies: scoped.length,
      rows: live, waves, count: live.length, waveCount: waves.length,
    }
  })

  const needing = new Set<string>()
  for (const res of results) for (const r of res.rows) needing.add(r.id)

  return {
    results,
    scope,
    scanned: input.projects.length,
    inScope: rows.length,
    excludedLegacy: input.projects.length - rows.length,
    waves: rows.filter(isRerunWave).length,
    blocked,
    today: input.today,
    clean: results.every(r => r.available && r.count === 0 && r.waveCount === 0),
    surveysNeedingWork: needing.size,
  }
}

/** Oldest survey first, by project code — the order a person works a list in,
 *  and stable, so an export taken twice is the same file twice. */
function byCode(rows: CleanupRow[]): void {
  rows.sort((a, b) =>
    (a.project_code ?? '￿').localeCompare(b.project_code ?? '￿') ||
    a.id.localeCompare(b.id))
}

/** The results for one group, in severity order then by size — so the tile that
 *  blocks the most work leads its section. Blocked checks sort first: an
 *  unknown is more urgent than a known small number. */
export function resultsByGroup(report: CleanupReport, group: CheckGroup): CheckResult[] {
  return report.results
    .filter(r => r.check.group === group)
    .sort((a, b) =>
      Number(a.available) - Number(b.available) ||
      SEVERITY_ORDER.indexOf(a.check.severity) - SEVERITY_ORDER.indexOf(b.check.severity) ||
      b.count - a.count ||
      a.check.label.localeCompare(b.check.label))
}

/** Every check a given survey fails, for the row's own detail view. */
export function checksFailedBy(report: CleanupReport, id: string): CleanupCheck[] {
  return report.results
    .filter(r => r.available && [...r.rows, ...r.waves].some(x => x.id === id))
    .map(r => r.check)
}

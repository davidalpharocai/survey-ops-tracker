/**
 * Everything the two client documents SAY — the Survey Activity Statement and
 * the Survey List — as pure, tested functions.
 *
 * WHY THIS IS NOT IN THE COMPONENTS. These pages leave the building: a
 * salesperson saves them as a PDF and sends them to a hedge fund, whose
 * portfolio manager reads every figure as a claim. The first version computed
 * its wording inline, per page, and the two pages disagreed with each other and
 * with the screen about what counted as delivered, what made a figure "at
 * least", and which day a survey was delivered on. One module, used by both
 * documents, is how they stop drifting.
 *
 * THE RULES IT HOLDS, each settled once:
 *
 *   - Dates are Eastern Time (dateRange.ts has the one conversion). A survey
 *     delivered at 9:53pm ET on 24 August prints as 24 August.
 *   - A status carries its own date: "Delivered / 18 Sep 2026", "In field /
 *     was due 23 Sep 2026". A promised date never sits under "Delivered".
 *   - Responses are Target | Final | Collected. Final is the post-QA count and
 *     exists only for a delivered survey; a count typed in while a survey is
 *     still in field is not final and is not printed as one.
 *   - A credit figure is a minimum only when an UNPRICED survey has DRAWN
 *     (credits.ts). "at least" / "at most" is printed on the figure itself, so
 *     no reading of it can drop the qualifier.
 *   - Client-facing stage names only. Internal tool names ("EdWin QA") never
 *     print.
 *   - NO DOLLARS. Nothing here reads or prints a price, budget, spend or
 *     internal target. Credits are counts, and counts are what sales may show.
 *
 * Nothing here reads the clock: `today` and `now` are arguments, because a
 * module that reads the clock cannot be tested at 11pm ET, which is where date
 * code is wrong.
 */
import { bucketOf } from './buckets'
import { hasDrawn, rollUp, currentTerm, consumptionFor, type Consumption, type Term } from './credits'
import { deliveredN, DELIVERY_STATS } from './deliveredN'
import { DATE_BASES, etDate, todayET, type DateBasis, type Range } from './dateRange'
import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import { fmtNum } from '@/lib/utils/number'
// Type only, deliberately: printColumns imports this module, and a value
// import back would make the pair a run-time cycle.
import type { Prints } from './printColumns'

export { etDate, todayET }

/** One survey as the documents need it. Every field is one the sales_projects
 *  view already exposes; nothing here is a dollar figure. */
export interface StatementRow {
  id: string
  project_code: string | null
  project_name: string
  board_column: string | null
  status: string | null
  phase: string | null
  n_target: number | null
  n_target_max: number | null
  n_collected: number | null
  n_actual: number | null
  credits: number | null
  term_id?: string | null
  submitted_date?: string | null
  launch_date?: string | null
  deliver_date: string | null
  delivered_at: string | null
  requested_by_name?: string | null
  client_id?: string | null
}

// ── Numbers and dates ──────────────────────────────────────────────────────

/** Whole numbers with separators. Credits and responses are counts. */
export const n0 = (v: number) => fmtNum(Math.round(v))

/** "2:43 pm ET". Built from parts because ICU now puts a narrow no-break space
 *  before PM, which a test (and a reader copying the line) trips over. */
export function timeET(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toLowerCase()} ET`
}

// A fixed month table rather than toLocaleDateString: ICU's en-GB short month
// for September became "Sept", which would have changed printed statements
// under us with no code change.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']
const ymd = (iso: string) => iso.slice(0, 10).split('-').map(Number)

/** "24 Sep 2026" */
export function fmtDay(iso: string): string {
  const [y, m, d] = ymd(iso)
  return `${d} ${MON[m - 1]} ${y}`
}
/** "24 September 2026" */
export function fmtDayLong(iso: string): string {
  const [y, m, d] = ymd(iso)
  return `${d} ${MONTH[m - 1]} ${y}`
}
/** "24 Sep" */
export function fmtDayNoYear(iso: string): string {
  const [, m, d] = ymd(iso)
  return `${d} ${MON[m - 1]}`
}

/** Whole days from `a` to `b` (ISO dates). Parsed at midday UTC so no offset
 *  can move either end across midnight. */
export function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 86_400_000)
}

/** A non-breaking space, spelled out: the literal character is invisible in an
 *  editor and is exactly the kind of thing a tidy-up replaces by accident. */
export const NBSP = String.fromCharCode(0xa0)

/** Non-breaking spaces, so "23 Sep 2026" and "(Part A)" never split over a line. */
export const nb = (s: string) => s.replace(/ /g, NBSP)

/** "A", "A and B", "A, B and C". */
export function listNames(xs: string[]): string {
  if (xs.length <= 1) return xs.join('')
  return xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
}

const plural = (n: number, one: string, many: string) => `${n0(n)} ${n === 1 ? one : many}`

/** "Delivered 1 Jul – 24 Sep 2026" — the filter, stated in the client's words.
 *  The year is dropped from the start only when both ends share it. */
export function describeRangeForClient(basis: DateBasis, range: Range): string {
  const label = DATE_BASES.find(b => b.id === basis)?.label ?? basis
  const { from, to } = range
  if (from && to) {
    const start = from.slice(0, 4) === to.slice(0, 4) ? fmtDayNoYear(from) : fmtDay(from)
    return `${label} ${start} – ${fmtDay(to)}`
  }
  if (from) return `${label} from ${fmtDay(from)}`
  if (to) return `${label} up to ${fmtDay(to)}`
  return 'All dates'
}

// ── Stage, in the client's words ───────────────────────────────────────────

export type Glyph = 'full' | 'half' | 'open' | 'hold' | 'cancel'
export type StageGroup = 'progress' | 'delivered' | 'stopped'
export interface ClientStage { label: string; glyph: Glyph; group: StageGroup }

export const GROUP_LABEL: Record<StageGroup, string> = {
  progress: 'In progress', delivered: 'Delivered', stopped: 'Paused or stopped',
}

/** The pipeline stages, renamed for a client. "EdWin QA" is an internal tool
 *  and "Doc Programming" is our jargon; neither means anything to a reader at
 *  a fund. Filled mark = delivered, half = collecting or in review, open = not
 *  yet in field. */
const PIPELINE: Record<string, [string, Glyph]> = {
  'Submitted': ['Received', 'open'],
  'Doc Programming': ['In design', 'open'],
  'Survey Programming': ['In programming', 'open'],
  'EdWin QA': ['In testing', 'open'],
  'Fielding': ['In field', 'half'],
  'Data QA': ['In quality review', 'half'],
}

/**
 * Where a survey is, for a client. Lifecycle first (bucketOf, so the documents
 * and the sales tiles cannot disagree about Delivered vs Closed), pipeline
 * position second.
 */
export function clientStage(p: Pick<StatementRow, 'status' | 'phase' | 'board_column'>): ClientStage {
  switch (bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column })) {
    case 'delivered': return { label: 'Delivered', glyph: 'full', group: 'delivered' }
    case 'hold': return { label: 'On hold', glyph: 'hold', group: 'stopped' }
    case 'cancelled': return { label: 'Cancelled', glyph: 'cancel', group: 'stopped' }
    case 'archived': return { label: 'Closed', glyph: 'cancel', group: 'stopped' }
    case 'scoping': return { label: 'Being scoped', glyph: 'open', group: 'progress' }
    case 'active': {
      const m = PIPELINE[p.board_column ?? ''] ?? ['In progress', 'open']
      return { label: m[0], glyph: m[1], group: 'progress' }
    }
  }
}

/**
 * The client word for a stage label as the sales screens write it (stageOf):
 * used to print a stage FILTER. The list's stage chips carry internal names,
 * and "Stages: EdWin QA" on a client document is the leak this whole module
 * exists to prevent.
 */
export function clientStageName(internal: string): string {
  if (PIPELINE[internal]) return PIPELINE[internal][0]
  if (internal === 'Delivered' || internal === 'Delivery') return 'Delivered'
  if (internal === 'Archived') return 'Closed'
  if (internal === 'On hold' || internal === 'Cancelled') return internal
  return 'Being scoped'
}

/** "Delivered surveys", for the list's Showing line. */
export function showingLabel(bucket: string): string {
  switch (bucket) {
    case 'active': return 'Active surveys'
    case 'delivered': return 'Delivered surveys'
    case 'scoping': return 'Surveys being scoped'
    case 'hold': return 'Surveys on hold'
    case 'cancelled': return 'Cancelled surveys'
    case 'archived': return 'Closed surveys'
    default: return 'All surveys'
  }
}

const stageIndex = (c: string | null | undefined) => STAGE_ORDER.indexOf((c ?? '') as BoardColumn)
const FIELDING = STAGE_ORDER.indexOf('Fielding')
const isDelivered = (p: StatementRow) => clientStage(p).group === 'delivered'

// ── Row helpers ────────────────────────────────────────────────────────────

/** The day a DELIVERED survey was delivered, in ET: the timestamp where the
 *  card recorded one, the promised date where it reached Delivery without.
 *  Null for anything not delivered, whatever it was promised for. */
export function deliveredOn(p: StatementRow): string | null {
  if (!isDelivered(p)) return null
  return etDate(p.delivered_at) ?? p.deliver_date ?? null
}

/** Sort key for "most recent delivery first": the instant where we have it,
 *  midday of the promised date where we do not. */
function deliveredMs(p: StatementRow): number | null {
  if (!isDelivered(p)) return null
  const t = p.delivered_at ? Date.parse(p.delivered_at) : NaN
  if (!Number.isNaN(t)) return t
  return p.deliver_date ? Date.parse(p.deliver_date + 'T16:00:00Z') : null
}

/** The line under a status: "18 Sep 2026", "was due 23 Sep 2026", "due 28 Sep
 *  2026", "no date yet", or "date not recorded" for a delivered survey with no
 *  date at all. Nothing for a cancelled or closed survey — a due date on dead
 *  work is not information. */
export function statusWhen(p: StatementRow, today: string): string {
  if (isDelivered(p)) {
    const d = deliveredOn(p)
    return d ? fmtDay(d) : 'date not recorded'
  }
  if (p.status === 'Cancelled' || p.status === 'Closed') return ''
  if (!p.deliver_date) return 'no date yet'
  return (p.deliver_date < today ? 'was due ' : 'due ') + fmtDay(p.deliver_date)
}

const GROUP_ORDER: Record<StageGroup, number> = { progress: 0, delivered: 1, stopped: 2 }

/**
 * One order for both documents, replacing each route's `.order()`:
 * in progress by due date (soonest first, undated last), then delivered, most
 * recent first (undated last), then paused or stopped. Ties by code, so the
 * order never depends on what the database happened to return.
 */
export function sortForStatement<T extends StatementRow>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const ga = GROUP_ORDER[clientStage(a).group], gb = GROUP_ORDER[clientStage(b).group]
    if (ga !== gb) return ga - gb
    if (ga === GROUP_ORDER.delivered) {
      const ta = deliveredMs(a), tb = deliveredMs(b)
      if (ta != null && tb != null && ta !== tb) return tb - ta
      if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1
    } else {
      const da = a.deliver_date ?? '9999', db = b.deliver_date ?? '9999'
      if (da !== db) return da.localeCompare(db)
    }
    return (a.project_code ?? '').localeCompare(b.project_code ?? '')
  })
}

/** "Title - Audience" → [title, audience]. Splits on the FIRST " - " only, and
 *  glues "(Part A)" together so it cannot break across lines. */
export function splitTitle(name: string): [string, string | null] {
  const fix = (s: string) => s.replace(/\(Part ([A-Z])\)/g, `(Part${NBSP}$1)`)
  const i = name.indexOf(' - ')
  return i < 0 ? [fix(name), null] : [fix(name.slice(0, i)), fix(name.slice(i + 3))]
}

export type FinalCell =
  | { kind: 'final'; value: number; below: boolean }
  | { kind: 'not-recorded' }
  | { kind: 'estimate'; value: number; low: number | null; high: number | null; basis: 'at-or-over-target' | 'short-of-target' }
  | { kind: 'none' }

export interface ResponseCells {
  /** "50", or "50–60" when a range was sold. Null when no target is set. */
  target: string | null
  final: FinalCell
  /** Null when there is nothing honest to print: never recorded, a survey that
   *  has not reached field and shows the column default of 0, or a delivered
   *  survey whose 0 sits beside a final count (see `clearedCollection`). */
  collected: number | null
}

/**
 * A delivered survey with a final count and 0 collected. Nothing delivers more
 * responses than it gathered, so the 0 is not a count: it is a collection that
 * was cleared, usually in the same edit that entered the final. PR00257's
 * audit, 2026-09-24: "n_collected: 23 -> 0" alongside "n_actual: 19 -> 20" —
 * which printed Final 20 beside Collected 0, on a page whose own note says
 * collection runs ABOVE the final count.
 */
export function clearedCollection(p: Pick<StatementRow, 'status' | 'phase' | 'board_column' | 'n_collected' | 'n_actual'>): boolean {
  return clientStage(p).group === 'delivered' && Number(p.n_actual ?? 0) > 0 && Number(p.n_collected ?? 0) === 0
}

/**
 * Target | Final | Collected for one row.
 *
 * `neverRecorded` is true when the n_collected freshness view has NO row for
 * this survey (migration 111): its count was never entered, so a 0 is the
 * column default, not a measurement. Pass false when freshness could not be
 * read — a failed read says nothing about the data.
 */
export function responseCells(p: StatementRow, neverRecorded: boolean): ResponseCells {
  const delivered = isDelivered(p)
  const target = p.n_target == null ? null
    : p.n_target_max != null && p.n_target_max !== p.n_target
      ? `${n0(p.n_target)}–${n0(p.n_target_max)}`
      : n0(p.n_target)

  let final: FinalCell = { kind: 'none' }
  if (delivered) {
    final = p.n_actual != null
      ? { kind: 'final', value: p.n_actual, below: p.n_target != null && p.n_actual < p.n_target }
      : { kind: 'not-recorded' }
  } else if (
    bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column }) === 'active' &&
    p.board_column === 'Data QA' && p.n_target != null && p.n_target > 0 &&
    // Nothing collected is nothing to estimate FROM. The short-of-target ratio
    // applied to 0 printed "≈ 0 est." against a 1,000 target (PR00486,
    // 2026-09-27), and the note then explained it as a measured projection.
    Number(p.n_collected ?? 0) > 0
  ) {
    // An estimate only while quality review is running and only from the two
    // branches that are measurements of past surveys. deliveredN's no-target
    // branch returns the raw collection labelled as a projection; printing
    // that as "≈ 481" would be a guess wearing a number's clothes.
    const d = deliveredN(p)
    if (d && d.estimated && (d.basis === 'at-or-over-target' || d.basis === 'short-of-target')) {
      final = { kind: 'estimate', value: d.value, low: d.low, high: d.high, basis: d.basis }
    }
  }

  const coll = Number(p.n_collected ?? 0)
  // A 0 with no freshness row is the column default, whether or not a final
  // count has been entered since. Tying this to "no final count" printed
  // PR00389 as Final 1,279, Collected 0 — a default passed off as a count.
  const never = neverRecorded && coll === 0
  const preField = !delivered && stageIndex(p.board_column) < FIELDING
  const collected = p.n_collected == null || never || clearedCollection(p) || (preField && coll === 0) ? null : coll
  return { target, final, collected }
}

/**
 * How many of these rows would print no response figure at all once the
 * Collected column is off.
 *
 * Final is a dash for everything before quality review — see responseCells:
 * an estimate needs Data QA, a positive target and something collected — so a
 * statement sent mid-engagement can show a client nothing but targets. That is
 * a reasonable document and it is also a surprising one, so the pre-send panel
 * says the number out loud and offers the tick that fills it in
 * (printColumns.choiceNotes).
 *
 * Counted from responseCells rather than from the stage, so it cannot disagree
 * with what the ledger actually draws.
 */
export function noResponseFigureCount(rows: StatementRow[], neverRecorded: Set<string>): number {
  return rows.reduce((n, p) => {
    const c = responseCells(p, neverRecorded.has(p.id))
    // `collected` is what the column WOULD print; a row with nothing there
    // gains nothing from ticking it on, so it is not part of the offer.
    return n + (c.final.kind === 'none' && c.collected != null ? 1 : 0)
  }, 0)
}

/** The printed text of a Final cell, for tests and for anywhere a plain string
 *  is wanted. The components render the same kinds with their marks. */
export function finalText(c: FinalCell): string {
  switch (c.kind) {
    case 'final': return n0(c.value)
    case 'not-recorded': return 'not recorded'
    case 'estimate': return `≈${NBSP}${n0(c.value)}`
    case 'none': return '—'
  }
}

export type CreditCell =
  | { kind: 'unpriced' }
  | { kind: 'committed'; credits: number }
  | { kind: 'drawn'; credits: number; offTerm: boolean }

/**
 * The Credits cell. Unpriced says so in words — it is not a zero. Priced but
 * not yet fielded is COMMITTED and kept out of every drawn total. Drawn credits
 * that do not count against the contract in force carry a † (`offTerm`): a
 * survey on an older contract, or on none, draws credits the contract figure
 * above does not include, and an unmarked number would make the ledger and the
 * contract panel look as if they disagree.
 */
export function creditCell(p: StatementRow, currentTermId: string | null): CreditCell {
  if (p.credits == null) return { kind: 'unpriced' }
  if (!hasDrawn(p)) return { kind: 'committed', credits: Number(p.credits) }
  return { kind: 'drawn', credits: Number(p.credits), offTerm: currentTermId != null && p.term_id !== currentTermId }
}

// ── Totals and phrases ─────────────────────────────────────────────────────

/**
 * How a DRAWN-credits total prints, wherever either document prints one — the
 * contract panel, the list's strip, the ledger's subtotals and total, the
 * period line and the notes. One rule, here, because each of those had its own
 * copy and only one of them knew the third case.
 *
 *   exact    — "410"
 *   floor    — "at least 410": an unpriced survey has drawn (credits.ts).
 *   unknown  — the only surveys that drew are unpriced, so nothing has been
 *              counted and the total reads 0. "At least 0" is true and tells
 *              a client nothing, and it reads as "nothing used". It prints
 *              "Not yet priced" (build notes 3B).
 */
export type DrawnFigure =
  | { kind: 'exact'; value: number }
  | { kind: 'floor'; value: number }
  | { kind: 'unknown' }

export function drawnFigure(c: Pick<Consumption, 'used' | 'isFloor'>): DrawnFigure {
  if (!c.isFloor) return { kind: 'exact', value: c.used }
  return c.used > 0 ? { kind: 'floor', value: c.used } : { kind: 'unknown' }
}

/** The printed words for an unknown drawn figure. */
export const NOT_YET_PRICED = 'Not yet priced'

/** "410", "at least 410" or "Not yet priced", as one plain string. */
export function drawnText(c: Pick<Consumption, 'used' | 'isFloor'>): string {
  const f = drawnFigure(c)
  return f.kind === 'unknown' ? NOT_YET_PRICED : `${f.kind === 'floor' ? 'at least ' : ''}${n0(f.value)}`
}

/**
 * The drawn-credits sentence for the surveys a page lists: "At least 316
 * credits drawn by the surveys listed below." and its unpriced clause, "2 of
 * them are not yet priced". Two parts so a component can set its footnote mark
 * after the clause it explains.
 */
export function drawnLine(c: Pick<Consumption, 'used' | 'isFloor' | 'unpricedDrawn'>): { head: string; unpriced: string | null } {
  const f = drawnFigure(c)
  const k = c.unpricedDrawn
  if (f.kind === 'unknown') {
    return {
      head: 'The credits drawn by the surveys listed below are not known yet:',
      unpriced: `${n0(k)} of them ${k === 1 ? 'has' : 'have'} drawn credits and ${k === 1 ? 'is' : 'are'} not yet priced`,
    }
  }
  return {
    head: `${f.kind === 'floor' ? 'At least ' : ''}${n0(c.used)} ${c.used === 1 ? 'credit' : 'credits'} drawn by the surveys listed below.`,
    unpriced: k ? `${n0(k)} of them ${k === 1 ? 'is' : 'are'} not yet priced` : null,
  }
}

export interface LedgerTotals extends Consumption {
  /** Delivered surveys with BOTH a target and a final count — the only set
   *  over which Target and Final can be totalled without mixing populations. */
  pairedN: number
  target: number
  final: number
  /** Of pairedN, how many met or beat target, and how many fell short. */
  met: number
  below: number
  /** Σ target over every row that has one — the in-progress subtotal. */
  targetAll: number
}

export function ledgerTotals(rows: StatementRow[]): LedgerTotals {
  const paired = rows.filter(p => isDelivered(p) && p.n_target != null && p.n_actual != null)
  const met = paired.filter(p => (p.n_actual as number) >= (p.n_target as number)).length
  return {
    ...rollUp(rows, null),
    pairedN: paired.length,
    target: paired.reduce((t, p) => t + Number(p.n_target), 0),
    final: paired.reduce((t, p) => t + Number(p.n_actual), 0),
    met,
    below: paired.length - met,
    targetAll: rows.filter(p => p.n_target != null).reduce((t, p) => t + Number(p.n_target), 0),
  }
}

/** "2 delivered surveys" / "1 survey already in field" / "3 surveys in field or
 *  delivered": the unpriced surveys that make a DRAWN figure a minimum, named
 *  by where they are. */
export function drawnUnpricedPhrase(rows: StatementRow[]): string {
  const u = rows.filter(p => p.credits == null && hasDrawn(p))
  const allDel = u.every(isDelivered), noneDel = !u.some(isDelivered)
  const where = allDel ? 'delivered ' : ''
  const tail = allDel ? '' : noneDel ? ' already in field' : ' in field or delivered'
  return `${u.length}${NBSP}${where}${u.length === 1 ? 'survey' : 'surveys'}${tail}`
}

/** "the two Market Study studies (Parts A and B)" for a Part A/Part B pair,
 *  else the titles listed. */
export function commonTitle(rows: StatementRow[]): string {
  const t = rows.map(p => splitTitle(p.project_name)[0].replace(new RegExp(`\\s*\\(Part${NBSP}[A-Z]\\)$`), ''))
  return rows.length === 2 && t[0] === t[1] && t[0] !== splitTitle(rows[0].project_name)[0]
    ? `the two ${t[0]} studies (Parts${NBSP}A and${NBSP}B)`
    : listNames(rows.map(p => splitTitle(p.project_name)[0]))
}

// ── The contract position ──────────────────────────────────────────────────

export interface Meter {
  /** Positions on one 0–100 scale, 1.1× the larger of allowance and drawn, so
   *  an overage has room to show instead of being clamped. */
  allowPos: number
  usedPos: number
  /** Null when the term has no renewal date, so no length to be through. */
  termPos: number | null
}

export interface StatementFigures {
  term: Term | null
  c: Consumption
  /** The rows the figures are computed from: the term's, or all of them. */
  scoped: StatementRow[]
  unpricedDrawnRows: StatementRow[]
  dayOf: number | null
  termDays: number | null
  elapsedPct: number | null
  meter: Meter | null
  /** True when nothing priced has drawn but something unpriced has: the drawn
   *  figure is unknown, and prints as "Not yet priced", never "at least 0". */
  notPriced: boolean
  captions: {
    /** Cluster heading and its aside. */
    heading: string
    aside: string
    /** "At least 109% of the 375 allowed." */
    pct: string | null
    /** "2 delivered surveys are not yet priced" — footnoted and closed by the
     *  component, so the mark sits where it belongs. */
    unpriced: string | null
    /** describeConsumption's settled committed clause. */
    committed: string | null
    /** Why there is no balance, when there is none. */
    noBalance: string | null
  }
  balance: {
    label: 'Balance' | 'Remaining'
    qualifier: 'at most' | null
    /** "(35)" over the allowance; "340" under it. */
    figure: string
    caption: string
  } | null
}

/**
 * The client-voice replacement for describeConsumption, on paper.
 *
 * The contract panel is a fact about the CONTRACT IN FORCE, over every survey
 * attached to it — never about the date range the reader picked. Only the
 * Activity panel follows the filter. Mixing the two is how "35 over" became
 * "46 remaining" when someone chose This quarter.
 */
export function statementFigures({ rows, terms, today }: {
  rows: StatementRow[]; terms: Term[]; today: string
}): StatementFigures {
  const term = currentTerm(terms, today)
  const scoped = term ? rows.filter(p => p.term_id === term.id) : rows
  const c = term ? consumptionFor(term, rows) : rollUp(rows, null)
  const unpricedDrawnRows = scoped.filter(p => p.credits == null && hasDrawn(p))
  const notPriced = drawnFigure(c).kind === 'unknown'

  let dayOf: number | null = null, termDays: number | null = null, elapsedPct: number | null = null
  if (term?.starts_on) {
    dayOf = daysFrom(term.starts_on, today) + 1
    // renews_on is the EXCLUSIVE end (the renewal day belongs to the next
    // term), so the length is simply the difference. "day 179 of 364".
    termDays = term.renews_on ? daysFrom(term.starts_on, term.renews_on) : null
    elapsedPct = termDays && termDays > 0 ? Math.min(100, Math.max(0, ((dayOf - 1) / termDays) * 100)) : null
  }

  const committed = c.committed > 0
    ? `A further ${n0(c.committed)} ${c.committed === 1 ? 'credit is' : 'credits are'} priced on ${
        plural(c.committedCount, 'survey', 'surveys')} that ${c.committedCount === 1 ? 'has' : 'have'} not fielded yet, so ${
        c.committedCount === 1 ? 'it is' : 'they are'} committed but not drawn.`
    : null
  const unpriced = c.isFloor
    ? `${drawnUnpricedPhrase(scoped)} ${c.unpricedDrawn === 1 ? 'is' : 'are'} not yet priced`
    : null

  const base = { term, c, scoped, unpricedDrawnRows, dayOf, termDays, elapsedPct, notPriced }

  if (!term) {
    return {
      ...base, meter: null, balance: null,
      captions: {
        heading: 'No contract in force', aside: 'All surveys on the account',
        pct: null, unpriced, committed,
        noBalance: 'No contract covers today’s date, so there is no allowance or balance to show.',
      },
    }
  }

  const heading = term.name
  const aside = term.renews_on
    ? `Renews ${fmtDay(term.renews_on)} · day ${dayOf} of ${termDays}`
    : `From ${fmtDay(term.starts_on as string)} · no renewal date`
  const total = c.total

  if (total == null || total <= 0) {
    return {
      ...base, meter: null, balance: null,
      captions: {
        heading, aside, pct: null, unpriced, committed,
        noBalance: 'This contract has no credit allowance recorded, so there is no balance to show.',
      },
    }
  }

  const remaining = c.remaining as number
  const balance: StatementFigures['balance'] = remaining < 0
    ? {
        label: 'Balance', qualifier: null, figure: `(${n0(-remaining)})`,
        caption: `${c.isFloor ? 'At least ' : ''}${n0(-remaining)} ${-remaining === 1 ? 'credit' : 'credits'} beyond the allowance.`,
      }
    : {
        label: 'Remaining', qualifier: c.isFloor ? 'at most' : null, figure: n0(remaining),
        caption: `${c.isFloor ? 'At most ' : ''}${n0(remaining)} of the ${n0(total)} credits left to draw.`,
      }

  // No meter while the drawn figure is unknown: a bar at 0% with "≥" beside it
  // draws a claim the numbers cannot support.
  let meter: Meter | null = null
  if (!notPriced) {
    const scaleMax = 1.1 * Math.max(total, c.used)
    const allowPos = (total / scaleMax) * 100
    meter = {
      allowPos,
      usedPos: (c.used / scaleMax) * 100,
      termPos: elapsedPct == null ? null : allowPos * (elapsedPct / 100),
    }
  }

  return {
    ...base, meter, balance,
    captions: {
      heading, aside, unpriced, committed, noBalance: null,
      pct: notPriced || c.pct == null ? null
        : `${c.isFloor ? 'At least ' : ''}${Math.round(c.pct)}% of the ${n0(total)} allowed.`,
    },
  }
}

// ── The activity panel ─────────────────────────────────────────────────────

export interface ActivityFigures {
  total: number
  delivered: number
  /** "2 in field", "2 in design" — every other client label, in ledger order. */
  others: string[]
  t: LedgerTotals
  /** Only when a date range is set: the settled line, "At least N credits
   *  drawn by the surveys listed below." (drawnLine). Never a share of the
   *  allowance — a period's usage over a lifetime allowance is the bug this
   *  replaced. */
  periodLine: string | null
}

export function activityFigures(rows: StatementRow[], range: Range | null): ActivityFigures {
  const counts = new Map<string, number>()
  for (const p of sortForStatement(rows)) {
    const l = clientStage(p).label
    counts.set(l, (counts.get(l) ?? 0) + 1)
  }
  const t = ledgerTotals(rows)
  const ranged = !!range && (range.from != null || range.to != null)
  let periodLine: string | null = null
  if (ranged) {
    const d = drawnLine(t)
    periodLine = d.unpriced ? `${d.head} ${d.unpriced}.` : d.head
  }
  return {
    total: rows.length,
    delivered: counts.get('Delivered') ?? 0,
    others: [...counts].filter(([l]) => l !== 'Delivered').map(([l, n]) => `${n0(n)} ${l.toLowerCase()}`),
    t,
    periodLine,
  }
}

// ── The page footer ────────────────────────────────────────────────────────

export type DocKind = 'statement' | 'list'
export type DocMode = 'client' | 'internal'

export const DOC_TITLE: Record<DocKind, string> = {
  statement: 'Survey Activity Statement', list: 'Survey List',
}

/** The words in the printed page footer, left and right. The right one is
 *  followed by the page counters in CSS. Internal prints never say "Prepared
 *  for": a multi-account list sent to a client would hand them other clients'
 *  work, and the footer is the last thing that can say so on every page. */
export function footerText({ doc, mode, name, accounts, today }: {
  doc: DocKind; mode: DocMode; name: string; accounts: number; today: string
}): { left: string; right: string } {
  const left = mode === 'internal'
    ? `AlphaROC  ·  Internal  ·  covers ${plural(accounts, 'account', 'accounts')}, not for sending to a client`
    : `AlphaROC  ·  Confidential  ·  Prepared for ${name}`
  return { left, right: `${DOC_TITLE[doc]}  ·  ${fmtDayLong(today)}  ·  Page ` }
}

/** The PDF's default filename: Chrome's Save as PDF names the file after the
 *  document title. */
export function documentTitle({ doc, mode, name, today }: {
  doc: DocKind; mode: DocMode; name: string; today: string
}): string {
  return mode === 'internal'
    ? `${DOC_TITLE[doc]} - Internal - ${today}`
    : `${name} - ${DOC_TITLE[doc]} - ${today}`
}

/**
 * A value as a CSS string literal, for `content:` in the page-margin boxes.
 * The client name is typed by a person and ends up inside a stylesheet: a
 * quote would end the string, a backslash would escape the next character, a
 * newline would end the declaration, and "<" could close the style element.
 */
export function cssString(s: string): string {
  return '"' + String(s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3C ') + '"'
}

// ── Before it is sent ──────────────────────────────────────────────────────

export interface PreSendCheck {
  id: string
  /** Bold lead — the surveys the item is about. */
  lead?: string
  text: string
}

/**
 * What to settle with sales before the document goes to a client, in order.
 * Screen-only; none of this prints. The print dialog opens by itself only when
 * this list is empty.
 *
 * AN ITEM MAY ONLY QUOTE WHAT THE CHOSEN DOCUMENT SAYS. Several items end by
 * naming the figure or date the page will carry — "The statement prints those
 * dates" — and the salesperson now chooses what prints (printColumns). With
 * Status unticked no date prints on any row, and with Credits and the contract
 * summary both off no credit figure prints at all, so `prints` decides whether
 * each of those closing sentences is said. It cannot put a wrong figure in
 * front of a client, but an item that sends someone to fix something that is
 * not on the page wastes the one read that catches the real problems.
 *
 *   1. Unpriced and already drawn (on the contract in force, or on the list).
 *   2. Due before the contract began, yet attached to it.
 *   3. Delivered more than 60 days after the due date.
 *   4. Priced and drawn with no dates at all, with the what-if figure.
 *   5. In progress and past its due date.
 *   6. A final count entered on a survey that is not delivered.
 *      6a. Delivered, with a collected count missing or below the final.
 *      6b. In quality review with no responses collected on record.
 *   7. Active surveys attached to no contract.
 *   8. Contracts with no start date or no allowance.
 *   9. No client-facing name set.
 *  10. List only: internal mode.
 */
export function preSendChecks({
  rows, printed = rows, terms, term, today, nameSet, internalName, doc, mode, accounts = 0, neverRecorded, prints,
}: {
  /** Every row the contract position is computed from (the statement), or the
   *  listed rows (the list). */
  rows: StatementRow[]
  /** The rows the table actually prints, when a date range narrows it. The
   *  row-level items (3, 5, 6) quote what the page will print, so they must
   *  not name a survey that is not on it. Defaults to `rows`. */
  printed?: StatementRow[]
  terms: Term[]
  term: Term | null
  today: string
  nameSet: boolean
  internalName?: string | null
  doc: DocKind
  mode: DocMode
  /** How many accounts the rows cover — used by the internal-mode item. */
  accounts?: number
  /** Rows whose n_collected was never recorded (no freshness row), so item 6a
   *  can say "never entered" rather than "probably cleared". Leave it out
   *  when freshness could not be read: the item then says "probably". */
  neverRecorded?: Set<string>
  /** What this print will carry (printColumns.printsOf). Left out, every
   *  column and section prints, which is the system default. */
  prints?: Prints
}): PreSendCheck[] {
  const out: PreSendCheck[] = []
  const word = doc === 'statement' ? 'statement' : 'list'
  /** Does the chosen document carry this part? Everything, when none was given. */
  const shows = (k: keyof Prints) => (prints ? prints[k] : true)
  // Credits reach a statement through the Credits column or the contract
  // summary, and a list through the Credits column alone.
  const showsCredits = doc === 'statement' ? shows('credits') || shows('contract') : shows('credits')
  const one = <T>(xs: unknown[], a: T, b: T) => (xs.length === 1 ? a : b)
  const code = (p: StatementRow) => p.project_code ?? 'a survey with no code'
  const ref = (p: StatementRow) => `${splitTitle(p.project_name)[0]} (${code(p)})`
  const inTerm = term ? rows.filter(p => p.term_id === term.id) : []

  // 1. Unpriced and already drawn — the reason the figure says "at least".
  if (doc === 'statement') {
    const pool = term ? inTerm : rows
    const u = pool.filter(p => p.credits == null && hasDrawn(p))
    if (u.length) {
      out.push({
        id: 'unpriced-drawn', lead: listNames(u.map(ref)),
        text: `${one(u, 'has', 'have')} drawn credits${term ? ` under the ${term.name}` : ''} but ${one(u, 'is', 'are')} not priced.${
          showsCredits
            ? ` The statement will say “${drawnText(rollUp(pool, null))}” for the credits drawn.`
            : ''} Price ${one(u, 'it', 'them')} and the credits drawn are exact.`,
      })
    }
  } else {
    const u = rows.filter(p => p.credits == null && hasDrawn(p))
    if (u.length) {
      out.push({
        id: 'unpriced-drawn', lead: listNames(u.map(code)),
        text: `${one(u, 'is', 'are')} listed and not priced${
          showsCredits
            ? `, so the list says “${drawnText(rollUp(rows, null))}” for the credits drawn`
            : ''}. Price ${one(u, 'it', 'them')} and the credits drawn are exact.`,
      })
    }
  }

  // 2. Due before the contract began, yet attached to it.
  if (term?.starts_on) {
    const starts = term.starts_on
    const early = inTerm.filter(p => p.deliver_date && p.deliver_date < starts)
    if (early.length) {
      const dates = [...new Set(early.map(p => p.deliver_date as string))].sort()
      const gap = daysFrom(dates[0], starts)
      const when = dates.length === 1
        ? `${one(early, 'was', 'were')} due ${fmtDay(dates[0])}, ${plural(gap, 'day', 'days')} before the ${term.name} began`
        : `were due before the ${term.name} began (the earliest ${fmtDay(dates[0])}, ${plural(gap, 'day', 'days')} before)`
      out.push({
        id: 'before-term', lead: listNames(early.map(code)),
        text: `${when}, yet ${one(early, 'is', 'are')} attached to it. Confirm the contract.`,
      })
    }
  }

  // 3. Delivered long after the due date — often the day a card was moved,
  //    not the day the work went out.
  const late = printed
    .map(p => ({ p, on: isDelivered(p) && p.delivered_at && p.deliver_date ? etDate(p.delivered_at) : null }))
    .filter((x): x is { p: StatementRow; on: string } => !!x.on && daysFrom(x.p.deliver_date as string, x.on) > 60)
  if (late.length) {
    const gap = Math.min(...late.map(x => daysFrom(x.p.deliver_date as string, x.on)))
    const months = Math.floor(gap / 30.44)
    out.push({
      id: 'late-delivery', lead: listNames(late.map(x => code(x.p))),
      text: `show${late.length === 1 ? 's' : ''} delivery on ${listNames(late.map(x => fmtDayNoYear(x.on)))}, more than ${
        months >= 2 ? `${months} months` : `${gap} days`} after ${one(late, 'its', 'their')} due date. That may be the day the card was moved, not the day the work went out.${
        // The dates print in the Status column; with it off, none of them does.
        shows('status') ? ` The ${word} prints ${one(late, 'that date', 'those dates')}.` : ''}`,
    })
  }

  // 4. Priced and drawn, with no date of any kind — and what the contract
  //    figure would be without it.
  if (doc === 'statement' && term) {
    for (const p of inTerm.filter(x => x.credits != null && hasDrawn(x) &&
      !x.delivered_at && !x.deliver_date && !x.launch_date && !x.submitted_date)) {
      const missing = ['no dates', p.n_target == null ? 'no target' : '', p.n_actual == null ? 'no final count' : ''].filter(Boolean)
      let text = `has ${listNames(missing)}, but its ${n0(Number(p.credits))} credits count toward the contract.`
      if (term.credits_total != null && term.credits_total > 0) {
        const w = rollUp(inTerm.filter(x => x.id !== p.id), term.credits_total)
        text += ` Without it: ${n0(w.used)} of ${n0(term.credits_total)} (${Math.round(w.pct as number)}%${
          (w.remaining as number) < 0 ? `, ${n0(-(w.remaining as number))} over` : ''}).`
      }
      out.push({ id: `no-dates-${p.id}`, lead: ref(p), text })
    }
  }

  // 5. In progress and past due.
  for (const p of printed.filter(x => clientStage(x).group === 'progress' && x.deliver_date && x.deliver_date < today)) {
    const d = fmtDay(p.deliver_date as string)
    out.push({
      id: `past-due-${p.id}`, lead: ref(p),
      text: `is ${clientStage(p).label.toLowerCase()} and was due ${d}. ${
        shows('status') ? `The ${word} prints “was due ${d}”; update` : 'Update'} the due date if it has moved.`,
    })
  }

  // 6. A final count typed in before delivery.
  for (const p of printed.filter(x => !isDelivered(x) && x.n_actual != null)) {
    out.push({
      id: `mid-final-${p.id}`, lead: code(p),
      text: `has a final count of ${n0(p.n_actual as number)} entered while it is still ${clientStage(p).label.toLowerCase()}${
        p.n_collected != null ? ` (${n0(p.n_collected)} collected)` : ''}. A count recorded before delivery is not final, so the ${word} does not print it.`,
    })
  }

  // 6a. Delivered, with a collected count that cannot be right beside its
  //     final: 0 (never entered, or cleared when the final went in) or below
  //     it. The final is taken from what was collected, so collected should
  //     never be the smaller number. Measured 2026-09-27: 4 of 211 delivered
  //     surveys, one of them on the statement this module was built against.
  for (const p of printed.filter(x => isDelivered(x) && Number(x.n_actual ?? 0) > 0 && Number(x.n_collected ?? 0) < Number(x.n_actual))) {
    const fin = n0(Number(p.n_actual)), coll = Number(p.n_collected ?? 0)
    // "prints a dash under Collected" only while that column is on the page.
    const dash = shows('collected') ? `, so the ${word} prints a dash under Collected` : ''
    out.push({
      id: `collected-below-final-${p.id}`, lead: code(p),
      text: coll > 0
        ? `shows ${n0(coll)} collected but ${fin} final. The final count comes from the responses collected, so the collected count is probably out of date. Correct it before sending.`
        : neverRecorded?.has(p.id)
          ? `has a final count of ${fin} but no collected count was ever entered${dash}. Enter the collected count if it is known.`
          : `shows ${fin} final but 0 collected. The collected count was probably cleared when the final was entered${dash}. Correct it before sending.`,
    })
  }

  // 6b. In quality review with nothing collected on record: there is nothing
  //     to estimate the final count from, so the Final cell stays a dash.
  for (const p of printed.filter(x => clientStage(x).group === 'progress' && x.board_column === 'Data QA' &&
    x.n_actual == null && Number(x.n_collected ?? 0) === 0)) {
    out.push({
      id: `qa-no-collection-${p.id}`, lead: ref(p),
      text: `is in quality review with no responses collected on record${
        // The estimate would sit in the Final column; with it off there is none.
        shows('final') ? `, so the ${word} shows no final estimate for it` : ''}. Enter the collected count before sending.`,
    })
  }

  // 7. Live work attached to no contract, while one is in force.
  if (doc === 'statement' && term) {
    const loose = rows
      .filter(p => !p.term_id && bucketOf({ status: p.status, phase: p.phase, board_column: p.board_column }) === 'active')
      .sort((a, b) => (a.project_code ?? '').localeCompare(b.project_code ?? ''))
    if (loose.length) {
      const drawn = loose.filter(hasDrawn)
      out.push({
        id: 'no-term', lead: listNames(loose.map(code)),
        text: `${one(loose, 'is', 'are')} not attached to any contract. ${drawn.length === 0
          ? `${one(loose, 'It has', 'They have')} drawn nothing yet; attach ${one(loose, 'it', 'them')} before ${one(loose, 'it fields', 'they field')}.`
          : `${drawn.length === loose.length ? one(loose, 'It has', 'They have') : `${n0(drawn.length)} of them ${drawn.length === 1 ? 'has' : 'have'}`} already fielded, so ${drawn.length === 1 ? 'its' : 'their'} credits are not counted against the ${term.name}. Attach ${one(loose, 'it', 'them')}.`}`,
      })
    }
  }

  // 8. Contracts that cannot be measured against.
  if (doc === 'statement') {
    for (const t of terms.filter(x => x.starts_on == null || x.credits_total == null)) {
      if (term && t.id === term.id) {
        out.push({
          id: `term-${t.id}`,
          text: `The ${t.name} has no credit allowance recorded, so ${
            // The balance is the contract summary's figure.
            shows('contract') ? 'the statement shows credits drawn but no balance' : 'there is no balance to measure the credits drawn against'}.`,
        })
        continue
      }
      const missing = t.starts_on == null && t.credits_total == null ? 'no dates and no allowance'
        : t.starts_on == null ? 'no start date' : 'no allowance'
      out.push({
        id: `term-${t.id}`,
        text: `A ${term ? 'second ' : ''}contract, “${t.name}”, has ${missing}${t.starts_on == null ? ', so it is ignored' : ''}.${
          term ? ` Remove it if it duplicates the ${term.name}.` : ''}`,
      })
    }
  }

  // 9. The client's own name.
  if (mode === 'client' && !nameSet) {
    out.push({
      id: 'no-name',
      text: `No client-facing name is saved for this account, so the ${word} will print its internal label${
        internalName ? `, “${internalName}”` : ''}. Type the client’s own name above. An analyst can save it on the client page (“Name as printed on client documents”) so it is filled in next time.`,
    })
  }

  // 10. A list that spans accounts is an internal document.
  if (doc === 'list' && mode === 'internal') {
    out.push({
      id: 'internal',
      text: `This list covers ${plural(accounts, 'account', 'accounts')}, so it prints marked Internal${
        shows('account') ? ', with an Account column,' : ''} and is not for sending to a client. Filter the list to one account to print it as a client document.`,
    })
  }

  return out
}

/** The bands the estimate cell draws on, for the note that explains it. */
export const ESTIMATE_BANDS = DELIVERY_STATS

/**
 * The name the document prints, and whether it counts as SET for check 9.
 *
 * Pre-filled from `display_name` (migration 122) when an analyst has saved one,
 * else the internal name. Typing overrides both for this print only. The
 * internal label left as it is does not count as set — that is the case the
 * check exists for — unless it was deliberately saved as the display name.
 */
export function printedName(typed: string, displayName: string | null | undefined, internalName: string): {
  name: string
  set: boolean
} {
  const t = typed.trim()
  const saved = displayName?.trim() || null
  return {
    name: t || saved || internalName,
    set: t !== '' ? t !== internalName.trim() || saved != null : saved != null,
  }
}

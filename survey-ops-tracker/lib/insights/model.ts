/**
 * The Insights dashboard, as a pure function: `buildInsightsModel(input)`.
 *
 * The page renders this model and computes nothing itself, so every figure on
 * it is unit-tested here (model.test.ts) against fixtures with the awkward
 * cases in them: an empty rerun placeholder, a delivered survey with no deliver
 * date, one with no due date, dates that run backwards, a partial month.
 *
 * ── WHICH SURVEYS COUNT ─────────────────────────────────────────────────────
 * One classifier, the finance hub's (lib/finance/lifecycle.ts `classify`),
 * checked in its order. Only the classifier is imported — never the finance
 * money code — so this page cannot reach a dollar figure by accident.
 *   · EMPTY placeholders are left out of everything: a rerun wave the system
 *     spawned ahead of time, with no blast, panel or cost row and no N, is not
 *     work anyone did (20 of them sat in "delivered" and would have inflated
 *     July by eight).
 *   · "Delivered" is the board's Delivery column — the same rule as the board,
 *     the sales pages and finance.
 *   · "In flight" is the classifier's live class: sold, open, not delivered,
 *     not on hold, not cancelled, not still being scoped. Hold and Scoping are
 *     counted beside it, never inside it.
 *   · Internal projects are not client surveys and are left out, as before.
 *
 * ── THE FILTERS ─────────────────────────────────────────────────────────────
 * The date range places a DELIVERED survey by its deliver date (see range.ts).
 * Type, captain and account apply to every figure on the page, including the
 * "right now" section — which ignores only the date, because work that is open
 * today is open whenever it started.
 */

import { classify, NO_ROWS, type FieldRowCounts, type FinClass } from '@/lib/finance/lifecycle'
import { isRerunProject } from '@/lib/reruns/isRerun'
import { sumNRange } from '@/lib/utils/nRange'
import { STAGE_DESCRIPTIONS, STAGE_ORDER } from '@/lib/utils/stage'
import { fmtNum } from '@/lib/utils/number'
import type { InsightsProject } from './load'
import {
  addDays, daysBetween, formatRange, inRange, isBounded, monthCoverage, monthKey, monthLong,
  monthNarrow, previousRange, resolveRange, runsToToday, trendMonths, type DateRange,
} from './range'
import { NO_CAPTAIN, TYPE_HELP, TYPE_KEYS, TYPE_LABEL, type InsightsFilter } from './filters'
import { buildHeadline } from './headline'
import { CYCLE_DAYS_GOAL, MIN_COMPARE_N, ON_TIME_GOAL } from './constants'

// The goals live in constants.ts (defined once); re-exported so the page
// imports everything it draws from one place.
export { CYCLE_DAYS_GOAL, MIN_COMPARE_N, ON_TIME_GOAL }

/* ── LIMITS ─────────────────────────────────────────────────────────────── */

/** "Delivered by account" lists this many accounts, then "and N more". */
export const ACCOUNT_TOP = 8
/** "Biggest deliveries" lists this many surveys. */
export const BIGGEST_TOP = 10
/** "Due soon" is due within this many days, today included (today to six
 *  days out) — the List's "due this week" rule, so the count here and the
 *  List it opens agree. */
export const DUE_SOON_DAYS = 7

/** The key a survey with no account recorded groups under. */
export const NO_ACCOUNT = 'none'

/* ── ITEMS ──────────────────────────────────────────────────────────────── */

export interface InsightsItem {
  p: InsightsProject
  cls: FinClass
  /** A TypeKey ('PS', 'B2B', 'Rerun', 'none'), or an unexpected type verbatim. */
  type: string
  captainId: string
  captainName: string
  accountId: string
  /** A repeat wave (lib/reruns/isRerun.ts): in a rerun series, a later wave,
   *  or the older Rerun type. */
  rerun: boolean
  /** Calendar days from submitted to delivered; null when a date is missing or
   *  the dates run backwards (a data error, counted separately). */
  cycleDays: number | null
  cycleBackwards: boolean
  /** Delivered on or before the due date. null when either date is missing. */
  onTime: boolean | null
  /** Only for a survey with NO deliver date: its due date, else its launch
   *  date, else its submitted date — roughly where it sits in time. Used only
   *  to ask whether a period is missing deliveries (see `undatedIn`), never to
   *  count the survey or put it on a chart. null when the survey has a deliver
   *  date, or no date at all. */
  likely: string | null
}

export const typeLabel = (k: string) => (TYPE_LABEL as Record<string, string>)[k] ?? k
export const typeHelp = (k: string) => (TYPE_HELP as Record<string, string>)[k] ?? `Surveys with the type ${k}.`

/** Classify every survey once. Empty placeholders and internal projects are
 *  dropped here, and counted, so the page can say what it left out. */
export function itemsOf(
  projects: InsightsProject[],
  rowCounts: Map<string, FieldRowCounts> | null,
): { items: InsightsItem[]; placeholders: number; internal: number } {
  const items: InsightsItem[] = []
  let placeholders = 0, internal = 0
  for (const p of projects) {
    if (p.project_type === 'Internal') { internal++; continue }
    const cls = classify(p, rowCounts?.get(p.id) ?? NO_ROWS)
    if (cls === 'placeholder') { placeholders++; continue }
    let cycleDays: number | null = null, cycleBackwards = false
    if (p.submitted_date && p.deliver_date) {
      const d = daysBetween(p.submitted_date, p.deliver_date)
      if (d < 0) cycleBackwards = true
      else cycleDays = d
    }
    items.push({
      p,
      cls,
      type: p.project_type ?? 'none',
      captainId: p.captain?.id ?? NO_CAPTAIN,
      captainName: p.captain?.name?.trim() || 'No captain',
      accountId: p.client_id ?? NO_ACCOUNT,
      rerun: isRerunProject(p),
      cycleDays,
      cycleBackwards,
      onTime: p.deliver_date && p.due_date ? p.deliver_date <= p.due_date : null,
      likely: p.deliver_date ? null : p.due_date ?? p.launch_date ?? p.submitted_date ?? null,
    })
  }
  return { items, placeholders, internal }
}

type Dim = 'type' | 'captain' | 'account'

/** Does an item pass the type / captain / account filters (leaving out any in
 *  `skip`, for option counts)? */
export function matchesDims(it: InsightsItem, f: InsightsFilter, skip: Dim[] = []): boolean {
  if (f.type && !skip.includes('type') && it.type !== f.type) return false
  if (f.captain && !skip.includes('captain') && it.captainId !== f.captain) return false
  if (f.account && !skip.includes('account') && it.accountId !== f.account) return false
  return true
}

/** Delivered surveys placed inside a range by their deliver date. */
export const deliveredIn = (items: InsightsItem[], r: DateRange) =>
  items.filter(it => it.cls === 'delivered' && inRange(it.p.deliver_date, r))

/* ── UNDATED DELIVERIES ─────────────────────────────────────────────────── */

/**
 * A delivered survey with no deliver date cannot be counted in any bounded
 * range, but it was still delivered — and most of these are sheet imports from
 * before June. So an earlier period's count can be LOW, and a comparison with
 * it would show a bigger rise than really happened (measured 27 Sep 2026:
 * Feb–May showed 61 deliveries while 25 more delivered surveys from then had
 * no deliver date).
 *
 * The page never guesses a deliver date. It uses the survey's other dates
 * (`likely`) to ask one question only: could the undated surveys that probably
 * belong to a period change the answer? A comparison, "the most since …" and
 * "a record" are claimed only when they could not.
 *
 * Only a bounded range can be missing them: All time already counts every
 * undated survey.
 */
export function undatedIn(delivered: InsightsItem[], r: DateRange): InsightsItem[] {
  if (!isBounded(r)) return []
  return delivered.filter(it => it.cls === 'delivered' && !it.p.deliver_date && it.likely != null && inRange(it.likely, r))
}

/** Undated deliveries by the month they probably belong to, and how many have
 *  no date of any kind (they could belong to any month) — for the headline's
 *  "the most since …" and "record" claims. */
export interface UndatedMonths {
  byMonth: Map<string, number>
  unplaced: number
}

export function undatedMonths(delivered: InsightsItem[]): UndatedMonths {
  const byMonth = new Map<string, number>()
  let unplaced = 0
  for (const it of delivered) {
    if (it.cls !== 'delivered' || it.p.deliver_date) continue
    if (!it.likely) { unplaced++; continue }
    const k = monthKey(it.likely)
    byMonth.set(k, (byMonth.get(k) ?? 0) + 1)
  }
  return { byMonth, unplaced }
}

/* ── MEASURES ───────────────────────────────────────────────────────────── */

const medianSorted = (s: number[]): number | null => {
  if (s.length === 0) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function median(xs: number[]): number | null {
  return medianSorted([...xs].sort((a, b) => a - b))
}

/** The lowest and highest the median of `xs` could be if `h` more values,
 *  unknown but never below 0, joined them. `hi` is Infinity when the unknowns
 *  could be the middle value. */
export function medianBounds(xs: number[], h: number): { lo: number | null; hi: number | null } {
  const s = [...xs].sort((a, b) => a - b)
  if (h <= 0) { const m = medianSorted(s); return { lo: m, hi: m } }
  return {
    lo: medianSorted([...Array<number>(h).fill(0), ...s]),
    hi: medianSorted([...s, ...Array<number>(h).fill(Infinity)]),
  }
}

/** Everything the tiles say about one set of delivered surveys. */
export interface Measure {
  delivered: number
  /** Respondents delivered: the sum of post-QA N (n_actual) where recorded. */
  respondents: number
  withN: number
  /** Delivered with no n_actual recorded — not counted as zero respondents. */
  withoutN: number
  /** Delivered with both a deliver and a due date: the on-time denominator. */
  judged: number
  onTime: number
  late: number
  /** Delivered with no due date — left out of on-time, and counted. */
  noDue: number
  /** Delivered with a due date but no deliver date (All time only). */
  noDeliverDate: number
  onTimePct: number | null
  cycleN: number
  cycleMedian: number | null
  /** Deliver date before the submitted date — a data error, left out. */
  cycleBackwards: number
  /** Missing a submitted or deliver date — left out of cycle time. */
  cycleMissing: number
  reruns: number
}

export function measure(set: InsightsItem[]): Measure {
  let respondents = 0, withN = 0, judged = 0, onTime = 0, noDue = 0, noDeliverDate = 0
  let cycleBackwards = 0, cycleMissing = 0, reruns = 0
  const cycles: number[] = []
  for (const it of set) {
    if (it.p.n_actual != null) { respondents += Number(it.p.n_actual); withN++ }
    if (it.onTime != null) { judged++; if (it.onTime) onTime++ }
    else if (!it.p.due_date) noDue++
    else noDeliverDate++
    if (it.cycleDays != null) cycles.push(it.cycleDays)
    else if (it.cycleBackwards) cycleBackwards++
    else cycleMissing++
    if (it.rerun) reruns++
  }
  return {
    delivered: set.length,
    respondents, withN, withoutN: set.length - withN,
    judged, onTime, late: judged - onTime, noDue, noDeliverDate,
    onTimePct: judged ? onTime / judged : null,
    cycleN: cycles.length, cycleMedian: median(cycles), cycleBackwards, cycleMissing,
    reruns,
  }
}

/* ── COMPARISONS ────────────────────────────────────────────────────────── */

export interface Comparison {
  /** 'unsure': both sides are big enough, but the undated deliveries that
   *  probably belong to them could change the answer, so none is given. */
  state: 'none' | 'too-few' | 'unsure' | 'up' | 'down' | 'same'
  text: string
  /** Whether the move is the good direction for this figure. */
  tone: 'good' | 'bad' | 'neutral'
  /** The earlier figure is a count missing undated deliveries — a floor, so
   *  it reads "at least". */
  floor?: boolean
}

/** One side of a comparison: the figure as counted from dated surveys, the n
 *  it rests on, and — when some delivered surveys that probably belong to the
 *  period have no deliver date — the lowest (`lo`) and highest (`hi`) it could
 *  be with them, and how many of them could move it (`undated`). */
export interface Figure {
  value: number | null
  n: number
  lo?: number | null
  hi?: number | null
  undated?: number
}

/** The five compared figures of one period. `hidden` are the period's undated
 *  deliveries (`undatedIn`); each figure counts only those that could move IT
 *  — a survey with no due date could never change the on-time share. */
export function figuresOf(set: InsightsItem[], hidden: InsightsItem[]): {
  delivered: Figure; respondents: Figure; onTime: Figure; cycle: Figure; reruns: Figure
} {
  const m = measure(set)
  const hDue = hidden.filter(it => it.p.due_date).length
  const hSubmitted = hidden.filter(it => it.p.submitted_date).length
  const hWithN = hidden.filter(it => it.p.n_actual != null)
  const hRespondents = hWithN.reduce((s, it) => s + Number(it.p.n_actual), 0)
  const hReruns = hidden.filter(it => it.rerun).length
  const judgedAll = m.judged + hDue
  const cycle = medianBounds(set.flatMap(it => (it.cycleDays == null ? [] : [it.cycleDays])), hSubmitted)
  const resp = m.withN ? m.respondents : null
  return {
    delivered: { value: m.delivered, n: m.delivered, lo: m.delivered, hi: m.delivered + hidden.length, undated: hidden.length },
    respondents: { value: resp, n: m.withN, lo: resp, hi: resp == null ? null : resp + hRespondents, undated: hWithN.length },
    // Every undated survey with a due date late (lo) or on time (hi).
    onTime: {
      value: m.onTimePct, n: m.judged,
      lo: judgedAll ? m.onTime / judgedAll : null, hi: judgedAll ? (m.onTime + hDue) / judgedAll : null, undated: hDue,
    },
    cycle: { value: m.cycleMedian, n: m.cycleN, lo: cycle.lo, hi: cycle.hi, undated: hSubmitted },
    reruns: { value: m.reruns, n: m.reruns, lo: m.reruns, hi: m.reruns + hReruns, undated: hReruns },
  }
}

const undatedWords = (cur: number, prev: number) =>
  cur > 0 && prev > 0
    ? `${fmtNum(cur)} delivered survey${cur === 1 ? '' : 's'} in your dates and ${fmtNum(prev)} from then have no deliver date`
    : cur > 0
      ? `${plural(cur, 'delivered survey')} in your dates ${cur === 1 ? 'has' : 'have'} no deliver date`
      : `${plural(prev, 'delivered survey')} from then ${prev === 1 ? 'has' : 'have'} no deliver date`

/**
 * This period against the previous one, in words. Stated only when BOTH sides
 * rest on at least MIN_COMPARE_N surveys; otherwise "Too few to compare".
 * Equal means equal as printed, so 91.2% and 90.8% are both "91%" and "same".
 *
 * When either side has undated deliveries that could move the figure, the
 * direction is stated only if it holds at both extremes (this period at its
 * lowest still above the last at its highest, or the reverse); otherwise the
 * tile says why it does not compare. A count from a period with undated
 * deliveries is a floor, so it reads "at least" (`count`).
 */
export function compareFigures(
  cur: Figure,
  prev: Figure | null,
  o: { fmt: (v: number) => string; better: 'higher' | 'lower' | null; prevLabel: string | null; count?: boolean },
): Comparison {
  if (!prev || !o.prevLabel) return { state: 'none', text: 'No earlier period to compare', tone: 'neutral' }
  if (cur.n < MIN_COMPARE_N || prev.n < MIN_COMPARE_N || cur.value == null || prev.value == null) {
    return { state: 'too-few', text: `Too few to compare with ${o.prevLabel}`, tone: 'neutral' }
  }
  const a = o.fmt(cur.value), b = o.fmt(prev.value)
  const cu = cur.undated ?? 0, pu = prev.undated ?? 0
  let up: boolean
  if (cu === 0 && pu === 0) {
    if (a === b || cur.value === prev.value) return { state: 'same', text: `Same as ${o.prevLabel} (${b})`, tone: 'neutral' }
    up = cur.value > prev.value
  } else {
    const cLo = cur.lo ?? cur.value, cHi = cur.hi ?? cur.value
    const pLo = prev.lo ?? prev.value, pHi = prev.hi ?? prev.value
    const surelyUp = cLo != null && pHi != null && cLo > pHi
    const surelyDown = cHi != null && pLo != null && cHi < pLo
    if (!surelyUp && !surelyDown) {
      return { state: 'unsure', text: `Not compared with ${o.prevLabel}: ${undatedWords(cu, pu)} — enough to change the answer`, tone: 'neutral' }
    }
    if (a === b) return { state: 'same', text: `Same as ${o.prevLabel} (${b})`, tone: 'neutral' }
    up = surelyUp
  }
  const tone = o.better == null ? 'neutral' : (up === (o.better === 'higher') ? 'good' : 'bad')
  const floor = !!o.count && pu > 0
  return { state: up ? 'up' : 'down', text: `${up ? 'Up' : 'Down'} from ${floor ? 'at least ' : ''}${b} in ${o.prevLabel}`, tone, floor }
}

export const pctText = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
export const daysText = (v: number | null) =>
  v == null ? '—' : `${Number.isInteger(v) ? fmtNum(v) : v.toFixed(1)} day${v === 1 ? '' : 's'}`
const plural = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`

/* ── MONTHS ─────────────────────────────────────────────────────────────── */

export interface MonthRow {
  key: string
  /** What a chart's x AXIS prints: 'Sep', or 'Sep 26' when the window crosses
   *  a year. Narrow on purpose — see THE YEAR ON THE AXIS below. */
  short: string
  /** What a person reads: 'September 2026'. The tooltip title, the accessible
   *  summary, the data table and the drill heading all use this, so nothing
   *  is lost by drawing the narrow form on the axis. */
  long: string
  coverage: 'in' | 'partial' | 'out'
  /** The current month, still under way. */
  running: boolean
  byType: Record<string, number>
  total: number
  respondents: number
  withN: number
  onTime: number
  judged: number
  onTimePct: number | null
  cycleMedian: number | null
  cycleN: number
  reruns: number
  /** Delivered surveys with no deliver date whose due (else launch, else
   *  submitted) date is in this month — probably delivered around then, but
   *  NOT in the column, which counts dated deliveries only. */
  undated: number
}

/**
 * ── THE YEAR ON THE AXIS ────────────────────────────────────────────────────
 * When the window crosses a year, EVERY month label carries the year, not
 * just January.
 *
 * Marking only the year boundary is tempting — 'Oct 25, Nov, Dec, Jan 26,
 * Feb, …' reads well and is narrower. It fails wherever the axis has to thin
 * at all. Run the real thinner (components/charts/scale.ts fitAxisLabels)
 * over that set at the widths /insights actually renders the two trend charts
 * at, half of a md:grid-cols-2 in a max-w-6xl page: from a 318px panel (the
 * md breakpoint) up to a 500px one it keeps 'Oct 25, Jan 26, Mar, May, Jul,
 * Sep'. Three of the six drawn labels carry no year, and a reader asked to
 * name the Mar column has to work out which side of the Jan 26 it fell.
 * Above that the panel is capped at 534px and every month is named anyway,
 * so the year costs nothing there.
 *
 * With the year on every label the answer cannot be thinned away, and the
 * two-digit form keeps it affordable (monthNarrow in range.ts measures it) —
 * twelve 'Oct 25' labels fit that 534px panel, which twelve 'Oct 2025' ones
 * do not. A window inside one year drops the year altogether: every month in
 * it is in the one year the page's date range already names, and 'Sep' is
 * narrower still.
 */
function monthRows(dated: InsightsItem[], keys: string[], r: DateRange, today: string, undated: UndatedMonths): MonthRow[] {
  const by = new Map<string, InsightsItem[]>()
  for (const it of dated) {
    const k = monthKey(it.p.deliver_date as string)
    const a = by.get(k)
    if (a) a.push(it); else by.set(k, [it])
  }
  const crossesYear = keys.length > 0 && keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4)
  const thisMonth = monthKey(today)
  return keys.map(key => {
    const set = by.get(key) ?? []
    const m = measure(set)
    const byType: Record<string, number> = {}
    for (const it of set) byType[it.type] = (byType[it.type] ?? 0) + 1
    return {
      key,
      short: monthNarrow(key, crossesYear),
      long: monthLong(key, true),
      coverage: monthCoverage(key, r),
      running: key === thisMonth,
      byType,
      total: set.length,
      respondents: m.respondents,
      withN: m.withN,
      onTime: m.onTime,
      judged: m.judged,
      onTimePct: m.onTimePct,
      cycleMedian: m.cycleMedian,
      cycleN: m.cycleN,
      reruns: m.reruns,
      undated: undated.byMonth.get(key) ?? 0,
    }
  })
}

/* ── BREAKDOWNS ─────────────────────────────────────────────────────────── */

/**
 * A row in a breakdown chart.
 *
 * There is no short form of `label` here on purpose. The row charts on this
 * page name people, accounts and types, and a person's or a firm's name has
 * no shorter form that is still their name — "Alexandra W." and "Balyasny"
 * are guesses about what the name means. The chart does not need one either:
 * below 480px it prints the name on its own line above the bar, and above
 * that its label column runs to 38% of the panel (203px of the 534px half of
 * the Insights grid — max-w-6xl 1152, halved with a 16px gap, less the
 * card's border and padding — where "Alexandra Whitfield" measures 115px).
 * A name that does outgrow the column is cut with an ellipsis and carries
 * the full form as its title, which loses nothing.
 */
export interface GroupRow { key: string; label: string; count: number; share: number; help?: string }

function groupBy(set: InsightsItem[], key: (it: InsightsItem) => string, label: (it: InsightsItem) => string): GroupRow[] {
  const m = new Map<string, GroupRow>()
  for (const it of set) {
    const k = key(it)
    const g = m.get(k) ?? { key: k, label: label(it), count: 0, share: 0 }
    g.count++
    m.set(k, g)
  }
  const total = set.length
  return [...m.values()]
    .map(g => ({ ...g, share: total ? g.count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export interface BigRow {
  id: string
  code: string
  name: string
  account: string
  type: string
  respondents: number
  deliver: string | null
}

/* ── RIGHT NOW ──────────────────────────────────────────────────────────── */

export interface StageRow { stage: string; count: number; help: string }
export interface WorkloadRow { id: string; name: string; open: number; overdue: number }

export interface NowModel {
  inFlight: number
  hold: number
  scoping: number
  byStage: StageRow[]
  overdue: number
  dueSoon: number
  behind: number
  /** Responses collected so far, over the in-flight surveys WITH a target. */
  collected: number
  targetMin: number | null
  targetMax: number | null
  /** Collected against the MINIMUM target — the N we committed to. */
  collectionPct: number | null
  /** In-flight surveys with no N target, left out of the collection share,
   *  and the responses they hold. */
  untargeted: number
  untargetedCollected: number
  workload: WorkloadRow[]
  stageVerdict: string
  workloadVerdict: string
}

/** Stages an in-flight survey can sit in. Delivery is not one: a survey in
 *  the Delivery column is delivered, and counted up top. */
export const OPEN_STAGES = STAGE_ORDER.filter(s => s !== 'Delivery') as string[]

export const isOverdue = (it: InsightsItem, today: string) => !!it.p.due_date && it.p.due_date < today
export const isDueSoon = (it: InsightsItem, today: string) =>
  !!it.p.due_date && it.p.due_date >= today && it.p.due_date <= addDays(today, DUE_SOON_DAYS - 1)
export const isBehind = (it: InsightsItem) =>
  it.p.board_column === 'Fielding' && it.p.n_target != null && Number(it.p.n_collected ?? 0) < it.p.n_target

function buildNow(items: InsightsItem[], f: InsightsFilter, today: string): NowModel {
  const mine = items.filter(it => matchesDims(it, f))
  const open = mine.filter(it => it.cls === 'active')
  const stageCounts = new Map<string, number>()
  for (const it of open) {
    const s = OPEN_STAGES.includes(it.p.board_column ?? '') ? (it.p.board_column as string) : 'Other'
    stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1)
  }
  const byStage: StageRow[] = OPEN_STAGES.map(s => ({ stage: s, count: stageCounts.get(s) ?? 0, help: STAGE_DESCRIPTIONS[s] ?? s }))
  if (stageCounts.get('Other')) {
    byStage.push({ stage: 'Other', count: stageCounts.get('Other') as number, help: 'In a board column that is not one of the pipeline stages.' })
  }
  const wl = new Map<string, WorkloadRow>()
  for (const it of open) {
    const w = wl.get(it.captainId) ?? { id: it.captainId, name: it.captainName, open: 0, overdue: 0 }
    w.open++
    if (isOverdue(it, today)) w.overdue++
    wl.set(it.captainId, w)
  }
  const workload = [...wl.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))
  // The collection share is measured over the surveys that HAVE a minimum
  // target, on both lines: a survey with no target has nothing to be a share
  // of, and adding its responses to the top line with nothing below would
  // overstate the share. The ones left out are counted and named.
  const targeted = open.filter(it => it.p.n_target != null)
  const untargeted = open.filter(it => it.p.n_target == null)
  const collectedOf = (set: InsightsItem[]) => set.reduce((s, it) => s + Number(it.p.n_collected ?? 0), 0)
  const collected = collectedOf(targeted)
  // The portfolio target is a RANGE of ranges: sum the minimums, sum the
  // maximums. sumNRange mirrors migration 078's sync_segment_totals(), so this
  // and the per-project totals the database writes can never disagree.
  const target = sumNRange(targeted.map(it => it.p))
  const busiest = [...byStage].sort((a, b) => b.count - a.count)[0]
  const topLoad = workload[0]
  return {
    inFlight: open.length,
    hold: mine.filter(it => it.cls === 'hold').length,
    scoping: mine.filter(it => it.cls === 'scoping').length,
    byStage,
    overdue: open.filter(it => isOverdue(it, today)).length,
    dueSoon: open.filter(it => isDueSoon(it, today)).length,
    behind: open.filter(isBehind).length,
    collected,
    targetMin: target.min,
    targetMax: target.max,
    collectionPct: target.min && target.min > 0 ? collected / target.min : null,
    untargeted: untargeted.length,
    untargetedCollected: collectedOf(untargeted),
    workload,
    stageVerdict: open.length === 0
      ? 'Nothing is in flight in this view.'
      : `${busiest.stage} holds the most open work: ${plural(busiest.count, 'survey')} of ${fmtNum(open.length)}.`,
    workloadVerdict: !topLoad
      ? 'Nobody has open work in this view.'
      : topLoad.id === NO_CAPTAIN
        ? `${plural(topLoad.open, 'open survey has', 'open surveys have')} no captain — the biggest pile; each needs an owner.`
        : `${topLoad.name} carries the most open work: ${plural(topLoad.open, 'survey')}${topLoad.overdue ? `, ${fmtNum(topLoad.overdue)} overdue` : ''}.`,
  }
}

/* ── DRILLS ─────────────────────────────────────────────────────────────── */

/** What a clicked mark asks for. The drill's rows are chosen by THIS predicate,
 *  independently of the aggregate that drew the mark, and the panel checks the
 *  two agree — so a drill can never quietly list a different set. */
export type DrillQuery =
  | {
    kind: 'delivered'
    /** A calendar month ('2026-08'); when set, the month replaces the range. */
    month?: string
    captain?: string
    type?: string
    account?: string
    rerunOnly?: boolean
    /** Only surveys the on-time rule can judge. */
    judgedOnly?: boolean
    /** Only surveys with a cycle time. */
    cycleOnly?: boolean
    /** Only surveys with respondents recorded. */
    withN?: boolean
    /** Delivered surveys with NO deliver date instead: every one ('all'), or
     *  those whose due / launch / submitted date is in the range ('range'). */
    undated?: 'all' | 'range'
  }
  | {
    kind: 'open'
    stage?: string
    due?: 'overdue' | 'soon'
    behind?: boolean
    captain?: string
    /** Hold or Scoping instead of in-flight work. */
    cls?: 'hold' | 'scoping'
  }

export interface DrillRow {
  id: string
  code: string
  name: string
  account: string
  type: string
  captain: string
  stage: string
  deliver: string | null
  due: string | null
  onTime: boolean | null
  cycleDays: number | null
  respondents: number | null
  collected: number
  targetMin: number | null
  targetMax: number | null
  rerun: boolean
}

const accountOf = (it: InsightsItem, accounts: Map<string, string>) =>
  it.p.client_id ? accounts.get(it.p.client_id) ?? it.p.client ?? '(unknown account)' : 'No account recorded'

export function toDrillRow(it: InsightsItem, accounts: Map<string, string>): DrillRow {
  return {
    id: it.p.id,
    code: it.p.project_code ?? '—',
    name: it.p.project_name ?? '(untitled)',
    account: accountOf(it, accounts),
    type: typeLabel(it.type),
    captain: it.captainName,
    stage: it.cls === 'delivered' ? 'Delivered' : it.p.board_column ?? '—',
    deliver: it.p.deliver_date,
    due: it.p.due_date,
    onTime: it.onTime,
    cycleDays: it.cycleDays,
    respondents: it.p.n_actual,
    collected: Number(it.p.n_collected ?? 0),
    targetMin: it.p.n_target,
    targetMax: it.p.n_target_max,
    rerun: it.rerun,
  }
}

/** The surveys behind a mark, chosen from `items` by the query alone. */
export function drillRows(
  items: InsightsItem[], f: InsightsFilter, q: DrillQuery, today: string, accounts: Map<string, string>,
): DrillRow[] {
  const r = resolveRange(f.range, today)
  const picked = items.filter(it => {
    if (!matchesDims(it, f)) return false
    if (q.kind === 'delivered') {
      if (it.cls !== 'delivered') return false
      if (q.undated) {
        if (it.p.deliver_date) return false
        if (q.undated === 'range' && !(isBounded(r) && it.likely && inRange(it.likely, r))) return false
      } else if (q.month) { if (!it.p.deliver_date || monthKey(it.p.deliver_date) !== q.month) return false }
      else if (!inRange(it.p.deliver_date, r)) return false
      if (q.captain != null && it.captainId !== q.captain) return false
      if (q.type != null && it.type !== q.type) return false
      if (q.account != null && it.accountId !== q.account) return false
      if (q.rerunOnly && !it.rerun) return false
      if (q.judgedOnly && it.onTime == null) return false
      if (q.cycleOnly && it.cycleDays == null) return false
      if (q.withN && it.p.n_actual == null) return false
      return true
    }
    if (it.cls !== (q.cls ?? 'active')) return false
    if (q.stage != null) {
      const s = OPEN_STAGES.includes(it.p.board_column ?? '') ? it.p.board_column : 'Other'
      if (s !== q.stage) return false
    }
    if (q.due === 'overdue' && !isOverdue(it, today)) return false
    if (q.due === 'soon' && !isDueSoon(it, today)) return false
    if (q.behind && !isBehind(it)) return false
    if (q.captain != null && it.captainId !== q.captain) return false
    return true
  })
  const rows = picked.map(it => toDrillRow(it, accounts))
  // Delivered work newest first; open work by the deadline that bites first.
  if (q.kind === 'delivered') rows.sort((a, b) => (b.deliver ?? '').localeCompare(a.deliver ?? '') || a.code.localeCompare(b.code))
  else rows.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.code.localeCompare(b.code))
  return rows
}

/* ── FILTER OPTIONS ─────────────────────────────────────────────────────── */

export interface OptionRow { id: string; label: string; count: number; help?: string }

function options(items: InsightsItem[], f: InsightsFilter, r: DateRange, accounts: Map<string, string>) {
  const delivered = items.filter(it => it.cls === 'delivered' && inRange(it.p.deliver_date, r))
  const count = (dim: Dim, key: (it: InsightsItem) => string) => {
    const m = new Map<string, number>()
    for (const it of delivered) if (matchesDims(it, f, [dim])) m.set(key(it), (m.get(key(it)) ?? 0) + 1)
    return m
  }
  const tc = count('type', it => it.type)
  const present = new Set(items.map(it => it.type))
  const types: OptionRow[] = [
    ...TYPE_KEYS.filter(k => present.has(k) || f.type === k),
    ...[...present].filter(k => !(TYPE_KEYS as readonly string[]).includes(k)).sort(),
  ].map(k => ({ id: k, label: typeLabel(k), count: tc.get(k) ?? 0, help: typeHelp(k) }))

  const cc = count('captain', it => it.captainId)
  const capNames = new Map<string, string>()
  for (const it of items) if (!capNames.has(it.captainId)) capNames.set(it.captainId, it.captainName)
  if (f.captain && !capNames.has(f.captain)) capNames.set(f.captain, f.captain === NO_CAPTAIN ? 'No captain' : '(unknown captain)')
  const captains: OptionRow[] = [...capNames.entries()]
    .map(([id, label]) => ({ id, label, count: cc.get(id) ?? 0 }))
    // Real people alphabetically, "No captain" last — a picker is scanned for
    // a name, not ranked.
    .sort((a, b) => (a.id === NO_CAPTAIN ? 1 : 0) - (b.id === NO_CAPTAIN ? 1 : 0) || a.label.localeCompare(b.label))

  const ac = count('account', it => it.accountId)
  const withWork = new Set(items.map(it => it.accountId))
  const accts: OptionRow[] = [...accounts.entries()]
    .filter(([id]) => withWork.has(id) || f.account === id)
    .map(([id, label]) => ({ id, label, count: ac.get(id) ?? 0 }))
  if (f.account && !accounts.has(f.account)) accts.push({ id: f.account, label: f.account === NO_ACCOUNT ? 'No account recorded' : '(unknown account)', count: ac.get(f.account) ?? 0 })
  accts.sort((a, b) => a.label.localeCompare(b.label))
  return { types, captains, accounts: accts }
}

/* ── THE MODEL ──────────────────────────────────────────────────────────── */

export interface InsightsInput {
  projects: InsightsProject[]
  rowCounts: Map<string, FieldRowCounts> | null
  accounts: Map<string, string>
  filter: InsightsFilter
  /** Today in Eastern time, 'YYYY-MM-DD'. */
  today: string
}

export interface InsightsModel {
  filter: InsightsFilter
  today: string
  range: DateRange
  rangeLabel: string
  prevRange: DateRange | null
  prevLabel: string | null
  /** The chip every card prints: "Delivered · 1–27 Sep 2026 · PS · 46 surveys". */
  scope: string
  /** The same without the count, for a drill's population line. */
  scopeBase: string
  /** The type / captain / account filters in words, for chips and sentences. */
  filterWords: string[]
  captainName: string | null
  accountName: string | null
  cur: Measure
  prev: Measure | null
  compare: { delivered: Comparison; respondents: Comparison; onTime: Comparison; cycle: Comparison; reruns: Comparison }
  /** Delivered surveys (under the type / captain / account filters) with no
   *  deliver date. A bounded range cannot include them; All time counts them
   *  but no monthly chart can place them. */
  undatedDelivered: number
  /** Of those: how many probably belong to your dates and to the previous
   *  period (by due, else launch, else submitted date — see `undatedIn`), and
   *  how many have no date of any kind. `inRange` is 0 under All time, which
   *  already counts them all. */
  undated: { inRange: number; inPrev: number | null; unplaced: number }
  months: MonthRow[]
  /** The type keys drawn in the monthly chart, in legend order. */
  monthTypes: string[]
  byCaptain: GroupRow[]
  byType: GroupRow[]
  byAccount: GroupRow[]
  /** Accounts beyond ACCOUNT_TOP, and how many surveys they hold. */
  accountsMore: { accounts: number; surveys: number }
  biggest: BigRow[]
  now: NowModel
  excluded: { placeholders: number; internal: number }
  headline: string
  verdicts: {
    months: string
    onTime: string
    cycle: string
    captain: string
    type: string
    account: string
    biggest: string
  }
  options: ReturnType<typeof options>
  /** Every item that survived the classifier, for the drills. */
  items: InsightsItem[]
}

export function buildInsightsModel(input: InsightsInput): InsightsModel {
  const { filter: f, today, accounts } = input
  const { items, placeholders, internal } = itemsOf(input.projects, input.rowCounts)
  const range = resolveRange(f.range, today)
  const prevRange = previousRange(f.range, today)
  const rangeLabel = formatRange(range)
  const prevLabel = prevRange ? formatRange(prevRange) : null

  const mine = items.filter(it => matchesDims(it, f))
  const delivered = mine.filter(it => it.cls === 'delivered')
  const curSet = deliveredIn(delivered, range)
  const prevSet = prevRange ? deliveredIn(delivered, prevRange) : null
  const cur = measure(curSet)
  const prev = prevSet ? measure(prevSet) : null
  const undatedDelivered = delivered.filter(it => !it.p.deliver_date).length
  const curHidden = undatedIn(delivered, range)
  const prevHidden = prevRange ? undatedIn(delivered, prevRange) : null
  const undatedByMonth = undatedMonths(delivered)
  const curFig = figuresOf(curSet, curHidden)
  const prevFig = prevSet ? figuresOf(prevSet, prevHidden ?? []) : null

  const captainName = f.captain
    ? (f.captain === NO_CAPTAIN ? 'No captain' : items.find(it => it.captainId === f.captain)?.captainName ?? '(unknown captain)')
    : null
  const accountName = f.account
    ? (f.account === NO_ACCOUNT ? 'No account recorded' : accounts.get(f.account) ?? '(unknown account)')
    : null
  const filterWords = [
    ...(f.type ? [typeLabel(f.type)] : []),
    ...(captainName ? [`Captain: ${captainName}`] : []),
    ...(accountName ? [`Account: ${accountName}`] : []),
  ]
  const scopeBase = ['Delivered', rangeLabel, ...filterWords].join(' · ')
  const scope = `${scopeBase} · ${plural(cur.delivered, 'survey')}`

  // Every comparison sees the undated deliveries each side probably holds, and
  // is withheld when they could change its answer (see compareFigures).
  const compare = {
    delivered: compareFigures(curFig.delivered, prevFig?.delivered ?? null, { fmt: fmtNum, better: 'higher', prevLabel, count: true }),
    respondents: compareFigures(curFig.respondents, prevFig?.respondents ?? null, { fmt: fmtNum, better: 'higher', prevLabel, count: true }),
    onTime: compareFigures(curFig.onTime, prevFig?.onTime ?? null, { fmt: v => pctText(v), better: 'higher', prevLabel }),
    cycle: compareFigures(curFig.cycle, prevFig?.cycle ?? null, { fmt: v => daysText(v), better: 'lower', prevLabel }),
    reruns: compareFigures(curFig.reruns, prevFig?.reruns ?? null, { fmt: fmtNum, better: null, prevLabel, count: true }),
  }

  // ── months ──
  const dated = delivered.filter(it => it.p.deliver_date)
  const firstMonth = dated.length ? dated.map(it => monthKey(it.p.deliver_date as string)).sort()[0] : null
  const keys = trendMonths(range, today, firstMonth)
  const months = monthRows(dated, keys, range, today, undatedByMonth)
  const typeSet = new Set<string>()
  for (const m of months) for (const k of Object.keys(m.byType)) typeSet.add(k)
  const monthTypes = [
    ...TYPE_KEYS.filter(k => typeSet.has(k)),
    ...[...typeSet].filter(k => !(TYPE_KEYS as readonly string[]).includes(k)).sort(),
  ]
  // Every month on record (not just the window), for "the most since June".
  const allMonthCounts = new Map<string, number>()
  for (const it of dated) {
    const k = monthKey(it.p.deliver_date as string)
    allMonthCounts.set(k, (allMonthCounts.get(k) ?? 0) + 1)
  }

  // ── breakdowns ──
  const byCaptain = groupBy(curSet, it => it.captainId, it => it.captainName)
  const byType = groupBy(curSet, it => it.type, it => typeLabel(it.type)).map(g => ({ ...g, help: typeHelp(g.key) }))
  const allAccounts = groupBy(curSet, it => it.accountId, it => accountOf(it, accounts))
  const byAccount = allAccounts.slice(0, ACCOUNT_TOP)
  const rest = allAccounts.slice(ACCOUNT_TOP)
  const accountsMore = { accounts: rest.length, surveys: rest.reduce((s, g) => s + g.count, 0) }

  const biggest: BigRow[] = curSet
    .filter(it => it.p.n_actual != null)
    .sort((a, b) => Number(b.p.n_actual) - Number(a.p.n_actual) || (b.p.deliver_date ?? '').localeCompare(a.p.deliver_date ?? ''))
    .slice(0, BIGGEST_TOP)
    .map(it => ({
      id: it.p.id,
      code: it.p.project_code ?? '—',
      name: it.p.project_name ?? '(untitled)',
      account: accountOf(it, accounts),
      type: typeLabel(it.type),
      respondents: Number(it.p.n_actual),
      deliver: it.p.deliver_date,
    }))

  const now = buildNow(items, f, today)

  // ── verdicts: every card closes on a computed sentence with a verb ──
  const inView = months.filter(m => m.coverage !== 'out')
  const busiest = [...inView].sort((a, b) => b.total - a.total || b.key.localeCompare(a.key))[0]
  const monthsVerdict = !busiest || busiest.total === 0
    ? 'No surveys were delivered in your dates.'
    : inView.length === 1
      ? `${busiest.long}${busiest.running ? ' so far has' : ' had'} ${plural(busiest.total, 'delivered survey')}.`
      : `${busiest.long} was the busiest month in your range, with ${plural(busiest.total, 'survey')} delivered.`
  const judgedMonths = months.filter(m => m.coverage !== 'out' && m.judged > 0)
  const metOnTime = judgedMonths.filter(m => (m.onTimePct as number) >= ON_TIME_GOAL).length
  const soFar = (m: MonthRow) => `${m.long}${m.running ? ' so far' : ''}`
  const onTimeVerdict = judgedMonths.length === 0
    ? 'No delivered survey in your range has a due date to judge against.'
    : judgedMonths.length === 1
      ? `${soFar(judgedMonths[0])} ${metOnTime ? 'meets' : 'is below'} the ${pctText(ON_TIME_GOAL)} goal: ${fmtNum(judgedMonths[0].onTime)} of ${plural(judgedMonths[0].judged, 'survey')} on time.`
      : `On time met the ${pctText(ON_TIME_GOAL)} goal in ${fmtNum(metOnTime)} of ${plural(judgedMonths.length, 'month')} in your range.`
  const cycleMonths = months.filter(m => m.coverage !== 'out' && m.cycleMedian != null)
  const metCycle = cycleMonths.filter(m => (m.cycleMedian as number) <= CYCLE_DAYS_GOAL).length
  const goalDays = `${fmtNum(CYCLE_DAYS_GOAL)}-day`
  const cycleVerdict = cycleMonths.length === 0
    ? 'No delivered survey in your range has both a submitted and a deliver date.'
    : cycleMonths.length === 1
      ? `${soFar(cycleMonths[0])} has a median of ${daysText(cycleMonths[0].cycleMedian)}, ${metCycle ? 'within' : 'over'} the ${goalDays} goal.`
      : `The median was within the ${goalDays} goal in ${fmtNum(metCycle)} of ${plural(cycleMonths.length, 'month')} in your range.`
  const topCap = byCaptain[0]
  const captainVerdict = !topCap
    ? 'No surveys were delivered in this view.'
    : byCaptain.length === 1
      ? `All ${plural(topCap.count, 'survey')} in this view ${topCap.key === NO_CAPTAIN ? 'have no captain recorded' : `were captained by ${topCap.label}`}.`
      : topCap.key === NO_CAPTAIN
        ? `${plural(topCap.count, 'survey')} of ${fmtNum(cur.delivered)} have no captain recorded — the largest group.`
        : `${topCap.label} captained the most: ${fmtNum(topCap.count)} of ${plural(cur.delivered, 'survey')}.`
  const topType = byType[0]
  const typeVerdict = !topType
    ? 'No surveys were delivered in this view.'
    : `${topType.key === 'none' ? 'Surveys with no type set' : topType.key === 'Rerun' ? 'Surveys filed under the older Rerun type' : `${topType.label} surveys`} made up ${fmtNum(topType.count)} of ${fmtNum(cur.delivered)} (${pctText(topType.share)}).`
  const topAcct = byAccount[0]
  const accountVerdict = !topAcct
    ? 'No surveys were delivered in this view.'
    : `${topAcct.label} received the most: ${fmtNum(topAcct.count)} of ${plural(cur.delivered, 'survey')}${allAccounts.length > 1 ? `, across ${plural(allAccounts.length, 'account')} in all` : ''}.`
  const biggestVerdict = biggest.length === 0
    ? (cur.delivered === 0 ? 'No surveys were delivered in this view.' : 'None of the delivered surveys in this view has respondents recorded yet.')
    : `The largest, ${biggest[0].code}, delivered ${plural(biggest[0].respondents, 'respondent')}.`

  const headline = buildHeadline({
    filter: f,
    today,
    range,
    cur,
    prev,
    prevLabel,
    compareDelivered: compare.delivered,
    allMonthCounts,
    undatedMonths: undatedByMonth,
    captainName,
    accountName,
    typeKey: f.type,
    runsToToday: runsToToday(range, today),
  })

  return {
    filter: f, today, range, rangeLabel, prevRange, prevLabel, scope, scopeBase, filterWords, captainName, accountName,
    cur, prev, compare, undatedDelivered,
    undated: { inRange: curHidden.length, inPrev: prevHidden ? prevHidden.length : null, unplaced: undatedByMonth.unplaced },
    months, monthTypes, byCaptain, byType, byAccount, accountsMore, biggest, now,
    excluded: { placeholders, internal },
    headline,
    verdicts: {
      months: monthsVerdict, onTime: onTimeVerdict, cycle: cycleVerdict, captain: captainVerdict,
      type: typeVerdict, account: accountVerdict, biggest: biggestVerdict,
    },
    options: options(items, f, range, accounts),
    items,
  }
}

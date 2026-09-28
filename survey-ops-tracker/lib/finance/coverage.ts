/**
 * How much of the book each figure can see — per month, and from when.
 *
 * Every total on the finance page is a FLOOR: a survey with nothing logged adds
 * $0. Whether a floor is close to the truth depends on how many surveys carry
 * the field it is built from, and that changes month by month. This file
 * measures it, for the seven fields the page leans on, over DELIVERED surveys
 * placed by deliver date (then launch, then submitted — never delivered_at or
 * created_at, both of which carry bulk stamps). Empty rerun placeholders are
 * excluded: they are not surveys.
 *
 * ── THE RELIABILITY DATES ARE COMPUTED, NOT WRITTEN ─────────────────────────
 * The banner says "most reliable from …". Those dates used to be typed into the
 * copy, and a typed date cannot notice that David is backfilling client prices
 * back toward 1 June. So each date here is the FIRST MONTH FROM WHICH coverage
 * of a field STAYS at or above a named threshold through the latest month.
 * When the backfill lifts June's price coverage over the line, the banner moves
 * to June by itself, with no code change. The thresholds are named below and
 * printed in the banner's help text, so a reader can see what "reliable" means.
 *
 * ── RECOVERIES ARE BOOKED IN BATCHES ────────────────────────────────────────
 * Unclaimed blast rewards come back as negative cost lines, written in batches
 * (43 of them landed on two days in September). A month whose recoveries have
 * not been booked reads dearer than one whose have. So each month also says how
 * many of its rewarded blast surveys carry a recovery yet, and flags the month
 * as "recoveries pending" when too few do.
 */

import {
  buildIndex, finDate, isCredit, spendOf,
  type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier,
} from './hub'
import { classOf } from './lifecycle'
import { deliveredNOf, hasPrice } from './revenue'

export const COVERAGE_METRICS = [
  'cost', 'price', 'budget', 'postQaN', 'psPanelRows', 'b2bBlastRows', 'date',
] as const
export type CoverageMetric = typeof COVERAGE_METRICS[number]

/** Row labels and explainers for the heatmap, in its order. */
export const METRIC_LABEL: Record<CoverageMetric, { label: string; help: string }> = {
  cost: { label: 'Any recorded cost', help: 'The survey has at least one blast, panel purchase or cost line with money on it.' },
  price: { label: 'Client price', help: 'A price per N is recorded (a price of $0 counts — it is a real price).' },
  budget: { label: 'Budget', help: 'A budget (the most we planned to spend) is recorded.' },
  postQaN: { label: 'Delivered N (after QA)', help: 'The number of respondents the client received after QA is recorded (on a segmented survey whose own figure is blank, every segment has one).' },
  psPanelRows: { label: 'Panel rows on PS surveys', help: 'Of the surveys filed as PureSpectrum (PS), the share with at least one panel purchase recorded.' },
  b2bBlastRows: { label: 'Blast rows on B2B surveys', help: 'Of the surveys filed as B2B, the share with at least one blast recorded.' },
  date: { label: 'A date', help: 'The survey has a deliver, launch or submitted date, so it can be placed in a month.' },
}

export interface CoverageCell {
  have: number
  /** The denominator. For the two route metrics this is the surveys filed as
   *  that type, not every delivered survey. */
  of: number
  /** have ÷ of, or null when there is nothing to divide. */
  pct: number | null
  /** The surveys missing this field — what a heatmap cell opens. */
  missingIds: string[]
}

export interface CoverageMonth {
  /** 'YYYY-MM', or 'undated'. */
  key: string
  delivered: number
  cells: Record<CoverageMetric, CoverageCell>
  /** Delivered surveys with blast rewards, how many carry a recovery yet, and
   *  whether the month should be read as "recoveries pending". `missingIds`
   *  are the rewarded surveys with no recovered-reward line — counted here, in
   *  this pass, so the Improve tab's recoveries drill can be checked against a
   *  list it did not build itself (finance spec, rule 5). */
  recoveries: { rewarded: number; credited: number; pending: boolean; missingIds: string[] }
}

/** A month is flagged "recoveries pending" when fewer than this share of its
 *  rewarded blast surveys carry a recovered-reward line. */
export const RECOVERY_PENDING_BELOW = 0.75

/**
 * What "reliable" means for each date the banner prints. Coverage must reach
 * the threshold and STAY there through the latest month.
 *
 *   cost    60% — most delivered surveys carry a cost, so a total is a close floor
 *   price   25% — prices are entered as routine, not by exception
 *   budget  20% — budgets are set as routine
 *
 * Price and budget use lower bars because they are only ever set on part of the
 * book (internal work and some trials carry neither); the banner says "entered
 * regularly from", not "complete from".
 */
export const RELIABILITY = {
  cost: { metric: 'cost' as CoverageMetric, threshold: 0.6, words: 'costs are recorded on most delivered surveys' },
  price: { metric: 'price' as CoverageMetric, threshold: 0.25, words: 'client prices are entered regularly' },
  budget: { metric: 'budget' as CoverageMetric, threshold: 0.2, words: 'budgets are set regularly' },
}
export type ReliabilityKey = keyof typeof RELIABILITY

/** A month with fewer delivered surveys than this says nothing about practice,
 *  so it neither starts nor breaks a reliable run. */
export const MIN_MONTH_SURVEYS = 3

const cell = (): CoverageCell => ({ have: 0, of: 0, pct: null, missingIds: [] })
const emptyMonth = (key: string): CoverageMonth => ({
  key, delivered: 0,
  cells: {
    cost: cell(), price: cell(), budget: cell(), postQaN: cell(),
    psPanelRows: cell(), b2bBlastRows: cell(), date: cell(),
  },
  recoveries: { rewarded: 0, credited: 0, pending: false, missingIds: [] },
})

const tick = (c: CoverageCell, has: boolean, id: string) => {
  c.of++
  if (has) c.have++
  else c.missingIds.push(id)
}

/**
 * Coverage of every field, per delivery month, over the delivered book.
 * Months are oldest first; the Undated bucket, when there is one, is last.
 */
export function coverageByMonth(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix: FinIndex = buildIndex(blasts, suppliers, costs),
): CoverageMonth[] {
  const by = new Map<string, CoverageMonth>()
  for (const p of rows) {
    if (classOf(p, ix) !== 'delivered') continue
    const d = finDate(p)
    const key = d ? d.slice(0, 7) : 'undated'
    const m = by.get(key) ?? emptyMonth(key)
    by.set(key, m)
    m.delivered++
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    const c = m.cells
    tick(c.cost, sp.total > 0, p.id)
    tick(c.price, hasPrice(p, rates.get(p.id)), p.id)
    tick(c.budget, Number(p.budget ?? 0) > 0, p.id)
    // The delivered N the BILL reads (revenue.ts deliveredNOf): the survey's own
    // N actual, or — only when that is blank and every segment has one — their
    // sum. Reading the raw column instead called a fully counted segmented
    // survey "missing its N" while the finance page billed it.
    tick(c.postQaN, deliveredNOf(p).n != null, p.id)
    tick(c.date, d != null, p.id)
    if (p.project_type === 'PS') tick(c.psPanelRows, (ix.suppliers.get(p.id)?.length ?? 0) > 0, p.id)
    if (p.project_type === 'B2B') tick(c.b2bBlastRows, (ix.blasts.get(p.id)?.length ?? 0) > 0, p.id)
    if (sp.reward > 0) {
      m.recoveries.rewarded++
      if ((ix.costs.get(p.id) ?? []).some(isCredit)) m.recoveries.credited++
      else m.recoveries.missingIds.push(p.id)
    }
  }
  const out = [...by.values()].sort((a, b) =>
    a.key === 'undated' ? 1 : b.key === 'undated' ? -1 : a.key.localeCompare(b.key))
  for (const m of out) {
    for (const k of COVERAGE_METRICS) {
      const c = m.cells[k]
      c.pct = c.of > 0 ? c.have / c.of : null
    }
    const r = m.recoveries
    r.pending = r.rewarded > 0 && r.credited / r.rewarded < RECOVERY_PENDING_BELOW
  }
  return out
}

/** Every delivered survey that paid blast rewards and carries no recovered-
 *  reward line yet, across the months. The independent survey list the Improve
 *  tab's "recoveries not booked" drill reconciles against. */
export function recoveriesMissing(months: CoverageMonth[]): string[] {
  return months.flatMap(m => m.recoveries.missingIds)
}

/**
 * The first month from which `metric` stays at or above `threshold`, as
 * 'YYYY-MM', or null when even the latest month falls short. Months with fewer
 * than MIN_MONTH_SURVEYS delivered surveys are skipped; Undated is never a month.
 */
export function reliableFrom(
  months: CoverageMonth[], metric: CoverageMetric, threshold: number,
  minSurveys = MIN_MONTH_SURVEYS,
): string | null {
  const dated = months.filter(m => m.key !== 'undated' && m.delivered >= minSurveys)
  let from: string | null = null
  for (const m of dated) {
    const pct = m.cells[metric].pct
    if (pct != null && pct >= threshold) { if (from == null) from = m.key }
    else from = null
  }
  return from
}

export interface ReliabilityDate {
  key: ReliabilityKey
  /** 'YYYY-MM' or null ("not yet"). */
  month: string | null
  /** The first day of that month, 'YYYY-MM-01', for date comparisons. */
  date: string | null
  threshold: number
  words: string
}

/** The three dates the banner prints, computed from coverage. */
export function reliabilityDates(months: CoverageMonth[]): Record<ReliabilityKey, ReliabilityDate> {
  const out = {} as Record<ReliabilityKey, ReliabilityDate>
  for (const key of Object.keys(RELIABILITY) as ReliabilityKey[]) {
    const r = RELIABILITY[key]
    const month = reliableFrom(months, r.metric, r.threshold)
    out[key] = { key, month, date: month ? `${month}-01` : null, threshold: r.threshold, words: r.words }
  }
  return out
}

/** The earliest dated blast — the banner re-checks its cost date against it,
 *  because cost cannot be recorded before the first blast was. */
export function firstBlastAt(blasts: (FinBlast & { blast_at?: string | null })[]): string | null {
  let first: string | null = null
  for (const b of blasts) {
    const at = b.blast_at ?? null
    if (at && (first == null || at < first)) first = at
  }
  return first
}

/** "Jun 2026" for a 'YYYY-MM' key. */
export function monthLabel(key: string): string {
  if (key === 'undated') return 'Undated'
  const [y, m] = key.split('-').map(Number)
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[(m || 1) - 1]} ${y}`
}

/** The last day of a 'YYYY-MM' month, 'YYYY-MM-DD'. */
const lastDayOf = (key: string): string => {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/**
 * Does a 'YYYY-MM' month overlap an inclusive date range (null = open)? The
 * Improve heatmap shows EVERY month and only highlights the ones the date
 * filter selects, so a month counts as selected when any day of it is inside
 * the range. Undated is in no bounded range — it is selected only when the
 * range is open at both ends (All time).
 */
export function monthInRange(key: string, range: { from: string | null; to: string | null }): boolean {
  if (key === 'undated') return range.from == null && range.to == null
  if (range.from && lastDayOf(key) < range.from) return false
  if (range.to && `${key}-01` > range.to) return false
  return true
}

/** Totals across months (Undated included) — for a coverage line such as
 *  "141 of 184 delivered surveys carry a cost". */
export function coverageTotals(months: CoverageMonth[]): Record<CoverageMetric, CoverageCell> {
  const t = emptyMonth('total').cells
  for (const m of months) {
    for (const k of COVERAGE_METRICS) {
      t[k].have += m.cells[k].have
      t[k].of += m.cells[k].of
      t[k].missingIds.push(...m.cells[k].missingIds)
    }
  }
  for (const k of COVERAGE_METRICS) t[k].pct = t[k].of > 0 ? t[k].have / t[k].of : null
  return t
}

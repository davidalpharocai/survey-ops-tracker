/**
 * Tab 4 — IMPROVE. What to record next, ranked by how much each gap hides.
 *
 * ── WHY A TAB ABOUT THE RECORDS ─────────────────────────────────────────────
 * Every other tab is a floor: a survey with nothing logged adds $0, a survey
 * with no price sits outside every margin, a survey with no date is in no
 * month. How far each floor sits below the truth is a fact about the RECORDS,
 * not about the business, and it moves as David backfills them. This tab
 * measures it and turns it into a list someone can work: what is missing, on
 * which surveys, how many dollars it hides, who records it and when.
 *
 * ── EVERY ROW IS A RULE, AND DROPS OFF BY ITSELF ────────────────────────────
 * The spec's list (finance_spec §4, "fixable with fields that exist today") was
 * written from a 24 Sep measurement. Typed into the page, "94 surveys,
 * $188,960" would still say so after the backfill. Here each gap is a rule run
 * on the loaded rows and ranked by the dollars it hides. A gap the data shows as
 * closed leaves the list with a one-line "resolved" note. A gap whose table did
 * not load says "Blocked" — never "resolved", because a failed read is not a
 * fix. Client price is the one gap with a BAR to clear rather than a count to
 * reach zero (PRICE_COVERAGE_GOAL): the list is how David watches the backfill
 * toward 1 June, so it stays ranked until priced surveys hold most of the spend.
 *
 * ── DOLLARS HIDDEN COME IN THREE KINDS, AND EACH ROW SAYS WHICH ─────────────
 *   spend     recorded cost sitting on the surveys that no margin or rate can use
 *   price     client price the margin cannot count yet
 *   estimate  cost or recoveries that are NOT recorded, sized at a rate measured
 *             on the book (the median cost per complete, the share of rewards
 *             already recovered) and always printed "about" — it is never added
 *             to a recorded figure, and its drill checks the survey list only
 * A gap that hides no dollars (an empty contract term) ranks after those that do.
 *
 * ── THE HEATMAP IGNORES THE DATE, ON PURPOSE ────────────────────────────────
 * The coverage grid shows every month with delivered work, whatever range is
 * picked, and only HIGHLIGHTS the selected months (spec, page chrome). A grid cut
 * to "since 1 June" could never show the before-and-after that explains the
 * banner. Its vertical rules are the banner's own reliability dates, computed on
 * the whole book (coverage.ts), so a backfill moves both at once.
 *
 * Pure: the component renders the model and nothing else.
 */

import {
  isCredit, legsOf, marginOf, routeCosts, spendOf,
  type FinIndex, type FinProject, type LegBlock, type Route, type RouteCost, type Spend,
} from './hub'
import {
  coverageByMonth, coverageTotals, METRIC_LABEL, MIN_MONTH_SURVEYS, monthInRange, monthLabel,
  recoveriesMissing, reliabilityDates, RELIABILITY,
  type CoverageMetric, type CoverageMonth, type ReliabilityDate, type ReliabilityKey,
} from './coverage'
import {
  deliveredNOf, hasPrice, KEEP_GOAL, revenueDetail, segmentCheck, segmentPriceDiffers, suggestedBudget,
} from './revenue'
import {
  describe, RELIABLE_FROM, resolveRange,
  type FinanceFilter, type FinItem, type TabRule,
} from './filters'
import { blockedText, isBlocked, priceBlockText, type FinanceLoad, type FinanceRaw, type FinanceTable } from './load'
import { spendOfIds, type DrillColumn, type DrillRow, type DrillSpec } from './drill'
import { money, money2, moneyOrDash, pctText } from './format'
import { fmtNum } from '@/lib/utils/number'

/* ── THE BARS ─────────────────────────────────────────────────────────────── */

/** Client price stays a ranked gap until priced surveys hold at least this
 *  share of the delivered spend in view. Some work is legitimately never
 *  priced, so the gap is a bar to clear, not a count to reach zero; the rest of
 *  the list drops off at zero. Printed in the gap's help text. */
export const PRICE_COVERAGE_GOAL = 0.9

/** A blast or panel row counts as logged "live" when it was written within this
 *  many days of the work it records (spec: the live-logging strip). */
export const LOG_WITHIN_DAYS = 7

/** The strip alerts when the latest closed week falls below this share. */
export const LOG_ALERT_BELOW = 0.8

/** The strip shows at most this many of the latest weeks. */
export const LOG_WEEKS = 26

/** The header's "pricing the top N unpriced accounts would take it to …". */
export const TOP_ACCOUNTS = 5

/** A price more than this many times the median price on its route is flagged
 *  "check the rate first" — the $200/N-on-a-panel-survey case, where entering
 *  an N would have booked about $96k. Needs MIN_RATE_SAMPLE prices to compare. */
export const RATE_OUTLIER_FACTOR = 3
export const MIN_RATE_SAMPLE = 5

/** A survey with no field rows is sized at the book's rate per complete — but
 *  only up to this percentile of the surveys of its kind that DO record their
 *  rows. One survey twelve times the usual size was 98% of a $82,544 estimate,
 *  and it was almost certainly fielded some other way (a client-distributed
 *  list). Above the line the survey is listed and left unsized, never priced.
 *  Needs MIN_SIZE_SAMPLE recorded surveys to draw the line at all. */
export const OUTSIZED_ABOVE = 0.9
export const MIN_SIZE_SAMPLE = 5

/** When one survey is at least this share of an estimate, the row names it and
 *  its share, so nobody reads a concentrated figure as a spread-out one. */
export const CONCENTRATION_SHARE = 0.5

/** The heatmap's row order (the spec's order, not the metric list's). */
export const HEATMAP_ROWS: CoverageMetric[] = [
  'cost', 'price', 'postQaN', 'budget', 'psPanelRows', 'b2bBlastRows', 'date',
]

/* ── INPUT AND CONTEXT ────────────────────────────────────────────────────── */

export interface ImproveInput {
  /** Every survey but empty placeholders, classified once (the shell's `items`). */
  items: FinItem[]
  /** The tab's population: delivered and live × date × account × route. */
  population: FinItem[]
  load: Pick<FinanceLoad, 'raw' | 'blocked' | 'integrity'>
  ix: FinIndex
  filter: FinanceFilter
  today: string
  accountName: (clientId: string | null | undefined) => string
}

interface Ctx {
  input: ImproveInput
  raw: FinanceRaw
  ix: FinIndex
  rates: Map<string, number>
  pop: FinItem[]
  delivered: FinItem[]
  live: FinItem[]
  spend: (p: FinProject) => Spend
  blocked: (t: FinanceTable) => boolean
  /** Why client prices cannot be read, or null when they can. */
  priceBlock: string | null
  /** The first field-cost table that did not load, or null. Spend computed
   *  without it is a floor, so a share of spend cannot be stated. */
  costBlock: FinanceTable | null
  range: { from: string | null; to: string | null }
  /** The book's median cost per complete by route (routeCosts), computed once
   *  on first use. */
  medians: () => Partial<Record<'blast' | 'panel', RouteCost>>
  /** coverage.ts over the population's delivered surveys, month by month,
   *  computed once on first use — a second, independent coding of "which
   *  survey is missing what", which several gap drills are checked against. */
  popMonths: () => CoverageMonth[]
  popCoverage: () => ReturnType<typeof coverageTotals>
  /** How large a survey of this kind usually is, measured on the book's
   *  surveys that DID record their field rows, and how many were measured.
   *  null when too few to draw a line. */
  sizeCap: (type: 'PS' | 'B2B') => { value: number; n: number } | null
  account: (p: FinProject) => string
  /** The account the filter selects, by name, for the words. */
  accountFilterName: string | null
}

function makeCtx(input: ImproveInput): Ctx {
  const raw = input.load.raw
  const cache = new Map<string, Spend>()
  const spend = (p: FinProject) => {
    let s = cache.get(p.id)
    if (!s) { s = spendOf(p, raw.blasts, raw.suppliers, raw.costs, input.ix); cache.set(p.id, s) }
    return s
  }
  // The book's rate, not the view's: a view cut to one account can hold two
  // panel surveys, and an estimate sized on two surveys is a guess.
  let medians: Partial<Record<'blast' | 'panel', RouteCost>> | null = null
  const mediansOf = () => {
    if (!medians) {
      medians = {}
      const bookDelivered = input.items.filter(it => it.cls === 'delivered').map(it => it.p)
      for (const rc of routeCosts(bookDelivered, raw.blasts, raw.suppliers, raw.costs)) medians[rc.route] = rc
    }
    return medians
  }
  const delivered = input.population.filter(it => it.cls === 'delivered')
  let months: CoverageMonth[] | null = null
  const popMonths = () => {
    months ??= coverageByMonth(delivered.map(it => it.p), raw.rates, raw.blasts, raw.suppliers, raw.costs, input.ix)
    return months
  }
  let cover: ReturnType<typeof coverageTotals> | null = null
  const popCoverage = () => {
    cover ??= coverageTotals(popMonths())
    return cover
  }
  // The usual size of a survey of each kind, on the BOOK (a view cut to one
  // account can hold two recorded surveys, and a line drawn on two is a guess).
  const caps = new Map<'PS' | 'B2B', { value: number; n: number } | null>()
  const sizeCap = (type: 'PS' | 'B2B') => {
    if (!caps.has(type)) {
      const own = type === 'PS' ? input.ix.suppliers : input.ix.blasts
      const sample = input.items
        .filter(it => it.cls === 'delivered' && it.p.project_type === type && (own.get(it.p.id)?.length ?? 0) > 0)
        .map(it => completesOf(it.p))
        .filter(n => n > 0)
      const v = sample.length >= MIN_SIZE_SAMPLE ? percentileOf(sample, OUTSIZED_ABOVE) : null
      caps.set(type, v == null ? null : { value: v, n: sample.length })
    }
    return caps.get(type) ?? null
  }
  return {
    input, raw, ix: input.ix, rates: raw.rates,
    pop: input.population,
    delivered,
    live: input.population.filter(it => it.cls === 'active'),
    spend,
    blocked: t => isBlocked(input.load.blocked, t),
    // /finance is gated to finance holders, so a zero-price load is a read
    // problem to name, not a reader who may not see prices.
    priceBlock: priceBlockText(input.load, { canViewFinancials: true }),
    costBlock: COST_TABLES.find(t => isBlocked(input.load.blocked, t)) ?? null,
    range: resolveRange(input.filter.range, input.today),
    medians: mediansOf,
    popMonths,
    popCoverage,
    sizeCap,
    account: p => input.accountName(p.client_id),
    accountFilterName: input.filter.account ? input.accountName(input.filter.account) : null,
  }
}

/* ── SMALL WORDS ──────────────────────────────────────────────────────────── */

const COST_TABLES: FinanceTable[] = ['project_blasts', 'project_suppliers', 'project_costs']

const pl = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`
/** 'study' does not take an s. The units are a tiny closed set, so a map
 *  beats turning `unit` into a {one, many} pair everywhere it is read. */
const UNIT_PLURAL: Record<string, string> = { study: 'studies' }
const units = (unit: string) => UNIT_PLURAL[unit] ?? `${unit}s`
const verb = (n: number, one: string, many: string) => (n === 1 ? one : many)
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)
const share = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const idsOf = (xs: FinItem[]) => xs.map(it => it.p.id)
const monthKey = (d: string | null) => (d ? d.slice(0, 7) : 'undated')
const perN = (rate: number) => `${money(rate)}/N`

/** Completes a survey bought: what it collected, else what it delivered. */
const completesOf = (p: FinProject) => {
  const c = Number(p.n_collected ?? 0)
  return c > 0 ? c : Number(deliveredNOf(p).n ?? 0)
}

/** The p-th value of a sample by nearest rank (the same reading hub.ts uses
 *  for its quantiles), or null when there is nothing to rank. */
export function percentileOf(xs: number[], p: number): number | null {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "7 Sep" for 'YYYY-MM-DD'. */
export const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}`
}

/* ── DATES FOR THE LIVE-LOGGING RULE ──────────────────────────────────────── */

const DAY_MS = 86_400_000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** The calendar day of a timestamp in Eastern time (the office's calendar, as
 *  `todayET`), or the day itself when it is already 'YYYY-MM-DD'. */
export function etDay(v: string | null | undefined): string | null {
  if (!v) return null
  if (ISO_DAY.test(v)) return v
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
export const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
/** The Monday of the week a day falls in. */
export const weekOf = (d: string) => {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(d, -((dow + 6) % 7))
}

/**
 * THE LIVE-LOGGING RULE. A row was written "live" when the day it was written
 * (its created_at, in Eastern time) is no more than LOG_WITHIN_DAYS calendar days
 * after the day of the work it records. A row written BEFORE the work — a blast
 * scheduled ahead — is on time. null when either date is missing: the strip
 * says how many rows it could not place instead of guessing.
 *
 * Calendar days, not hours, because a panel wave's work date is a launch DATE
 * with no time on it; measuring a blast in hours and a wave in days would put
 * two rules on one strip.
 */
export function writtenWithin(
  createdAt: string | null | undefined, workDay: string | null | undefined, days = LOG_WITHIN_DAYS,
): boolean | null {
  const c = etDay(createdAt), w = etDay(workDay)
  if (!c || !w) return null
  return dayNum(c) - dayNum(w) <= days
}

/* ── POPULATION WORDS ─────────────────────────────────────────────────────── */

const DELIVERED_RULE: TabRule = { classes: ['delivered'], side: [], date: true, account: true, route: true, word: 'Delivered' }
const LIVE_AND_DELIVERED: TabRule = { classes: ['delivered', 'active'], side: [], date: true, account: true, route: true, word: 'Delivered and live' }
/** The heatmap's population: delivered × account × route, every month. */
const ALL_MONTHS_DELIVERED: TabRule = {
  classes: ['delivered'], side: [], date: false, account: true, route: true, word: 'Delivered', ignoredNote: 'All months',
}

const chipFor = (ctx: Ctx, rule: TabRule, count: number) =>
  describe(ctx.input.filter, {
    tab: 'improve', today: ctx.input.today, count, accountName: ctx.accountFilterName, rule,
  }).chip

/* ── THE HEADER: CLIENT PRICE COVERAGE ────────────────────────────────────── */

export interface UnpricedAccount {
  id: string | null
  name: string
  surveys: number
  /** Recorded cost on this account's unpriced delivered surveys. */
  spend: number
  ids: string[]
  /** The account's most recent price above $0, to pre-fill from. */
  lastPrice: LastPrice | null
  /** The same, per route its unpriced surveys were fielded on — a panel
   *  survey priced from a blast rate would be off by an order of magnitude
   *  (PureSpectrum work is priced in single dollars, blast work in hundreds). */
  lastByRoute: (LastPrice & { route: Route })[]
  /** The AlphaROC account itself: internal work, priced at $0 or a transfer price. */
  internal: boolean
}

export interface PriceHeader {
  delivered: number
  priced: number
  spend: number
  pricedSpend: number
  /** pricedSpend ÷ spend, or null with no spend to divide. */
  spendPct: number | null
  /** Every unpriced account carrying cost, largest first. */
  accounts: UnpricedAccount[]
  /** The top TOP_ACCOUNTS of them. */
  top: UnpricedAccount[]
  /** The spend share if the top accounts were priced. */
  ifTopPriced: number | null
  blocked: string | null
  sentence: string
}

export interface LastPrice { rate: number; code: string | null; id: string }

/** The most recent price above $0 per account, and per account × route — what
 *  a backfill can pre-fill from. Read across every class: a price quoted on a
 *  live survey is the freshest statement of what the account pays. */
function lastPrices(ctx: Ctx) {
  const byAcc = new Map<string, LastPrice & { date: string }>()
  const byAccRoute = new Map<string, LastPrice & { date: string }>()
  for (const it of ctx.input.items) {
    const r = ctx.rates.get(it.p.id)
    if (r == null || !(r > 0) || !it.p.client_id) continue
    const e = { rate: r, code: it.p.project_code, id: it.p.id, date: it.date ?? '' }
    const newer = (o?: { date: string; code: string | null }) =>
      !o || e.date > o.date || (e.date === o.date && (e.code ?? '') > (o.code ?? ''))
    if (newer(byAcc.get(it.p.client_id))) byAcc.set(it.p.client_id, e)
    const k = `${it.p.client_id}|${it.route}`
    if (newer(byAccRoute.get(k))) byAccRoute.set(k, e)
  }
  return { byAcc, byAccRoute }
}

const ROUTE_WORD: Record<Route, string> = { blast: 'blast', panel: 'panel', both: 'both ways', none: 'no field rows' }

const isInternal = (name: string) => /^alpharoc\b/i.test(name.trim())

interface PriceScan {
  header: PriceHeader
  /** Delivered, costed, unpriced. */
  hits: FinItem[]
  last: ReturnType<typeof lastPrices>
}

function scanPrice(ctx: Ctx): PriceScan {
  const last = lastPrices(ctx)
  const priced = ctx.delivered.filter(it => hasPrice(it.p, ctx.rates.get(it.p.id)))
  const spend = sum(ctx.delivered, it => ctx.spend(it.p).total)
  const pricedSpend = sum(priced, it => ctx.spend(it.p).total)
  const hits = ctx.delivered.filter(it =>
    !hasPrice(it.p, ctx.rates.get(it.p.id)) && ctx.spend(it.p).total > 0)
  const by = new Map<string, UnpricedAccount>()
  for (const it of hits) {
    const key = it.p.client_id ?? '(none)'
    let a = by.get(key)
    if (!a) {
      const name = ctx.account(it.p)
      const lp = it.p.client_id ? last.byAcc.get(it.p.client_id) : undefined
      a = {
        id: it.p.client_id, name, surveys: 0, spend: 0, ids: [],
        lastPrice: lp ? { rate: lp.rate, code: lp.code, id: lp.id } : null,
        lastByRoute: [],
        internal: isInternal(name),
      }
      by.set(key, a)
    }
    const rp = it.p.client_id && it.route !== 'none' ? last.byAccRoute.get(`${it.p.client_id}|${it.route}`) : undefined
    if (rp && !a.lastByRoute.some(x => x.route === it.route)) {
      a.lastByRoute.push({ route: it.route, rate: rp.rate, code: rp.code, id: rp.id })
    }
    a.surveys++
    a.spend += ctx.spend(it.p).total
    a.ids.push(it.p.id)
  }
  const accounts = [...by.values()].sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))
  const top = accounts.slice(0, TOP_ACCOUNTS)
  const spendPct = share(pricedSpend, spend)
  const ifTopPriced = share(pricedSpend + sum(top, a => a.spend), spend)
  const blocked = ctx.priceBlock ?? (ctx.costBlock ? blockedText(ctx.costBlock) : null)
  let sentence: string
  if (blocked) sentence = `${blocked}, so price coverage cannot be measured. This is missing, not zero.`
  else if (ctx.delivered.length === 0) sentence = 'There are no delivered studies in this view, so there is no price coverage to measure.'
  else {
    sentence = `Client price covers ${fmtNum(priced.length)} of ${fmtNum(ctx.delivered.length)} delivered studies (${pctText(spendPct)} of spend).`
    if (top.length) {
      const which = top.length < accounts.length
        ? `the top ${pl(top.length, 'unpriced account')}`
        : `${top.length === 1 ? 'the one' : `all ${fmtNum(top.length)}`} unpriced ${verb(top.length, 'account', 'accounts')}`
      sentence += ` Pricing ${which} would take it to ${pctText(ifTopPriced)}.`
    } else {
      sentence += ' Every delivered study with a recorded cost carries a price.'
    }
  }
  return {
    header: {
      delivered: ctx.delivered.length, priced: priced.length, spend, pricedSpend, spendPct,
      accounts, top, ifTopPriced, blocked, sentence,
    },
    hits,
    last,
  }
}

/* ── C6: THE COVERAGE GRID ────────────────────────────────────────────────── */

export interface CoverageColumn {
  key: string
  label: string
  shortLabel: string
  delivered: number
  /** Inside the selected date range (highlighted). */
  selected: boolean
}

export interface CoverageHeatCell {
  row: CoverageMetric
  col: string
  value: number | null
  have: number
  of: number
  missingIds: string[]
}

export interface CoverageRule { at: string; label: string; keys: ReliabilityKey[] }

export interface CoverageGrid {
  /** Delivered × account × route, every month (no date filter). */
  surveys: number
  months: CoverageMonth[]
  rows: { key: CoverageMetric; label: string; help: string }[]
  columns: CoverageColumn[]
  cells: CoverageHeatCell[]
  /** The columns the date filter selects; undefined when it selects all. */
  highlight: string[] | undefined
  rules: CoverageRule[]
  /** The banner's dates, computed on the WHOLE book. */
  reliability: Record<ReliabilityKey, ReliabilityDate>
  /** Rows left off because their table did not load. */
  blockedRows: string[]
  chip: string
  verdict: string
}

const RULE_WORD: Record<ReliabilityKey, string> = { cost: 'costs', price: 'prices', budget: 'budgets' }

function buildGrid(ctx: Ctx): CoverageGrid {
  const { raw, ix } = ctx
  const f = ctx.input.filter
  const scoped = ctx.input.items.filter(it =>
    it.cls === 'delivered'
    && (!f.account || it.p.client_id === f.account)
    && (f.route === 'all' || it.route === f.route))
  const months = coverageByMonth(scoped.map(it => it.p), ctx.rates, raw.blasts, raw.suppliers, raw.costs, ix)
  // The banner's dates: the whole book, so the lines here and there agree.
  const book = coverageByMonth(ctx.input.items.map(it => it.p), ctx.rates, raw.blasts, raw.suppliers, raw.costs, ix)
  const reliability = reliabilityDates(book)

  const blockedRows: string[] = []
  const costTable = ctx.costBlock
  const rowKeys = HEATMAP_ROWS.filter(k => {
    // A row computed on a table that did not load would read as low coverage,
    // which is the one thing this grid must never invent. It is left off, named.
    if (k === 'cost' && costTable) { blockedRows.push(`Any recorded cost: ${blockedText(costTable)}.`); return false }
    if (k === 'price' && ctx.priceBlock) { blockedRows.push(`Client price: ${ctx.priceBlock}.`); return false }
    // The delivered N rolls a segmented survey's segments up (revenue.ts
    // deliveredNOf), so without that table the row would read as low coverage
    // while gap 5, which asks the same question, says Blocked.
    if (k === 'postQaN' && ctx.blocked('project_segments')) { blockedRows.push(`${METRIC_LABEL.postQaN.label}: ${blockedText('project_segments')}.`); return false }
    if (k === 'psPanelRows' && ctx.blocked('project_suppliers')) { blockedRows.push(`Panel rows: ${blockedText('project_suppliers')}.`); return false }
    if (k === 'b2bBlastRows' && ctx.blocked('project_blasts')) { blockedRows.push(`Blast rows: ${blockedText('project_blasts')}.`); return false }
    return true
  })

  const bounded = ctx.range.from != null || ctx.range.to != null
  const columns: CoverageColumn[] = months.map(m => ({
    key: m.key,
    label: monthLabel(m.key),
    shortLabel: m.key === 'undated' ? 'Und.' : monthLabel(m.key).slice(0, 3),
    delivered: m.delivered,
    selected: monthInRange(m.key, ctx.range),
  }))
  const highlight = bounded ? columns.filter(c => c.selected).map(c => c.key) : undefined

  const cells: CoverageHeatCell[] = []
  for (const m of months) {
    for (const k of rowKeys) {
      const c = m.cells[k]
      cells.push({ row: k, col: m.key, value: c.pct, have: c.have, of: c.of, missingIds: c.missingIds })
    }
  }

  // A rule sits BEFORE its month's column. A view cut to one account may have
  // no work in that month, so the line moves to the next month it does have.
  const dated = columns.filter(c => c.key !== 'undated')
  const at = (month: string | null) => (month ? dated.find(c => c.key >= month)?.key ?? null : null)
  const byAt = new Map<string, ReliabilityKey[]>()
  for (const key of ['cost', 'price', 'budget'] as ReliabilityKey[]) {
    if (key === 'cost' && costTable) continue
    if (key === 'price' && ctx.priceBlock) continue
    const col = at(reliability[key].month)
    if (!col) continue
    byAt.set(col, [...(byAt.get(col) ?? []), key])
  }
  const rules: CoverageRule[] = [...byAt.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([col, keys]) => {
      const words = keys.map(k => RULE_WORD[k])
      const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
      // "costs reliable from here" / "prices and budgets start here": cost is a
      // near-complete record from its date; prices and budgets only become
      // routine (their bars are lower — coverage.ts RELIABILITY).
      const label = keys.length === 1 && keys[0] === 'cost'
        ? 'costs reliable from here'
        : keys.includes('cost') ? `${list} reliable from here` : `${list} start here`
      return { at: col, label, keys }
    })

  return {
    surveys: scoped.length,
    months,
    rows: rowKeys.map(k => ({ key: k, label: METRIC_LABEL[k].label, help: METRIC_LABEL[k].help })),
    columns,
    cells,
    highlight,
    rules,
    reliability,
    blockedRows,
    chip: chipFor(ctx, ALL_MONTHS_DELIVERED, scoped.length),
    verdict: gridVerdict(ctx, book, months, reliability, costTable ?? null),
  }
}

/** The grid's closing sentence: where each line sits, and what would move the
 *  price line back to 1 June (the backfill David is doing). */
function gridVerdict(
  ctx: Ctx, book: CoverageMonth[], months: CoverageMonth[],
  rel: Record<ReliabilityKey, ReliabilityDate>, costTable: FinanceTable | null,
): string {
  const parts: string[] = []
  // The lines are the banner's, drawn on the whole book. Under an account or
  // route filter the cells are that slice's, so the sentence says whose lines
  // they are rather than letting a reader take them for the slice's.
  const f = ctx.input.filter
  if (f.account || f.route !== 'all') parts.push('The lines are the whole book’s, as in the banner.')
  parts.push(costTable
    ? `${blockedText(costTable)}, so the cost line cannot be placed.`
    : rel.cost.month
      ? `Costs are recorded on most delivered studies from ${monthLabel(rel.cost.month)}.`
      : `Costs do not yet stay above ${pctText(RELIABILITY.cost.threshold)} of delivered studies in any run of months.`)
  if (ctx.priceBlock) {
    parts.push(`${ctx.priceBlock}, so the price line cannot be placed.`)
    return parts.join(' ')
  }
  const p = rel.price.month, b = rel.budget.month
  if (p && b) {
    parts.push(p === b
      ? `Client prices and budgets are entered regularly from ${monthLabel(p)}.`
      : `Client prices are entered regularly from ${monthLabel(p)}, budgets from ${monthLabel(b)}.`)
  } else if (p) {
    parts.push(`Client prices are entered regularly from ${monthLabel(p)}; budgets do not yet stay above ${pctText(RELIABILITY.budget.threshold)} in any run of months.`)
  } else {
    parts.push(`Client prices do not yet stay above ${pctText(RELIABILITY.price.threshold)} of delivered studies in any run of months.`)
  }
  const start = RELIABLE_FROM.slice(0, 7)
  const target = p ?? book.filter(m => m.key !== 'undated').slice(-1)[0]?.key ?? null
  // The months to work on are counted on the CELLS BESIDE THIS SENTENCE, not on
  // the book: under an account or route filter the grid shows that slice, and a
  // sentence quoting the whole book's percentages beside it can ask for a month
  // the slice has already priced. The LINE stays the book's, as said above.
  const scoped = f.account != null || f.route !== 'all'
  if (target && target > start) {
    const below = months.filter(m =>
      m.key !== 'undated' && m.key >= start && (p ? m.key < p : m.key <= target)
      && m.delivered >= MIN_MONTH_SURVEYS && (m.cells.price.pct ?? 0) < RELIABILITY.price.threshold)
    if (below.length) {
      const list = below.map(m => `${monthLabel(m.key)} (${pctText(m.cells.price.pct)} today)`)
      const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
      parts.push(scoped
        ? `In this view, price ${joined} up to ${pctText(RELIABILITY.price.threshold)} of delivered studies; the book’s line moves back to ${monthLabel(start)} once every account does.`
        : `Price ${joined} up to ${pctText(RELIABILITY.price.threshold)} of delivered studies to move the price line back to ${monthLabel(start)}.`)
    } else if (scoped) {
      parts.push(`In this view, every month back to ${monthLabel(start)} with enough delivered work is already at or above ${pctText(RELIABILITY.price.threshold)}; the book’s line is held back by work outside it.`)
    }
  } else if (p && p <= start) {
    parts.push(`The price line has reached ${monthLabel(start)}, the start of the default view.`)
  }
  return parts.join(' ')
}

/** Does this survey carry the field? Written apart from coverage.ts on
 *  purpose: a cell's drill rows come from here and are checked against the
 *  cell's own missing ids, so the two codings must agree or the strip turns red.
 *  null = the row does not apply (a route row on a survey filed as the other). */
function hasField(ctx: Ctx, it: FinItem, m: CoverageMetric): boolean | null {
  const p = it.p
  switch (m) {
    case 'cost': return ctx.spend(p).total > 0
    case 'price': return hasPrice(p, ctx.rates.get(p.id))
    case 'budget': return Number(p.budget ?? 0) > 0
    case 'postQaN': return deliveredNOf(p).n != null
    case 'psPanelRows': return p.project_type === 'PS' ? (ctx.ix.suppliers.get(p.id)?.length ?? 0) > 0 : null
    case 'b2bBlastRows': return p.project_type === 'B2B' ? (ctx.ix.blasts.get(p.id)?.length ?? 0) > 0 : null
    case 'date': return it.date != null
  }
}

/** What to enter, and where, for each heatmap row. */
export const FIELD_WHERE: Record<CoverageMetric, { enter: string; where: string }> = {
  cost: { enter: 'Blasts, panel purchases or cost lines', where: 'Project page → Blasts, Suppliers or Cost lines' },
  price: { enter: 'Client price per N', where: 'Project page → Money → Price / N' },
  budget: { enter: 'Budget (the most we plan to spend)', where: 'Project page → Money → Budget' },
  postQaN: { enter: 'N actual (after QA)', where: 'Project page → N Actual' },
  psPanelRows: { enter: 'Panel purchases (PureSpectrum import)', where: 'Project page → Suppliers' },
  b2bBlastRows: { enter: 'Blasts', where: 'Project page → Blasts' },
  date: { enter: 'Delivery date', where: 'Project page → Delivery date' },
}

/** The drill behind one heatmap cell: the delivered surveys that month that do
 *  not carry the field. Rows come from `hasField`; the ids are checked against
 *  the cell's own list (coverage.ts) and the cost against spendOfIds. */
export function coverageCellDrill(
  input: ImproveInput, grid: CoverageGrid, metric: CoverageMetric, col: string,
): { spec: DrillSpec; month: { key: string; label: string; from: string; to: string } | null } {
  const ctx = makeCtx(input)
  const f = input.filter
  const cell = grid.cells.find(c => c.row === metric && c.col === col)
  const inMonth = input.items.filter(it =>
    it.cls === 'delivered'
    && (!f.account || it.p.client_id === f.account)
    && (f.route === 'all' || it.route === f.route)
    && monthKey(it.date) === col)
  const missing = inMonth.filter(it => hasField(ctx, it, metric) === false)
  const where = FIELD_WHERE[metric]
  const rows: DrillRow[] = missing
    .map(it => ({
      id: it.p.id, code: it.p.project_code, contribution: ctx.spend(it.p).total,
      account: ctx.account(it.p), date: it.date, type: it.p.project_type ?? '—',
      detail: where.enter, amount: ctx.spend(it.p).total, where: where.where,
    }))
    .sort((a, b) => b.contribution - a.contribution || String(a.code).localeCompare(String(b.code)))
  const expectedIds = cell?.missingIds ?? []
  const label = METRIC_LABEL[metric].label
  const monthWords = monthLabel(col)
  const spec: DrillSpec = {
    key: `improve-coverage-${metric}-${col}`,
    title: rows.length
      ? `${label} missing · ${monthWords} · ${pl(rows.length, 'study', 'studies')}`
      : `Nothing missing · ${label} · ${monthWords}`,
    // The drill is one month, so the month IS its date words — appending it to
    // the grid's "All months" chip read "All months · Jun 2026".
    population: chipFor(ctx, { ...ALL_MONTHS_DELIVERED, ignoredNote: monthWords }, inMonth.length),
    columns: [
      { key: 'account', header: 'Account', tip: 'The client account, by its consolidated name.', value: r => String(r.account ?? '') },
      { key: 'type', header: 'Filed as', tip: 'The study type as filed (PS or B2B).', value: r => String(r.type ?? '') },
      { key: 'detail', header: 'What to enter', tip: METRIC_LABEL[metric].help, value: r => String(r.detail ?? '') },
      { key: 'amount', header: 'Recorded cost', tip: 'Field cost recorded on the study today. A study with nothing logged shows $0.', num: true, value: r => moneyOrDash(r.amount as number | null) },
      { key: 'where', header: 'Where to fix', tip: 'Where the field is entered. The study code opens its project page.', value: r => String(r.where ?? '') },
    ],
    rows,
    expectedTotal: spendOfIds(expectedIds, ctx.raw.blasts, ctx.raw.suppliers, ctx.raw.costs),
    expectedIds,
    totalLabel: 'Recorded cost on these studies',
    format: 'money',
  }
  const month = col === 'undated' ? null : {
    key: col, label: monthWords, from: `${col}-01`,
    to: new Date(Date.UTC(Number(col.slice(0, 4)), Number(col.slice(5, 7)), 0)).toISOString().slice(0, 10),
  }
  return { spec, month }
}

/* ── THE LIVE-LOGGING STRIP ───────────────────────────────────────────────── */

export interface LogWeek {
  /** The Monday, 'YYYY-MM-DD'. */
  key: string
  label: string
  rows: number
  onTime: number
  late: number
  share: number | null
  blast: { rows: number; onTime: number }
  panel: { rows: number; onTime: number }
  /** Some of this week's work is still inside its 7-day window, so a row
   *  written late has not arrived yet and the share can still fall. */
  open: boolean
  /** Surveys with a row this week. */
  ids: string[]
}

export interface LogObs { project: string; kind: 'blast' | 'panel'; week: string; onTime: boolean; lag: number }

export interface LoggingStrip {
  weeks: LogWeek[]
  /** Rows the strip could not place, and tables it could not read, in words. */
  notes: string[]
  /** Set when nothing at all can be drawn, and why. */
  cannot: string | null
  latestClosed: LogWeek | null
  alert: boolean
  surveys: number
  chip: string
  verdict: string
  /** @internal — the placed rows, for a week's drill. */
  obs: LogObs[]
}

function buildLogging(ctx: Ctx): LoggingStrip {
  const { raw } = ctx
  const today = ctx.input.today
  const popIds = new Set(idsOf(ctx.pop))
  const from = ctx.range.from
  const to = ctx.range.to && ctx.range.to < today ? ctx.range.to : today
  const notes: string[] = []
  const obs: LogObs[] = []
  const place = (project: string, kind: 'blast' | 'panel', created: string | null | undefined, work: string | null) => {
    const w = etDay(work)
    const c = etDay(created)
    if (!w || !c) return false
    if ((from && w < from) || w > to) return true // outside the window: not a gap, just not shown
    // The rule this file publishes and tests, never a second copy of it.
    const onTime = writtenWithin(c, w)
    if (onTime == null) return false
    obs.push({ project, kind, week: weekOf(w), onTime, lag: dayNum(c) - dayNum(w) })
    return true
  }

  // ── blasts: written (created_at) against sent (blast_at, else scheduled_at)
  if (ctx.blocked('project_blasts')) notes.push(`${blockedText('project_blasts')}, so blasts are left out.`)
  else {
    const mine = raw.blasts.filter(b => popIds.has(b.project_id))
    if (mine.length && mine.every(b => !('created_at' in b))) {
      notes.push('The time each blast row was written (created_at) did not load, so blasts are left out.')
    } else {
      let noWork = 0, noCreated = 0
      for (const b of mine) {
        const work = b.blast_at ?? b.scheduled_at ?? null
        if (!work) { noWork++; continue }
        if (!b.created_at) { noCreated++; continue }
        place(b.project_id, 'blast', b.created_at, work)
      }
      if (noWork) notes.push(`${pl(noWork, 'blast')} ${verb(noWork, 'has', 'have')} no send date, so ${verb(noWork, 'it is', 'they are')} left out.`)
      if (noCreated) notes.push(`${pl(noCreated, 'blast')} ${verb(noCreated, 'has', 'have')} no written-on time, so ${verb(noCreated, 'it is', 'they are')} left out.`)
    }
  }

  // ── panel rows: written (created_at) against the wave's launch date
  if (ctx.blocked('project_suppliers')) notes.push(`${blockedText('project_suppliers')}, so panel rows are left out.`)
  else if (ctx.blocked('project_launches')) notes.push(`${blockedText('project_launches')}, so panel rows have no wave date and are left out.`)
  else {
    const launch = new Map(raw.launches.map(l => [l.id, l]))
    const mine = raw.suppliers.filter(s => popIds.has(s.project_id))
    if (mine.length && mine.every(s => !('created_at' in s))) {
      notes.push('The time each panel row was written (created_at) did not load, so panel rows are left out.')
    } else {
      let noWave = 0, noCreated = 0
      for (const s of mine) {
        const work = s.launch_id ? launch.get(s.launch_id)?.launch_date ?? null : null
        if (!work) { noWave++; continue }
        if (!s.created_at) { noCreated++; continue }
        place(s.project_id, 'panel', s.created_at, work)
      }
      if (noWave) notes.push(`${pl(noWave, 'panel row')} ${verb(noWave, 'sits', 'sit')} on a wave with no launch date, so ${verb(noWave, 'it is', 'they are')} left out.`)
      if (noCreated) notes.push(`${pl(noCreated, 'panel row')} ${verb(noCreated, 'has', 'have')} no written-on time, so ${verb(noCreated, 'it is', 'they are')} left out.`)
    }
  }

  const by = new Map<string, LogWeek>()
  for (const o of obs) {
    let w = by.get(o.week)
    if (!w) {
      w = {
        key: o.week, label: dayLabel(o.week), rows: 0, onTime: 0, late: 0, share: null,
        blast: { rows: 0, onTime: 0 }, panel: { rows: 0, onTime: 0 },
        // Closed once every day of the week (Mon–Sun) has had its full window:
        // today is after Sunday + LOG_WITHIN_DAYS.
        open: !(today > addDays(o.week, 6 + LOG_WITHIN_DAYS)),
        ids: [],
      }
      by.set(o.week, w)
    }
    w.rows++
    w[o.kind].rows++
    if (o.onTime) { w.onTime++; w[o.kind].onTime++ } else w.late++
    if (!w.ids.includes(o.project)) w.ids.push(o.project)
  }
  const weeks = [...by.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-LOG_WEEKS)
  for (const w of weeks) w.share = share(w.onTime, w.rows)
  const shown = new Set(weeks.map(w => w.key))
  const shownObs = obs.filter(o => shown.has(o.week))
  const latestClosed = [...weeks].reverse().find(w => !w.open) ?? null
  const alert = latestClosed != null && latestClosed.share != null && latestClosed.share < LOG_ALERT_BELOW
  const surveys = new Set(shownObs.map(o => o.project)).size

  let cannot: string | null = null
  if (!weeks.length) {
    cannot = notes.length
      ? 'No blast or panel row in view can be placed, for the reasons below.'
      : 'No blast or panel row in view falls in the selected dates.'
  }
  let verdict: string
  if (cannot) verdict = 'Nothing to measure yet: record blasts and panel buys as the work happens and this strip fills in.'
  else if (!latestClosed) verdict = `Every week shown is still inside its ${fmtNum(LOG_WITHIN_DAYS)}-day window, so it is too early to call.`
  else {
    const s = `In the week of ${latestClosed.label}, ${pctText(latestClosed.share)} of ${pl(latestClosed.rows, 'row')} ${verb(latestClosed.rows, 'was', 'were')} written within ${fmtNum(LOG_WITHIN_DAYS)} days of the work`
    verdict = alert
      ? `${s}, below the ${pctText(LOG_ALERT_BELOW)} alert. Log blasts and panel buys within a week of the work, or the recent months will read cheaper than they were.`
      : `${s}, at or above the ${pctText(LOG_ALERT_BELOW)} bar. Keep logging within the week.`
  }
  return {
    weeks, notes, cannot, latestClosed, alert, surveys,
    chip: chipFor(ctx, LIVE_AND_DELIVERED, surveys),
    verdict,
    obs: shownObs,
  }
}

/**
 * One week's late rows and the surveys it touches, recounted STRAIGHT FROM THE
 * RAW ROWS — never from the strip's placed observations.
 *
 * The strip's own count and the drill's rows both come from `buildLogging`, so
 * checking one against the other could never turn red. This walks the blast,
 * supplier and launch rows itself, through the published `writtenWithin` rule,
 * so a placement bug in the strip shows up as a disagreement (rule 5).
 */
function weekFromRaw(ctx: Ctx, weekKey: string): { late: number; ids: string[] } {
  const popIds = new Set(idsOf(ctx.pop))
  const today = ctx.input.today
  const from = ctx.range.from
  const to = ctx.range.to && ctx.range.to < today ? ctx.range.to : today
  const ids = new Set<string>()
  let late = 0
  const take = (project: string, created: string | null | undefined, work: string | null | undefined) => {
    const w = etDay(work)
    if (!w || weekOf(w) !== weekKey) return
    if ((from && w < from) || w > to) return
    const ok = writtenWithin(created, w)
    if (ok == null) return // no written-on time: the strip names it and leaves it out
    ids.add(project)
    if (!ok) late++
  }
  if (!ctx.blocked('project_blasts')) {
    for (const b of ctx.raw.blasts) {
      if (popIds.has(b.project_id)) take(b.project_id, b.created_at, b.blast_at ?? b.scheduled_at ?? null)
    }
  }
  if (!ctx.blocked('project_suppliers') && !ctx.blocked('project_launches')) {
    const launch = new Map(ctx.raw.launches.map(l => [l.id, l]))
    for (const s of ctx.raw.suppliers) {
      if (!popIds.has(s.project_id)) continue
      take(s.project_id, s.created_at, s.launch_id ? launch.get(s.launch_id)?.launch_date ?? null : null)
    }
  }
  return { late, ids: [...ids] }
}

/** The drill behind one week of the strip: the surveys with a row that week,
 *  counting the rows written late. Checked against a recount of the week made
 *  from the raw rows (`weekFromRaw`), not against the strip's own figure. */
export function loggingWeekDrill(input: ImproveInput, strip: LoggingStrip, weekKey: string): DrillSpec {
  const ctx = makeCtx(input)
  const week = strip.weeks.find(w => w.key === weekKey)
  const check = weekFromRaw(ctx, weekKey)
  const byProject = new Map<string, { rows: number; late: number; maxLag: number }>()
  for (const o of strip.obs) {
    if (o.week !== weekKey) continue
    const e = byProject.get(o.project) ?? { rows: 0, late: 0, maxLag: -Infinity }
    e.rows++
    if (!o.onTime) e.late++
    e.maxLag = Math.max(e.maxLag, o.lag)
    byProject.set(o.project, e)
  }
  const item = new Map(input.items.map(it => [it.p.id, it]))
  const rows: DrillRow[] = [...byProject.entries()].map(([id, e]) => {
    const it = item.get(id)
    return {
      id, code: it?.p.project_code ?? null, contribution: e.late,
      account: it ? ctx.account(it.p) : '(unknown)', rowsN: e.rows, late: e.late,
      lag: e.maxLag,
    }
  }).sort((a, b) => b.contribution - a.contribution || Number(b.lag) - Number(a.lag))
  return {
    key: `improve-logging-${weekKey}`,
    title: `Rows for the week of ${week?.label ?? dayLabel(weekKey)}: ${pl(week?.late ?? 0, 'row')} written late`,
    population: `${strip.chip} · week of ${week?.label ?? dayLabel(weekKey)}`,
    columns: [
      { key: 'account', header: 'Account', tip: 'The client account, by its consolidated name.', value: r => String(r.account ?? '') },
      { key: 'rowsN', header: 'Rows that week', tip: 'Blast and panel rows recording work done that week.', num: true, value: r => fmtNum(Number(r.rowsN)) },
      { key: 'late', header: 'Written late', tip: `Rows written more than ${LOG_WITHIN_DAYS} days after the work.`, num: true, value: r => fmtNum(Number(r.late)) },
      { key: 'lag', header: 'Longest delay (days)', tip: 'The most days between the work and the row being written. Negative means written ahead (a scheduled blast).', num: true, value: r => fmtNum(Number(r.lag)) },
    ],
    rows,
    expectedTotal: check.late,
    expectedIds: check.ids,
    totalLabel: 'Rows written late',
    format: 'number',
  }
}

/* ── THE RANKED GAPS ──────────────────────────────────────────────────────── */

export type GapKey =
  | 'price' | 'sms-rate' | 'ps-rows' | 'route-split' | 'post-qa-n' | 'no-date' | 'recoveries'
  | 'budgets' | 'priced-blocked' | 'zero-price' | 'placeholder-flag' | 'segments' | 'stale-phase'
  | 'empty-term' | 'wave-target' | 'b2b-rows'

export type GapStatus = 'open' | 'resolved' | 'blocked'
export type DollarsKind = 'spend' | 'price' | 'estimate' | 'none'

export const DOLLARS_KIND_LABEL: Record<DollarsKind, string> = {
  spend: 'Recorded cost',
  price: 'Client price',
  estimate: 'Estimate',
  none: 'No dollars',
}

export interface GapAccount {
  id: string | null
  name: string
  count: number
  dollars: number | null
  note: string | null
  /** A page for this account outside the finance hub (the client page), when
   *  that is where the fix is made. */
  href?: string
}

export interface Gap {
  key: GapKey
  /** Its number in the finance spec's list, 1–16. */
  specNo: number
  title: string
  help: string
  status: GapStatus
  /** The computed sentence: what the gap is, how much it hides. */
  what: string
  /** How many records carry the gap, in `unit`s. */
  count: number
  unit: string
  /** How many surveys that touches. */
  surveys: number
  ids: string[]
  dollars: number | null
  dollarsKind: DollarsKind
  /** "of recorded cost no margin can see" — what the dollars are. */
  dollarsWords: string
  who: string
  when: string
  where: string
  details: string[]
  accounts: GapAccount[]
  /** A single real page to go to, when the gap is on one survey or one client. */
  link: { href: string; label: string } | null
  drill: DrillSpec | null
  /** The one-line resolved or blocked note. */
  note: string | null
}

interface GapBase {
  key: GapKey; specNo: number; title: string; help: string; who: string; when: string; where: string
  unit?: string; needs: FinanceTable[]; price?: boolean
}

const blankGap = (b: GapBase): Gap => ({
  key: b.key, specNo: b.specNo, title: b.title, help: b.help, status: 'open', what: '',
  count: 0, unit: b.unit ?? 'study', surveys: 0, ids: [], dollars: null, dollarsKind: 'none', dollarsWords: '',
  who: b.who, when: b.when, where: b.where, details: [], accounts: [], link: null, drill: null, note: null,
})

/** A gap whose inputs did not load. Never "resolved": a failed read is not a fix. */
function checkBlocked(ctx: Ctx, b: GapBase): Gap | null {
  const failed = b.needs.find(t => ctx.blocked(t))
  if (failed) return { ...blankGap(b), status: 'blocked', note: `${blockedText(failed)}, so this cannot be checked.` }
  if (b.price && ctx.priceBlock) return { ...blankGap(b), status: 'blocked', note: `${ctx.priceBlock}, so this cannot be checked.` }
  return null
}

const resolved = (b: GapBase, note: string, extra: Partial<Gap> = {}): Gap =>
  ({ ...blankGap(b), status: 'resolved', note, ...extra })

const oneLink = (items: FinItem[]) =>
  items.length === 1 ? { href: `/projects/${items[0].p.id}`, label: `Open ${items[0].p.project_code ?? 'the study'}` } : null

interface GapRowIn { it: FinItem; amount: number | null; detail: string; where?: string }

/** One gap's drill. `expectedTotal` must come from a different function than
 *  the rows (spendOfIds, marginOf), or be null for an estimate — then only the
 *  ids are checked, against the list the gap's own figure counted. */
function gapDrill(ctx: Ctx, g: {
  key: GapKey; title: string; rows: GapRowIn[]; expectedTotal: number | null; expectedIds: string[]
  totalLabel: string; amountHeader: string; amountTip: string; detailHeader: string; detailTip: string
  where: string; rule?: TabRule
}): DrillSpec {
  const rows: DrillRow[] = g.rows
    .map(r => ({
      id: r.it.p.id, code: r.it.p.project_code, contribution: r.amount ?? 0,
      account: ctx.account(r.it.p), date: r.it.date, detail: r.detail, amount: r.amount,
      where: r.where ?? g.where,
    }))
    .sort((a, b) => b.contribution - a.contribution || String(a.code).localeCompare(String(b.code)))
  const columns: DrillColumn[] = [
    { key: 'account', header: 'Account', tip: 'The client account, by its consolidated name.', value: r => String(r.account ?? '') },
    { key: 'date', header: 'Date', tip: 'Deliver date, else launch date, else submitted date.', value: r => (r.date as string | null) ?? 'No date' },
    { key: 'detail', header: g.detailHeader, tip: g.detailTip, value: r => String(r.detail ?? '') },
    { key: 'amount', header: g.amountHeader, tip: g.amountTip, num: true, value: r => moneyOrDash(r.amount as number | null) },
    { key: 'where', header: 'Where to fix', tip: 'Where the field is entered. The study code opens its project page.', value: r => String(r.where ?? '') },
  ]
  return {
    key: `improve-gap-${g.key}`,
    title: g.title,
    population: chipFor(ctx, g.rule ?? LIVE_AND_DELIVERED, rows.length),
    columns, rows,
    expectedTotal: g.expectedTotal,
    expectedIds: g.expectedIds,
    totalLabel: g.totalLabel,
    format: 'money',
  }
}

const spendIds = (ctx: Ctx, ids: string[]) => spendOfIds(ids, ctx.raw.blasts, ctx.raw.suppliers, ctx.raw.costs)

/* 1 ─ client price missing on costed work ─────────────────────────────────── */

const PRICE: GapBase = {
  key: 'price', specNo: 1, title: 'Client price missing on costed work',
  help: `Delivered studies that carry a recorded cost but no client price sit outside every margin figure. This stays on the list until priced studies hold at least ${pctText(PRICE_COVERAGE_GOAL)} of the delivered spend in view. Internal work needs a price too: record $0, or a transfer price.`,
  who: 'Finance (David or Vineet)',
  when: 'When the study is sold. For past work, from the contract or the last quote to that account.',
  where: 'Project page → Money → Price / N',
  needs: ['project_blasts', 'project_suppliers', 'project_costs'], price: true,
}

function gapPrice(ctx: Ctx, scan: PriceScan): Gap {
  const b = checkBlocked(ctx, PRICE)
  if (b) return b
  const { hits, header, last } = scan
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const rows: GapRowIn[] = hits.map(it => {
    const acc = it.p.client_id
    const onRoute = acc && it.route !== 'none' ? last.byAccRoute.get(`${acc}|${it.route}`) : undefined
    const any = acc ? last.byAcc.get(acc) : undefined
    const cite = (x: LastPrice) => `${perN(x.rate)} (${x.code ?? 'a study'})`
    // Same route first. A price from the OTHER route is shown as a warning, not
    // a suggestion: a panel survey priced at a blast rate is ~40× too dear.
    const detail = isInternal(ctx.account(it.p)) ? 'Internal work: record $0, or a transfer price'
      : onRoute ? `Last ${ROUTE_WORD[it.route]} price at this account: ${cite(onRoute)}`
        : any && it.route === 'none' ? `Last price at this account: ${cite(any)}`
          : any ? `No ${ROUTE_WORD[it.route]} price at this account yet; its last price, ${cite(any)}, is on another route — check before copying`
            : 'No price at this account yet'
    return { it, amount: ctx.spend(it.p).total, detail }
  })
  const accounts: GapAccount[] = header.top.map(a => ({
    id: a.id, name: a.name, count: a.surveys, dollars: a.spend,
    note: a.internal ? 'Internal: record $0 or a transfer price.'
      : a.lastByRoute.length
        ? `Last priced: ${a.lastByRoute.slice().sort((x, y) => x.route.localeCompare(y.route))
          .map(x => `${ROUTE_WORD[x.route]} ${perN(x.rate)} (${x.code ?? 'a study'})`).join('; ')}.`
        : a.lastPrice ? `Last priced at ${perN(a.lastPrice.rate)} (${a.lastPrice.code ?? 'a study'}), on another route.` : 'No price at this account yet.',
  }))
  const extra: Partial<Gap> = {
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of recorded cost that no margin can see', accounts, link: oneLink(hits),
    drill: hits.length ? gapDrill(ctx, {
      key: 'price', title: `Costed work with no client price · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded on the study — the spend no margin can see until it is priced.',
      detailHeader: 'Pre-fill from', detailTip: 'The most recent price above $0 at the same account (on the same route when there is one), to start the backfill from.',
      where: PRICE.where, rule: DELIVERED_RULE,
    }) : null,
  }
  if (!hits.length) return resolved(PRICE, 'Every delivered study with a recorded cost in view carries a client price.')
  const pctNow = header.spendPct
  if (pctNow != null && pctNow >= PRICE_COVERAGE_GOAL) {
    return resolved(PRICE,
      `Priced studies hold ${pctText(pctNow)} of delivered spend in view, past the ${pctText(PRICE_COVERAGE_GOAL)} goal; ${pl(hits.length, 'costed study', 'costed studies')} ${verb(hits.length, 'is', 'are')} still unpriced.`,
      extra)
  }
  return {
    ...blankGap(PRICE), ...extra,
    what: `${pl(hits.length, 'delivered study', 'delivered studies')} ${verb(hits.length, 'carries', 'carry')} ${money(dollars)} of recorded cost and no client price, so no margin can see ${verb(hits.length, 'it', 'them')}. Priced studies hold ${pctText(pctNow)} of delivered spend in view; this stays listed until they hold ${pctText(PRICE_COVERAGE_GOAL)}.`,
  }
}

/* 2 ─ SMS send cost assumed ──────────────────────────────────────────────── */

const SMS: GapBase = {
  key: 'sms-rate', specNo: 2, title: 'SMS send cost is assumed, not invoiced',
  help: 'Text blasts are costed at the per-message rate on each blast. When every SMS blast carries one identical rate, it is a default nobody has checked against the carrier invoice. It stays listed while that is true.',
  who: 'Finance', when: 'Once, from the carrier invoice; then monthly.',
  where: 'Each blast’s cost per send (Project page → Blasts)', unit: 'study', needs: ['project_blasts'],
}

function gapSms(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, SMS)
  if (b) return b
  const popIds = new Set(idsOf(ctx.pop))
  const sms = ctx.raw.blasts.filter(x => popIds.has(x.project_id) && x.channel !== 'email' && Number(x.people ?? 0) > 0)
  if (!sms.length) return resolved(SMS, 'No SMS sends in view.')
  const rates = [...new Set(sms.map(x => Number(x.cost_per_send ?? 0)))]
  if (rates.length > 1) {
    return resolved(SMS, `SMS blasts in view carry ${fmtNum(rates.length)} different per-message rates, so they are not all one unchecked default.`)
  }
  // The aggregate straight off the blast rows; the drill groups by survey.
  const dollars = sum(sms, x => Number(x.people ?? 0) * Number(x.cost_per_send ?? 0))
  const byP = new Map<string, { sends: number; blasts: number; cost: number }>()
  for (const x of sms) {
    const e = byP.get(x.project_id) ?? { sends: 0, blasts: 0, cost: 0 }
    e.sends += Number(x.people ?? 0); e.blasts++; e.cost += Number(x.people ?? 0) * Number(x.cost_per_send ?? 0)
    byP.set(x.project_id, e)
  }
  const item = new Map(ctx.pop.map(it => [it.p.id, it]))
  const hitItems = [...byP.keys()].map(id => item.get(id)).filter((x): x is FinItem => !!x)
  const rows: GapRowIn[] = hitItems.map(it => {
    const e = byP.get(it.p.id)!
    return { it, amount: e.cost, detail: `${fmtNum(e.sends)} texts in ${pl(e.blasts, 'blast')}` }
  })
  const ids = idsOf(hitItems)
  return {
    ...blankGap(SMS),
    count: ids.length, surveys: ids.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of send cost resting on one assumed rate',
    what: `Every SMS blast in view is costed at ${money2(rates[0])} a message: ${money(dollars)} of send cost across ${pl(sms.length, 'blast')} on ${pl(ids.length, 'study', 'studies')}. One carrier invoice confirms or corrects it.`,
    link: oneLink(hitItems),
    drill: gapDrill(ctx, {
      key: 'sms-rate', title: `SMS sends at one assumed rate · ${pl(ids.length, 'study', 'studies')}`, rows,
      // Not `dollars`: that and the rows are the same loop over the same blast
      // rows, so the strip could never turn red. spendOf reaches the send cost
      // by its own indexed path (email sends are free there, as they are here).
      expectedTotal: sum(hitItems, it => ctx.spend(it.p).send),
      expectedIds: ids, totalLabel: 'Send cost on these studies',
      amountHeader: 'Send cost', amountTip: 'Texts sent × the per-message rate on each blast.',
      detailHeader: 'Texts sent', detailTip: 'People texted across the study’s SMS blasts.',
      where: SMS.where,
    }),
  }
}

/* 3 & 16 ─ field rows missing on the route a survey was filed as ─────────── */

const PS_ROWS: GapBase = {
  key: 'ps-rows', specNo: 3, title: 'Panel purchases missing on PureSpectrum studies',
  help: 'Delivered studies filed as PureSpectrum (PS) with no panel purchase recorded read $0 of cost. The dollars are an estimate at the middle panel cost per complete on the book, never added to a recorded figure. A study far larger than any PS study that does record its panel purchases is listed but never sized.',
  who: 'Ops', when: 'When each wave closes: pull the Buyer Surveys export and run the PureSpectrum import.',
  where: 'Project page → Suppliers', needs: ['project_suppliers', 'project_blasts', 'project_costs'],
}
const B2B_ROWS: GapBase = {
  key: 'b2b-rows', specNo: 16, title: 'Blasts missing on B2B studies',
  help: 'Delivered studies filed as B2B with no blast recorded read $0 of cost. The dollars are an estimate at the middle blast cost per complete on the book, never added to a recorded figure. A study far larger than any B2B study that does record its blasts is listed but never sized.',
  who: 'Ops', when: 'When each blast goes out — log it, or import the blast platform’s CSV.',
  where: 'Project page → Blasts', needs: ['project_blasts', 'project_suppliers', 'project_costs'],
}

function gapRouteRows(ctx: Ctx, base: GapBase, type: 'PS' | 'B2B'): Gap {
  const b = checkBlocked(ctx, base)
  if (b) return b
  const own = type === 'PS' ? ctx.ix.suppliers : ctx.ix.blasts
  const other = type === 'PS' ? ctx.ix.blasts : ctx.ix.suppliers
  const route = type === 'PS' ? 'panel' : 'blast'
  const rowWord = type === 'PS' ? 'panel purchases' : 'blasts'
  const filed = ctx.delivered.filter(it => it.p.project_type === type)
  if (!filed.length) return resolved(base, `No delivered study in view is filed as ${type}.`)
  const hits = filed.filter(it => !(own.get(it.p.id)?.length))
  if (!hits.length) return resolved(base, `Every delivered ${type} study in view has its ${rowWord} recorded.`)
  const misfiled = hits.filter(it => (other.get(it.p.id)?.length ?? 0) > 0)
  const median = ctx.medians()[route]
  const otherWord = type === 'PS' ? 'blast' : 'panel'
  // A survey far larger than any survey of its kind that DOES record its rows
  // was probably fielded some other way — a client-distributed list — and
  // pricing it at the usual rate would build most of the estimate out of one
  // row. It is listed with its size, and left unsized.
  const cap = ctx.sizeCap(type)
  const sized: { it: FinItem; n: number; est: number }[] = []
  let outsized = 0
  const rows: GapRowIn[] = hits.map(it => {
    if ((other.get(it.p.id)?.length ?? 0) > 0) {
      return { it, amount: 0, detail: `Fielded by ${otherWord}: correct the type`, where: 'Project page → Type' }
    }
    const n = completesOf(it.p)
    if (n <= 0) return { it, amount: null, detail: 'No completes recorded, so no estimate' }
    if (cap && n > cap.value) {
      outsized++
      return {
        it, amount: null,
        detail: `${fmtNum(n)} completes, larger than ${pctText(OUTSIZED_ABOVE)} of the ${fmtNum(cap.n)} ${type} studies that do record their ${rowWord} (${fmtNum(cap.value)} and under): not sized — check how it was fielded (a client list?)`,
      }
    }
    const est = median ? n * median.median : null
    if (est != null) sized.push({ it, n, est })
    return { it, amount: est, detail: `${fmtNum(n)} completes, about ${moneyOrDash(est)}` }
  })
  const est = sized.length ? sum(sized, s => s.est) : null
  const completes = sum(sized, s => s.n)
  // Checked against coverage.ts — a different coding of the same question.
  const expectedIds = ctx.popCoverage()[type === 'PS' ? 'psPanelRows' : 'b2bBlastRows'].missingIds
  let what = `${fmtNum(hits.length)} of ${fmtNum(filed.length)} delivered ${type} studies have no ${rowWord} recorded, so their cost reads $0 here.`
  if (median && est != null && est > 0) {
    // "the middle survey", not "the median": hub.ts takes the upper of the two
    // middle values on an even sample, which is not quite a median.
    const whose = sized.length === hits.length
      ? `their ${fmtNum(completes)} completes`
      : `the ${fmtNum(completes)} completes on ${fmtNum(sized.length)} of them`
    what += ` At ${money(median.median)} per complete — the middle of the ${pl(median.n, `${route} study`, `${route} studies`)} the book can rate — ${whose} cost about ${money(est)}.`
    const top = sized.slice().sort((a, b) => b.est - a.est)[0]
    if (sized.length > 1 && top.est >= CONCENTRATION_SHARE * est) {
      what += ` ${top.it.p.project_code ?? 'One study'} alone is about ${money(top.est)} of that.`
    }
  } else if (!median) {
    what += ` The book has no ${route} studies to size them against, so the cost cannot be estimated.`
  }
  if (outsized) {
    what += ` ${pl(outsized, 'study', 'studies')} ${verb(outsized, 'is', 'are')} too large to size this way and ${verb(outsized, 'is', 'are')} left out of the estimate: check how ${verb(outsized, 'it was', 'they were')} fielded.`
  }
  if (misfiled.length) {
    what += ` ${pl(misfiled.length, 'study', 'studies')} ${verb(misfiled.length, 'is', 'are')} filed as ${type} but fielded by ${otherWord}: correct the type instead.`
  }
  const ids = idsOf(hits)
  return {
    ...blankGap(base),
    count: hits.length, surveys: hits.length, ids,
    dollars: est != null && est > 0 ? est : null, dollarsKind: est != null && est > 0 ? 'estimate' : 'none',
    dollarsWords: `of ${route} cost not recorded (estimated)`,
    what, link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: base.key, title: `${type} studies with no ${rowWord} · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: null, expectedIds, totalLabel: 'Estimated, so only the study list is checked',
      amountHeader: 'Estimated cost', amountTip: `Completes × the middle ${route} cost per complete on the book. Not a recorded figure, and blank on a study too large to size this way.`,
      detailHeader: 'What is known', detailTip: 'Completes bought (or delivered, when that is all there is).',
      where: base.where, rule: DELIVERED_RULE,
    }),
  }
}

/* 4 ─ route split on surveys fielded both ways ────────────────────────────── */

const SPLIT: GapBase = {
  key: 'route-split', specNo: 4, title: 'Studies fielded both ways, not split by route',
  help: 'A study fielded through both blasts and panels only counts toward cost per respondent once its delivered N is split by route and every cost line names a route. Until then its whole cost is held out of both cards.',
  who: 'Analyst', when: 'At delivery: join the deliverable’s transaction IDs to the PureSpectrum export to count each route.',
  where: 'N actual by route (panel and blast), set through the connector’s update_project', needs: ['project_blasts', 'project_suppliers', 'project_costs'],
}

const SPLIT_WORDS: Partial<Record<LegBlock, string>> = {
  'unrouted-cost': 'a cost line names no route',
  'no-split': 'no delivered N by route',
  'split-mismatch': 'the route split does not add up to the N actual',
  'estimated': 'the route split is an estimate',
  'no-n-actual': 'no N actual yet',
  'partial-n-actual': 'the N actual counts only some segments',
  'under-recorded': 'the field rows do not cover the N collected',
}

function gapSplit(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, SPLIT)
  if (b) return b
  const both = ctx.delivered.filter(it => it.route === 'both')
  if (!both.length) return resolved(SPLIT, 'No delivered study in view was fielded both ways.')
  const hits = both
    .map(it => {
      const l = legsOf(it.p, ctx.raw.blasts, ctx.raw.suppliers, ctx.raw.costs, ctx.ix)
      return { it, reason: l.reason !== 'ok' ? l.reason : l.splitReason }
    })
    .filter(x => x.reason !== 'ok')
  if (!hits.length) return resolved(SPLIT, `All ${pl(both.length, 'study', 'studies')} fielded both ways in view ${verb(both.length, 'is', 'are')} split by route.`)
  const ids = hits.map(x => x.it.p.id)
  const dollars = spendIds(ctx, ids)
  const counts = new Map<string, number>()
  for (const x of hits) counts.set(x.reason, (counts.get(x.reason) ?? 0) + 1)
  const details = [...counts.entries()].sort((a, c) => c[1] - a[1])
    .map(([r, n]) => `${fmtNum(n)}: ${SPLIT_WORDS[r as LegBlock] ?? r}`)
  const rows: GapRowIn[] = hits.map(x => ({
    it: x.it, amount: ctx.spend(x.it.p).total,
    detail: SPLIT_WORDS[x.reason as LegBlock] ?? x.reason,
    where: x.reason === 'unrouted-cost' ? 'Project page → Cost lines → Route'
      : x.reason === 'no-n-actual' || x.reason === 'partial-n-actual' ? 'Project page → N Actual' : SPLIT.where,
  }))
  const items = hits.map(x => x.it)
  return {
    ...blankGap(SPLIT),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of cost held out of both cost-per-respondent cards',
    what: `${fmtNum(hits.length)} of ${fmtNum(both.length)} delivered studies fielded through both blasts and panels cannot be split by route, so ${money(dollars)} is held out of both cost-per-respondent cards.`,
    details, link: oneLink(items),
    drill: gapDrill(ctx, {
      key: 'route-split', title: `Fielded both ways, not split · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'The study’s whole field cost, held out of both route cards until it is split.',
      detailHeader: 'What blocks the split', detailTip: 'The first missing fact that stops the study being split by route.',
      where: SPLIT.where, rule: DELIVERED_RULE,
    }),
  }
}

/* 5 ─ post-QA N missing ───────────────────────────────────────────────────── */

const POSTQA: GapBase = {
  key: 'post-qa-n', specNo: 5, title: 'N actual (after QA) missing on delivered work',
  help: 'Only the N actual can be billed, and every per-respondent figure divides by it. A delivered study without one has no revenue, no cost per respondent and no scrub.',
  who: 'Captain', when: 'At Delivery — one field, from the QA’d deliverable.',
  where: 'Project page → N Actual', needs: ['project_segments', 'project_blasts', 'project_suppliers', 'project_costs'],
}

function gapPostQa(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, POSTQA)
  if (b) return b
  const hits = ctx.delivered.filter(it => deliveredNOf(it.p).n == null)
  if (!hits.length) return resolved(POSTQA, 'Every delivered study in view has its N actual.')
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const priced = ctx.priceBlock ? [] : hits.filter(it => hasPrice(it.p, ctx.rates.get(it.p.id)))
  let what = `${pl(hits.length, 'delivered study', 'delivered studies')} ${verb(hits.length, 'has', 'have')} no N actual, so ${verb(hits.length, 'it has', 'they have')} no revenue, cost per respondent or scrub: ${money(dollars)} of cost sits outside every per-respondent figure.`
  if (priced.length) what += ` ${fmtNum(priced.length)} of them ${verb(priced.length, 'is', 'are')} priced, so ${verb(priced.length, 'its', 'their')} client price cannot be computed until the N lands.`
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: ctx.spend(it.p).total,
    detail: it.p.n_collected ? `${fmtNum(Number(it.p.n_collected))} collected; N actual blank` : 'Nothing collected or delivered recorded',
  }))
  return {
    ...blankGap(POSTQA),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of cost no revenue or per-respondent figure can use',
    what, link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'post-qa-n', title: `Delivered with no N actual · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ctx.popCoverage().postQaN.missingIds, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded on the study.',
      detailHeader: 'What is known', detailTip: 'The N collected (before QA), which is never billed.',
      where: POSTQA.where, rule: DELIVERED_RULE,
    }),
  }
}

/* 6 ─ no date ─────────────────────────────────────────────────────────────── */

const NODATE: GapBase = {
  key: 'no-date', specNo: 6, title: 'Delivered studies with no date',
  help: 'A study is placed in a month by its deliver date, else launch date, else submitted date. With none of the three it drops out of every date range. Counted here whatever dates are picked, because no range can reach them.',
  who: 'Captain', when: 'At Delivery — the deliver date from the delivery email.',
  where: 'Project page → Delivery date', needs: ['project_blasts', 'project_suppliers', 'project_costs'],
}

function gapNoDate(ctx: Ctx, grid: CoverageGrid): Gap {
  const b = checkBlocked(ctx, NODATE)
  if (b) return b
  const f = ctx.input.filter
  const hits = ctx.input.items.filter(it =>
    it.cls === 'delivered' && it.date == null
    && (!f.account || it.p.client_id === f.account)
    && (f.route === 'all' || it.route === f.route))
  if (!hits.length) return resolved(NODATE, 'Every delivered study in view has a date.')
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const rule: TabRule = { ...DELIVERED_RULE, date: false, ignoredNote: 'All dates (these have none)' }
  const undated = grid.cells.find(c => c.row === 'date' && c.col === 'undated')
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: ctx.spend(it.p).total,
    detail: it.p.delivered_at ? `Marked delivered ${etDay(it.p.delivered_at)} (a stamp, not a delivery date)` : 'No date at all',
  }))
  return {
    ...blankGap(NODATE),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of cost that appears in no date range',
    what: `${pl(hits.length, 'delivered study', 'delivered studies')} ${verb(hits.length, 'has', 'have')} no deliver, launch or submitted date, so ${verb(hits.length, 'it falls', 'they fall')} out of every date range, carrying ${money(dollars)}. Counted here whatever dates are picked.`,
    link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'no-date', title: `Delivered with no date · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: undated?.missingIds ?? [], totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded on the study.',
      detailHeader: 'What is known', detailTip: 'The system’s delivered-at stamp is not a date to place the study by: it was bulk-stamped.',
      where: NODATE.where, rule,
    }),
  }
}

/* 7 ─ reward recoveries not booked ────────────────────────────────────────── */

const RECOVER: GapBase = {
  key: 'recoveries', specNo: 7, title: 'Reward recoveries not booked',
  help: 'Unclaimed blast rewards come back and are booked as negative cost lines, in batches. Until a study’s recoveries are booked it reads dearer than it was. The dollars are an estimate at the share of rewards already recovered on the studies that have been swept. A study whose rewards were all claimed stays listed: there is no field yet for "nothing came back".',
  who: 'Ops', when: 'A monthly sweep of unclaimed rewards on the blast platform.',
  where: 'Project page → Cost lines (a negative line for what came back)', needs: ['project_blasts', 'project_costs'],
}

function gapRecoveries(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, RECOVER)
  if (b) return b
  const credited = (it: FinItem) => (ctx.ix.costs.get(it.p.id) ?? []).some(isCredit)
  const rewarded = ctx.delivered.filter(it => ctx.spend(it.p).reward > 0)
  if (!rewarded.length) return resolved(RECOVER, 'No delivered study in view paid blast rewards.')
  const hits = rewarded.filter(it => !credited(it))
  if (!hits.length) return resolved(RECOVER, 'Every delivered study in view that paid rewards has its recoveries booked.')
  // The recovery rate on surveys already swept: the view's, else the book's.
  const rateOn = (xs: FinItem[]) => {
    const swept = xs.filter(it => ctx.spend(it.p).reward > 0 && credited(it))
    const gross = sum(swept, it => ctx.spend(it.p).reward)
    return swept.length && gross > 0 ? { rate: -sum(swept, it => ctx.spend(it.p).recovered) / gross, n: swept.length } : null
  }
  const measured = rateOn(rewarded) ?? rateOn(ctx.input.items.filter(it => it.cls === 'delivered'))
  const gross = sum(hits, it => ctx.spend(it.p).reward)
  const est = measured ? gross * measured.rate : null
  const byMonth = new Map<string, { of: number; missing: number }>()
  for (const it of rewarded) {
    const k = monthKey(it.date)
    const e = byMonth.get(k) ?? { of: 0, missing: 0 }
    e.of++
    if (!credited(it)) e.missing++
    byMonth.set(k, e)
  }
  const details = [...byMonth.entries()].filter(([, e]) => e.missing > 0)
    .sort((a, c) => (a[0] === 'undated' ? 1 : c[0] === 'undated' ? -1 : c[0].localeCompare(a[0])))
    .map(([k, e]) => `${monthLabel(k)}: ${fmtNum(e.missing)} of ${fmtNum(e.of)} not booked`)
  let what = `${fmtNum(hits.length)} of ${fmtNum(rewarded.length)} delivered studies that paid blast rewards have no recovered-reward line yet (${money(gross)} of rewards).`
  what += measured
    ? ` At the ${pctText(measured.rate)} recovered on the ${pl(measured.n, 'study', 'studies')} already swept, about ${money(est ?? 0)} may come back.`
    : ' No study has had its recoveries booked yet, so the amount cannot be sized.'
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: measured ? ctx.spend(it.p).reward * measured.rate : null,
    detail: `${money(ctx.spend(it.p).reward)} of rewards paid; nothing recovered booked`,
  }))
  const ids = idsOf(hits)
  return {
    ...blankGap(RECOVER),
    count: hits.length, surveys: hits.length, ids,
    dollars: est, dollarsKind: est != null ? 'estimate' : 'none',
    dollarsWords: 'of unclaimed rewards that may come back (estimated)',
    what, details, link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'recoveries', title: `Rewards with no recovery booked · ${pl(hits.length, 'study', 'studies')}`, rows,
      // The amount is an estimate, so only the survey list is checked — and
      // against coverage.ts's own rewarded-but-uncredited list, not `ids`,
      // which is the same array the rows were built from.
      expectedTotal: null, expectedIds: recoveriesMissing(ctx.popMonths()),
      totalLabel: 'Estimated, so only the study list is checked',
      amountHeader: 'May come back (about)', amountTip: 'Rewards paid × the share recovered on studies already swept. Not a recorded figure.',
      detailHeader: 'Rewards', detailTip: 'Blast rewards paid (bid × completes).',
      where: RECOVER.where, rule: DELIVERED_RULE,
    }),
  }
}

/* 8 ─ budgets ─────────────────────────────────────────────────────────────── */

const BUDGET: GapBase = {
  key: 'budgets', specNo: 8, title: 'Budgets missing',
  help: `A budget is the most we plan to spend — a cost ceiling, not revenue. Without one, an overrun cannot be seen. Suggested at ${pctText(1 - KEEP_GOAL)} of price × N sold: a guide, not a rule.`,
  who: 'Captain, or finance at intake', when: 'At intake, when the study is sold.',
  where: 'Project page → Money → Budget', needs: ['project_blasts', 'project_suppliers', 'project_costs'], price: true,
}

function gapBudgets(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, BUDGET)
  if (b) return b
  const hasBudget = (p: FinProject) => Number(p.budget ?? 0) > 0
  const marginSet = ctx.delivered.filter(it =>
    revenueDetail(it.p, ctx.rates.get(it.p.id)).revenue != null && ctx.spend(it.p).total > 0)
  const liveSpending = ctx.live.filter(it => ctx.spend(it.p).total > 0)
  const a = marginSet.filter(it => !hasBudget(it.p))
  const l = liveSpending.filter(it => !hasBudget(it.p))
  const hits = [...a, ...l]
  if (!marginSet.length && !liveSpending.length) return resolved(BUDGET, 'No margin-set or live spending study in view.')
  if (!hits.length) return resolved(BUDGET, 'Every margin-set and live spending study in view has a budget.')
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const suggest = (p: FinProject) => suggestedBudget(ctx.rates.get(p.id), p.n_target)
  const suggested = hits.map(it => suggest(it.p)).filter((x): x is number => x != null)
  const rows: GapRowIn[] = hits.map(it => {
    const s = suggest(it.p)
    return {
      it, amount: ctx.spend(it.p).total,
      detail: `${it.cls === 'active' ? 'Live, spending with no budget' : 'In the margin set, no budget'}${s != null ? `; suggested ${money(s)}` : ''}`,
    }
  })
  const details = suggested.length
    ? [`Suggested budgets (${pctText(1 - KEEP_GOAL)} of price × N sold) come to ${money(sum(suggested, x => x))} across the ${pl(suggested.length, 'study', 'studies')} that ${verb(suggested.length, 'carries', 'carry')} a price and a target.`]
    : []
  return {
    ...blankGap(BUDGET),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: 'spend',
    dollarsWords: 'of cost with no budget to check it against',
    what: `${fmtNum(a.length)} of the ${pl(marginSet.length, 'study', 'studies')} in the margin set ${verb(a.length, 'has', 'have')} no budget, and ${fmtNum(l.length)} of ${pl(liveSpending.length, 'live study', 'live studies')} ${verb(l.length, 'is', 'are')} spending with none — ${money(dollars)} of cost with no ceiling to check it against.`,
    details, link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'budgets', title: `No budget · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded on the study so far.',
      detailHeader: 'Status', detailTip: `Live or delivered, and the suggested budget (${pctText(1 - KEEP_GOAL)} of price × N sold) where there is a price and a target.`,
      where: BUDGET.where,
    }),
  }
}

/* 9 ─ priced but blocked ──────────────────────────────────────────────────── */

const BLOCKEDP: GapBase = {
  key: 'priced-blocked', specNo: 9, title: 'Priced, but the margin cannot count it yet',
  help: 'A priced delivered study enters the margin only when it also has a recorded cost, an N actual and an N target. Where the N is missing, the dollars are what an N near the N collected would book — an estimate, so check the rate first when it is far from the route’s usual price.',
  who: 'Captain (the N) or ops (the cost)', when: 'At Delivery.',
  where: 'Project page → N Actual, or Blasts / Suppliers / Cost lines', needs: ['project_blasts', 'project_suppliers', 'project_costs'], price: true,
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function gapPricedBlocked(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, BLOCKEDP)
  if (b) return b
  const priced = ctx.delivered.filter(it => hasPrice(it.p, ctx.rates.get(it.p.id)))
  const detail = priced.map(it => ({ it, rv: revenueDetail(it.p, ctx.rates.get(it.p.id)), sp: ctx.spend(it.p).total }))
  const noCost = detail.filter(x => x.rv.revenue != null && x.sp <= 0)
  const noN = detail.filter(x => x.rv.revenue == null)
  if (!noCost.length && !noN.length) return resolved(BLOCKEDP, 'Every priced delivered study in view is in the margin.')
  // The usual price per route, on the book's single-route delivered work.
  const rateSample: Record<'blast' | 'panel', number[]> = { blast: [], panel: [] }
  for (const it of ctx.input.items) {
    const r = ctx.rates.get(it.p.id)
    if (it.cls === 'delivered' && r != null && r > 0 && (it.route === 'blast' || it.route === 'panel')) rateSample[it.route].push(r)
  }
  const usual = { blast: median(rateSample.blast), panel: median(rateSample.panel) }
  const outlier = (it: FinItem, rate: number | null): string | null => {
    if (rate == null || !(rate > 0) || (it.route !== 'blast' && it.route !== 'panel')) return null
    const m = usual[it.route]
    if (m == null || rateSample[it.route].length < MIN_RATE_SAMPLE || rate <= RATE_OUTLIER_FACTOR * m) return null
    return `Check the rate first: ${perN(rate)} is ${fmtNum(Math.round(rate / m))}× the usual ${it.route} price (${perN(m)}, median of ${fmtNum(rateSample[it.route].length)})`
  }
  const rows: GapRowIn[] = []
  const details: string[] = []
  let est = 0, estOn = 0
  for (const x of noCost) {
    const o = outlier(x.it, x.rv.rate)
    rows.push({ it: x.it, amount: x.rv.revenue, detail: `No cost recorded${o ? ` · ${o}` : ''}`, where: 'Project page → Blasts, Suppliers or Cost lines' })
    if (o) details.push(`${x.it.p.project_code ?? 'A study'}: ${o}.`)
  }
  for (const x of noN) {
    const collected = Number(x.it.p.n_collected ?? 0)
    const capN = x.it.p.n_target_max ?? x.it.p.n_target
    // The bill is the rate × min(N actual, the N sold), so a survey with NO N
    // target books nothing however the N lands (revenue.ts, reason 'no-cap') —
    // sizing it would promise money that entering the N cannot deliver. Where
    // there IS a cap, what the N collected would be worth is a guide, kept out
    // of this gap's dollars: n_collected is the pre-QA count and is never billed.
    const e = x.rv.reason === 'no-n-actual' && x.rv.rate != null && collected > 0 && capN != null
      ? x.rv.rate * Math.min(collected, Number(capN)) : null
    if (e != null) { est += e; estOn++ }
    const o = outlier(x.it, x.rv.rate)
    const words = x.rv.reason === 'no-cap' ? 'No N target to cap the bill'
      : capN == null ? 'No N actual and no N target: entering the N alone would still book nothing'
        : `No N actual yet${e != null ? `; an N near the ${fmtNum(collected)} collected would book about ${money(e)}` : ''}`
    rows.push({
      it: x.it, amount: null, detail: `${words}${o ? ` · ${o}` : ''}`,
      where: x.rv.reason === 'no-cap' ? 'Project page → N Target'
        : capN == null ? 'Project page → N Actual and N Target' : 'Project page → N Actual',
    })
    if (o) details.push(`${x.it.p.project_code ?? 'A study'}: ${o}, before its N is entered.`)
  }
  const revNoCost = sum(noCost, x => x.rv.revenue ?? 0)
  // Recorded client price only. What the missing Ns might be worth is an
  // estimate and is reported as one, below — never added to a price on file.
  const dollars = revNoCost
  if (est > 0) {
    details.push(`Entering the N actual on ${fmtNum(estOn)} of them would book about ${money(est)} more — at the N collected, capped by the N sold. An estimate, not a price on file.`)
  }
  const parts: string[] = []
  if (noCost.length) parts.push(`${pl(noCost.length, 'priced study', 'priced studies')} ${verb(noCost.length, 'has', 'have')} no recorded cost (${money(revNoCost)} of client price)`)
  if (noN.length) parts.push(`${pl(noN.length, 'priced study', 'priced studies')} ${verb(noN.length, 'has', 'have')} no N actual or no N target yet`)
  // Checked against the hub's own margin set: the surveys it could not admit.
  const m = marginOf(ctx.delivered.map(it => it.p), ctx.rates, ctx.raw.blasts, ctx.raw.suppliers, ctx.raw.costs)
  const items = [...noCost, ...noN].map(x => x.it)
  const ids = idsOf(items)
  return {
    ...blankGap(BLOCKEDP),
    count: items.length, surveys: items.length, ids,
    dollars, dollarsKind: 'price',
    dollarsWords: 'of client price the margin cannot count yet',
    what: `${parts.join(', and ')}. Until both sides are recorded, the margin leaves ${verb(items.length, 'it', 'them')} out.`,
    details, link: oneLink(items),
    drill: gapDrill(ctx, {
      key: 'priced-blocked', title: `Priced, not in the margin · ${pl(items.length, 'study', 'studies')}`, rows,
      // Every row's amount is a price on file, so the rows add back to the
      // hub's own figure for priced work with no cost — a check, not a mirror.
      expectedTotal: m.pricedNoCostRevenue,
      expectedIds: [...m.pricedNoCostIds, ...m.pricedBlockedIds],
      totalLabel: 'Client price on these studies',
      amountHeader: 'Client price', amountTip: 'The client price the margin cannot count yet. Blank where the N actual is missing: there is no price to count until the N lands.',
      detailHeader: 'What is missing', detailTip: 'The field that keeps the study out of the margin.',
      where: BLOCKEDP.where, rule: DELIVERED_RULE,
    }),
  }
}

/* 10 ─ $0 prices to confirm ───────────────────────────────────────────────── */

const ZERO: GapBase = {
  key: 'zero-price', specNo: 10, title: '$0 prices to confirm',
  help: 'A $0 price is a real price — work given away on purpose. One at an account that pays on other studies is worth a second look; one at an account that pays on none (internal work, a trial) looks deliberate and is only noted.',
  who: 'Finance (David or Vineet)', when: 'When the price is entered.',
  where: 'Project page → Money → Price / N', needs: ['project_blasts', 'project_suppliers', 'project_costs'], price: true,
}

function gapZero(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, ZERO)
  if (b) return b
  const zeros = ctx.pop.filter(it => ctx.rates.get(it.p.id) === 0)
  if (!zeros.length) return resolved(ZERO, 'No study in view is priced at $0.')
  const paying = new Set(ctx.input.items
    .filter(it => (ctx.rates.get(it.p.id) ?? 0) > 0 && it.p.client_id)
    .map(it => it.p.client_id as string))
  const check = zeros.filter(it => it.p.client_id && paying.has(it.p.client_id))
  const deliberate = zeros.length - check.length
  const tail = deliberate
    ? `${pl(deliberate, 'more $0 price')} ${verb(deliberate, 'sits', 'sit')} at accounts that pay on no study, which looks deliberate (internal work or trials).`
    : ''
  if (!check.length) return resolved(ZERO, tail)
  const ids = idsOf(check)
  const dollars = spendIds(ctx, ids)
  const setOn = new Map(ctx.raw.financials.map(r => [r.project_id, etDay(String(r.updated_at ?? r.created_at ?? '') || null)]))
  const rows: GapRowIn[] = check.map(it => ({
    it, amount: ctx.spend(it.p).total,
    detail: `${it.cls === 'active' ? 'Live' : 'Delivered'}; $0 set${setOn.get(it.p.id) ? ` ${setOn.get(it.p.id)}` : ''}; the account pays on other studies`,
  }))
  return {
    ...blankGap(ZERO),
    count: check.length, surveys: check.length, ids, dollars, dollarsKind: dollars > 0 ? 'spend' : 'none',
    dollarsWords: 'of cost given away at $0',
    what: `${pl(check.length, 'study', 'studies')} ${verb(check.length, 'is', 'are')} priced at $0 at accounts that pay on other studies, giving away ${money(dollars)} of cost. Confirm each is deliberate, or enter the real price.${tail ? ` ${tail}` : ''}`,
    link: oneLink(check),
    drill: gapDrill(ctx, {
      key: 'zero-price', title: `$0 prices to confirm · ${pl(check.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Cost given away', amountTip: 'Field cost recorded on the study — what giving it away cost so far.',
      detailHeader: 'Price', detailTip: 'When the $0 price was set, and why it is worth confirming.',
      where: ZERO.where,
    }),
  }
}

/* 11 ─ placeholder flag on real work ──────────────────────────────────────── */

const PLACEHOLDER: GapBase = {
  key: 'placeholder-flag', specNo: 11, title: 'Placeholder flag on real work',
  help: 'The rerun spawner creates empty "placeholder" waves ahead of time. One that has started collecting is real work, and the flag makes other screens treat it as an empty shell.',
  who: 'Ops (whoever runs the rerun series)', when: 'When a placeholder wave starts fielding.',
  where: 'The study’s placeholder flag. No screen edits it yet, so it is a one-off data fix.',
  needs: ['project_blasts', 'project_suppliers', 'project_costs'],
}

function gapPlaceholder(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, PLACEHOLDER)
  if (b) return b
  // `items` never holds an EMPTY placeholder, so every flagged item holds data.
  const hits = ctx.pop.filter(it => it.p.is_placeholder === true)
  if (!hits.length) return resolved(PLACEHOLDER, 'No study in view carries the placeholder flag over real work.')
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: ctx.spend(it.p).total,
    detail: [
      Number(it.p.n_collected ?? 0) > 0 ? `${fmtNum(Number(it.p.n_collected))} collected` : null,
      it.p.n_actual != null ? `N actual ${fmtNum(Number(it.p.n_actual))}` : null,
      ctx.spend(it.p).total > 0 ? 'cost recorded' : null,
    ].filter(Boolean).join('; ') || 'Holds field rows',
  }))
  return {
    ...blankGap(PLACEHOLDER),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: dollars > 0 ? 'spend' : 'none',
    dollarsWords: 'of cost under a placeholder flag',
    what: `${pl(hits.length, 'study', 'studies')} ${verb(hits.length, 'is', 'are')} still flagged as an empty rerun placeholder but ${verb(hits.length, 'carries', 'carry')} real work (${money(dollars)} of cost). Clear the flag so ${verb(hits.length, 'it reads', 'they read')} as real work everywhere.`,
    link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'placeholder-flag', title: `Placeholder flag on real work · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded under the flag.',
      detailHeader: 'What it holds', detailTip: 'The data that makes it real work, not an empty shell.',
      where: PLACEHOLDER.where,
    }),
  }
}

/* 12 ─ segments that disagree with the survey ─────────────────────────────── */

const SEGMENTS: GapBase = {
  key: 'segments', specNo: 12, title: 'Segments that disagree with the study',
  help: 'The bill uses the study’s own N actual and rate (David, 2026-09-27), so none of this changes revenue. But segment N actuals should add up to the study’s, and a segment edit rolls them up on save — so a mismatch can change the bill later. When the study’s N actual is only the sum of the counted segments, its cost per respondent is held out until every segment is counted.',
  who: 'Captain', when: 'At Delivery.', where: 'Project page → N segments',
  needs: ['project_segments', 'project_blasts', 'project_suppliers', 'project_costs'],
}

function segmentDetail(p: FinProject): string {
  const s = segmentCheck(p)
  if (s.partialRollUp) return `${fmtNum(s.missing)} of ${fmtNum(s.segments)} segments ${verb(s.missing, 'has', 'have')} no N actual; the study N actual adds up only the others`
  if (s.missing > 0) return `${fmtNum(s.missing)} of ${fmtNum(s.segments)} segments ${verb(s.missing, 'has', 'have')} no N actual`
  if (s.surveyN == null) return 'The study’s own N actual is blank'
  return `Segments add up to ${fmtNum(s.segmentSum ?? 0)}; the study says ${fmtNum(s.surveyN)}`
}

function gapSegments(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, SEGMENTS)
  if (b) return b
  const counts = ctx.delivered.filter(it => segmentCheck(it.p).disagree)
  const partial = counts.filter(it => segmentCheck(it.p).partialRollUp)
  const prices = ctx.priceBlock ? [] : ctx.pop.filter(it => segmentPriceDiffers(it.p, ctx.rates.get(it.p.id)))
  const seen = new Set<string>()
  const hits = [...counts, ...prices].filter(it => (seen.has(it.p.id) ? false : (seen.add(it.p.id), true)))
  if (!hits.length) return resolved(SEGMENTS, 'Every segmented study in view adds up to its study figure, and no segment is priced differently from its study.')
  const partialIds = idsOf(partial)
  const dollars = partial.length ? spendIds(ctx, partialIds) : 0
  const countIds = new Set(idsOf(counts))
  const priceIds = new Set(idsOf(prices))
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: segmentCheck(it.p).partialRollUp && countIds.has(it.p.id) ? ctx.spend(it.p).total : 0,
    detail: [countIds.has(it.p.id) ? segmentDetail(it.p) : null, priceIds.has(it.p.id) ? 'A segment is priced differently from the study rate' : null]
      .filter(Boolean).join(' · '),
  }))
  const parts: string[] = []
  if (counts.length) {
    let s = `${pl(counts.length, 'delivered study', 'delivered studies')} ${verb(counts.length, 'has', 'have')} segment N actuals that do not add up to the study’s`
    if (partial.length) s += `; ${fmtNum(partial.length)} of them ${verb(partial.length, 'is', 'are')} only the sum of the counted segments, which holds ${money(dollars)} out of cost per respondent`
    parts.push(s)
  }
  if (prices.length) parts.push(`${pl(prices.length, 'study', 'studies')} ${verb(prices.length, 'has', 'have')} a segment priced differently from the study rate`)
  if (ctx.priceBlock) parts.push(`segment prices cannot be checked (${ctx.priceBlock})`)
  const ids = idsOf(hits)
  return {
    ...blankGap(SEGMENTS),
    count: hits.length, surveys: hits.length, ids,
    dollars: partial.length ? dollars : 0, dollarsKind: partial.length ? 'spend' : 'none',
    dollarsWords: partial.length ? 'of cost held out of cost per respondent' : 'no dollars hidden: the bill uses the study’s figures',
    what: `${parts.join('. ')}. The bill uses the study’s N actual and rate either way.`,
    link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'segments', title: `Segments that disagree · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: partial.length ? dollars : 0, expectedIds: ids, totalLabel: 'Cost held out of cost per respondent',
      amountHeader: 'Held out', amountTip: 'Cost a per-respondent figure leaves out because the study’s N actual covers only some segments. $0 where the bill and rates are unaffected.',
      detailHeader: 'What disagrees', detailTip: 'How the segments and the study differ.',
      where: SEGMENTS.where,
    }),
  }
}

/* 13 ─ stale phase ────────────────────────────────────────────────────────── */

const STALE: GapBase = {
  key: 'stale-phase', specNo: 13, title: 'Phase still says Scoping on work being fielded',
  help: 'A study that is buying respondents (or already delivered) is counted as real work here whatever its phase says, but the board and pipeline read the phase.',
  who: 'Captain', when: 'When fielding starts.', where: 'Project page → Phase (advance it on the board)',
  needs: ['project_blasts', 'project_suppliers', 'project_costs'],
}

function gapStale(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, STALE)
  if (b) return b
  // The population holds only delivered and live work, so a Scoping phase here
  // is a survey the classifier already moved on because it has field rows.
  const hits = ctx.pop.filter(it => it.p.phase === 'Scoping')
  if (!hits.length) return resolved(STALE, 'No study in view is being fielded under a Scoping phase.')
  const ids = idsOf(hits)
  const dollars = spendIds(ctx, ids)
  const rows: GapRowIn[] = hits.map(it => ({
    it, amount: ctx.spend(it.p).total,
    detail: `${it.cls === 'delivered' ? 'Delivered' : 'Live'}, phase Scoping (${it.p.board_column ?? 'no column'})`,
  }))
  return {
    ...blankGap(STALE),
    count: hits.length, surveys: hits.length, ids, dollars, dollarsKind: dollars > 0 ? 'spend' : 'none',
    dollarsWords: 'of cost on work the board still calls Scoping',
    what: `${pl(hits.length, 'study', 'studies')} still ${verb(hits.length, 'says', 'say')} Scoping but ${verb(hits.length, 'is', 'are')} already being fielded or delivered (${money(dollars)} of cost). Move the phase on so the board and the pipeline count ${verb(hits.length, 'it', 'them')}.`,
    link: oneLink(hits),
    drill: gapDrill(ctx, {
      key: 'stale-phase', title: `Scoping phase on live work · ${pl(hits.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Recorded cost on these studies',
      amountHeader: 'Recorded cost', amountTip: 'Field cost recorded on the study.',
      detailHeader: 'Where it sits', detailTip: 'Its class here and its board column.',
      where: STALE.where,
    }),
  }
}

/* 14 ─ empty contract terms ───────────────────────────────────────────────── */

const TERM: GapBase = {
  key: 'empty-term', specNo: 14, title: 'Empty contract terms',
  help: 'A contract term with no credit pool, no dates and no studies drawing on it tells the credit strip nothing, and reads as a contract that exists.',
  who: 'Finance', when: 'When the contract is signed.', where: 'Client page → Contracts',
  unit: 'contract term', needs: ['client_terms', 'survey_projects'],
}

function gapTerms(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, TERM)
  if (b) return b
  const f = ctx.input.filter
  const used = new Set(ctx.raw.projects.map(p => p.term_id).filter((x): x is string => !!x))
  const terms = ctx.raw.terms.filter(t => !f.account || t.client_id === f.account)
  const empty = terms.filter(t =>
    (t.credits_total == null || Number(t.credits_total) === 0) && !t.starts_on && !t.renews_on && !used.has(t.id))
  if (!empty.length) return resolved(TERM, terms.length ? 'Every contract term in view has a credit pool, dates or studies.' : 'No contract terms in view.')
  const accounts: GapAccount[] = empty.map(t => ({
    id: t.client_id, name: ctx.input.accountName(t.client_id), count: 1, dollars: null,
    note: `“${t.name ?? '(unnamed)'}”`, href: t.client_id ? `/clients/${t.client_id}` : undefined,
  }))
  const names = empty.map(t => `“${t.name ?? '(unnamed)'}” at ${ctx.input.accountName(t.client_id)}`)
  return {
    ...blankGap(TERM),
    count: empty.length, surveys: 0, ids: [], dollars: null, dollarsKind: 'none', dollarsWords: 'no dollars on it',
    what: `${pl(empty.length, 'contract term')} ${verb(empty.length, 'has', 'have')} no credit pool, no dates and no studies: ${names.join(', ')}. Fill ${verb(empty.length, 'it', 'them')} in, or remove ${verb(empty.length, 'it', 'them')}.`,
    accounts,
    link: empty.length === 1 && empty[0].client_id ? { href: `/clients/${empty[0].client_id}`, label: `Open ${ctx.input.accountName(empty[0].client_id)}` } : null,
  }
}

/* 15 ─ PureSpectrum waves with no target ──────────────────────────────────── */

const WAVES: GapBase = {
  key: 'wave-target', specNo: 15, title: 'PureSpectrum waves with no target',
  help: 'A wave’s target is the PureSpectrum Goal. Without it, the "set the PureSpectrum Goal" check on the Per respondent tab cannot tell whether the wave bought past what it needed.',
  who: 'Ops (the PureSpectrum import should write each survey’s Goal as the target)', when: 'When each wave launches.',
  where: 'Project page → Suppliers → wave target', unit: 'wave', needs: ['project_launches', 'project_suppliers'],
}

function gapWaves(ctx: Ctx): Gap {
  const b = checkBlocked(ctx, WAVES)
  if (b) return b
  const popIds = new Set(idsOf(ctx.pop))
  const mine = ctx.raw.launches.filter(l => popIds.has(l.project_id))
  if (!mine.length) return resolved(WAVES, 'No PureSpectrum waves in view.')
  const waves = mine.filter(l => l.target == null)
  if (!waves.length) return resolved(WAVES, 'Every PureSpectrum wave in view has a target.')
  const waveIds = new Set(waves.map(w => w.id))
  // The aggregate straight off the supplier rows; the drill goes survey by survey.
  const dollars = sum(ctx.raw.suppliers.filter(s => s.launch_id && waveIds.has(s.launch_id)),
    s => Number(s.cpi ?? 0) * Number(s.n_collected ?? 0))
  const item = new Map(ctx.pop.map(it => [it.p.id, it]))
  const byP = new Map<string, { none: number; all: number }>()
  for (const l of mine) {
    const e = byP.get(l.project_id) ?? { none: 0, all: 0 }
    e.all++
    if (l.target == null) e.none++
    byP.set(l.project_id, e)
  }
  const hitItems = [...byP.entries()].filter(([, e]) => e.none > 0)
    .map(([id]) => item.get(id)).filter((x): x is FinItem => !!x)
  const rows: GapRowIn[] = hitItems.map(it => {
    const e = byP.get(it.p.id)!
    const cost = sum((ctx.ix.suppliers.get(it.p.id) ?? []).filter(s => s.launch_id && waveIds.has(s.launch_id)),
      s => Number(s.cpi ?? 0) * Number(s.n_collected ?? 0))
    return { it, amount: cost, detail: `${fmtNum(e.none)} of ${pl(e.all, 'wave')} ${verb(e.none, 'has', 'have')} no target` }
  })
  const ids = idsOf(hitItems)
  return {
    ...blankGap(WAVES),
    count: waves.length, surveys: ids.length, ids, dollars, dollarsKind: dollars > 0 ? 'spend' : 'none',
    dollarsWords: 'of panel cost the Goal check cannot see',
    what: `${pl(waves.length, 'wave')} on ${pl(ids.length, 'study', 'studies')} ${verb(waves.length, 'has', 'have')} no target, carrying ${money(dollars)} of panel cost that the “set the PureSpectrum Goal” check cannot see.`,
    link: oneLink(hitItems),
    drill: gapDrill(ctx, {
      key: 'wave-target', title: `Waves with no target · ${pl(ids.length, 'study', 'studies')}`, rows,
      expectedTotal: dollars, expectedIds: ids, totalLabel: 'Panel cost on waves with no target',
      amountHeader: 'Panel cost', amountTip: 'Price per complete × completes, on the waves with no target only.',
      detailHeader: 'Waves', detailTip: 'How many of the study’s waves have no target.',
      where: WAVES.where,
    }),
  }
}

/* ── BLOCKED: DATA SOCC DOES NOT CAPTURE ──────────────────────────────────── */

export interface BlockedDatum {
  key: string
  title: string
  what: string
  needs: string
  /** The (i) beside the title: what the measure would be, and what the page
   *  does in the meantime. Every label on this page carries an explainer. */
  help: string
}

function blockedData(ctx: Ctx): BlockedDatum[] {
  const blastSurveys = ctx.pop.filter(it => it.route === 'blast' || it.route === 'both')
  const withList = blastSurveys.filter(it => (ctx.ix.costs.get(it.p.id) ?? []).some(c => c.kind === 'contacts_export'))
  // Three tables: the blast and panel rows decide which surveys went out by
  // blast, and the cost lines carry the contact-list entry.
  const b1Block = COST_TABLES.find(t => ctx.blocked(t))
  const b1 = b1Block
    ? `${blockedText(b1Block)}, so the contact-list lines cannot be counted.`
    : blastSurveys.length
      ? `${fmtNum(blastSurveys.length - withList.length)} of ${fmtNum(blastSurveys.length)} blast studies in view carry no contact-list cost line, so the list they went to costs $0 here.`
      : 'No blast study in view.'
  const revs = ctx.priceBlock ? [] : ctx.delivered.map(it => revenueDetail(it.p, ctx.rates.get(it.p.id))).filter(r => r.revenue != null)
  const invoiced = revs.filter(r => r.source === 'invoiced').length
  const b5 = ctx.priceBlock
    ? `${ctx.priceBlock}.`
    : `${fmtNum(revs.length - invoiced)} of the ${pl(revs.length, 'client price')} in view ${verb(revs.length - invoiced, 'is', 'are')} price × delivered N; no invoiced amount is on file to check ${verb(revs.length - invoiced, 'it', 'them')} against.`
  return [
    {
      key: 'B1', title: 'B2B contact-list cost', what: b1,
      needs: 'The source and the number of contacts in each list pull, so its cost can be computed.',
      help: 'What the contact list behind a blast cost to build. Nothing records it, so a B2B study’s cost here is its sends and rewards only — the real cost of reaching those people is higher, by an amount this page will not guess.',
    },
    {
      key: 'B2', title: 'QA yield and cost per qualified respondent by panel',
      what: 'How many of each panel’s completes survived QA is not recorded, so cost per qualified respondent cannot be split by panel. It is left blank, not estimated.',
      needs: 'Delivered respondents per panel per wave: join the deliverable’s transaction IDs to the Buyer Surveys export’s supplier name.',
      help: 'Which panel’s respondents survive QA, and so what each panel really costs per usable respondent. Cost per respondent can be split by panel; cost per QUALIFIED respondent cannot, and is left blank rather than split on an assumed yield.',
    },
    {
      key: 'B3', title: 'Conversion by panel',
      what: 'The PureSpectrum import reads terminations and drops, then keeps only completes.',
      needs: 'Termination and drop counts per panel from the import.',
      help: 'How many people a panel sent for each complete it delivered — the measure that says which panel screens well. The import drops the numbers, so no conversion figure is shown at all.',
    },
    {
      key: 'B4', title: 'Country on each wave',
      what: 'A wave’s country is free text, so the same country can be written more than one way and no country total can be trusted.',
      needs: 'A fixed list of countries on each wave.',
      help: 'Cost and delivery by country. Free text cannot be added up safely, so this page shows no country total rather than one that silently splits a country in two.',
    },
    {
      key: 'B5', title: 'Invoiced amount per study', what: b5,
      needs: 'The amount actually invoiced per study (finance only), to reconcile against the computed price.',
      help: 'What the client was actually billed. Every price on this page is computed (rate × billed N), so nothing here can be checked against the invoice until the invoiced amount is recorded.',
    },
    {
      key: 'B6', title: 'Credit dollar values',
      what: 'Contract credits are counts only here: this page reads no agreed dollar value per credit.',
      needs: 'The contract total and credit count for each term, so a credit has a dollar value.',
      help: 'What one contract credit is worth in dollars. Credits are counted, never valued, so credit-funded work carries no revenue figure of its own here.',
    },
  ]
}

/* ── THE MODEL ────────────────────────────────────────────────────────────── */

export interface ImproveExport {
  name: string
  columns: { key: string; header: string }[]
  rows: Record<string, string | number | null>[]
}

export interface ImproveModel {
  header: PriceHeader
  grid: CoverageGrid
  logging: LoggingStrip
  /** Open gaps ranked by dollars hidden, then blocked ones. */
  gaps: Gap[]
  resolved: Gap[]
  blockedData: BlockedDatum[]
  /** The gaps card's closing sentence. */
  verdict: string
  exportData: ImproveExport
}

/** Open gaps, largest dollars hidden first. A gap with no dollar figure ranks
 *  after every gap that has one, then by how many records it touches. */
export function rankGaps(gaps: Gap[]): Gap[] {
  return gaps.slice().sort((a, b) => {
    const da = a.dollars != null && a.dollars > 0 ? a.dollars : -1
    const db = b.dollars != null && b.dollars > 0 ? b.dollars : -1
    return db - da || b.count - a.count || a.specNo - b.specNo
  })
}

export function buildImproveModel(input: ImproveInput): ImproveModel {
  const ctx = makeCtx(input)
  const scan = scanPrice(ctx)
  const grid = buildGrid(ctx)
  const logging = buildLogging(ctx)
  const all: Gap[] = [
    gapPrice(ctx, scan),
    gapSms(ctx),
    gapRouteRows(ctx, PS_ROWS, 'PS'),
    gapSplit(ctx),
    gapPostQa(ctx),
    gapNoDate(ctx, grid),
    gapRecoveries(ctx),
    gapBudgets(ctx),
    gapPricedBlocked(ctx),
    gapZero(ctx),
    gapPlaceholder(ctx),
    gapSegments(ctx),
    gapStale(ctx),
    gapTerms(ctx),
    gapWaves(ctx),
    gapRouteRows(ctx, B2B_ROWS, 'B2B'),
  ]
  const open = rankGaps(all.filter(g => g.status === 'open'))
  const blocked = all.filter(g => g.status === 'blocked').sort((a, b) => a.specNo - b.specNo)
  const done = all.filter(g => g.status === 'resolved').sort((a, b) => a.specNo - b.specNo)
  const gaps = [...open, ...blocked]

  const top = open[0]
  let verdict: string
  if (top) {
    const hasDollars = top.dollars != null && top.dollars > 0
    const size = hasDollars
      ? `hides ${top.dollarsKind === 'estimate' ? 'about ' : ''}${money(top.dollars as number)} ${top.dollarsWords}`
      : `covers ${pl(top.count, top.unit, units(top.unit))}`
    const on = top.surveys > 0 && (hasDollars || top.unit !== 'study') ? ` on ${pl(top.surveys, 'study', 'studies')}` : ''
    verdict = `Start with “${top.title}”: it ${size}${on}. ${pl(open.length, 'gap')} ${verb(open.length, 'is', 'are')} open${done.length ? ` and ${fmtNum(done.length)} resolved` : ''}.`
  } else if (blocked.length) {
    verdict = `Nothing fixable is open, but ${pl(blocked.length, 'check')} could not run: see the blocked rows.`
  } else {
    verdict = 'Every fixable gap in this view is closed. What is left needs data SOCC does not capture yet (below).'
  }

  const exportRows = [...gaps, ...done].map((g, i) => ({
    rank: g.status === 'open' ? i + 1 : null,
    status: g.status === 'open' ? 'Open' : g.status === 'blocked' ? 'Blocked' : 'Resolved',
    gap: g.title,
    count: g.count,
    unit: g.count === 1 ? g.unit : units(g.unit),
    surveys: g.surveys,
    dollars: g.dollars == null ? null : Math.round(g.dollars * 100) / 100,
    dollars_kind: DOLLARS_KIND_LABEL[g.dollarsKind],
    dollars_meaning: g.dollarsWords,
    what: g.status === 'open' ? g.what : g.note ?? '',
    who: g.who,
    when: g.when,
    where: g.where,
  }))
  return {
    header: scan.header, grid, logging, gaps, resolved: done, blockedData: blockedData(ctx), verdict,
    exportData: {
      name: 'finance-improve-gaps',
      columns: [
        { key: 'rank', header: 'Rank' },
        { key: 'status', header: 'Status' },
        { key: 'gap', header: 'Gap' },
        { key: 'count', header: 'Count' },
        { key: 'unit', header: 'Of' },
        { key: 'surveys', header: 'Studies' },
        { key: 'dollars', header: 'Dollars hidden' },
        { key: 'dollars_kind', header: 'Kind of dollars' },
        { key: 'dollars_meaning', header: 'What the dollars are' },
        { key: 'what', header: 'What it is' },
        { key: 'who', header: 'Who records it' },
        { key: 'when', header: 'When' },
        { key: 'where', header: 'Where' },
      ],
      rows: exportRows,
    },
  }
}

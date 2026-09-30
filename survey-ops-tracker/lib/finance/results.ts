/**
 * Tab 1 — Results. Every figure the tab shows, computed in ONE pure function.
 *
 * The question the tab answers is "did we make money on finished work", and
 * the history of this page is that question answered on a subset while reading
 * as though it were the business. So every figure here is drawn from the
 * MARGIN SET — delivered, priced (a real $0 included), a delivered N and a cap
 * present, and a recorded cost — exactly as lib/finance/hub.ts `marginOf`
 * defines it, and every figure says how much of the book it can see.
 *
 * ── NOTHING HERE RE-DERIVES THE MONEY ───────────────────────────────────────
 * Revenue comes from lib/finance/revenue.ts (through surveyPnl and marginOf),
 * spend from hub.ts `spendOf`, the month rows from analysis.ts `monthTable`,
 * the account table from `accountPnl` and the budget median from
 * `budgetVsPrice`. This file arranges those results into what the tab draws
 * and writes the sentences. The React component only renders this model, and
 * the connector's finance_results tool (lib/mcp/financeResults.ts) returns the
 * same model, so the page and the connector cannot disagree.
 *
 * ── EVERY DRILL IS CHECKED AGAINST SOMETHING ELSE ───────────────────────────
 * `resultsDrill` builds each drill's rows from the per-survey P&L, and takes
 * its expected total from a different function (marginOf, monthTable, or a sum
 * straight off the raw child rows), so a drill that lists the wrong surveys
 * says so in red (finance spec, rule 5).
 *
 * ── SENTENCES ARE PARTS, SO THE PAGE CAN LINK THEM ──────────────────────────
 * A verdict names surveys ("PR00362 −$3,586") and a coverage line opens a
 * drill. They are built as a list of parts — plain text, a survey, an action —
 * so the page can render the survey as a real link and the connector can join
 * the same parts into plain text. One builder, two renderings.
 */

import {
  buildIndex, contactName, costBreakdown, COST_LINES, isCredit, marginOf, spendOf,
  type FinContact, type FinIndex, type FinProject, type Route, type Spend,
} from './hub'
import { accountPnl, budgetVsPrice, monthTable, periodKey, surveyPnl, type SurveyPnl } from './analysis'
import { marginRows, unpricedRows } from './drills'
import { spendOfIds, type DrillColumn, type DrillRow, type DrillSpec } from './drill'
import { coverageByMonth, MIN_MONTH_SURVEYS, monthLabel, RELIABILITY, reliabilityDates } from './coverage'
import { CLASS_LABEL, type FinClass } from './lifecycle'
import { hasPrice, KEEP_GOAL, perDollarOfPrice, type RevenueBlock } from './revenue'
import {
  describe, itemsOf, populationByRule, populationFor,
  type FilterDescription, type FinanceFilter, type FinItem, type TabRule,
} from './filters'
import { priceBlockText, type FinanceLoad, type FinanceTable } from './load'
import { centsText, money, money2, pctText } from './format'
import { fmtNum } from '@/lib/utils/number'

/* ── GROUP BY ─────────────────────────────────────────────────────────────── */

export type ResultsGroupBy = 'account' | 'route' | 'month' | 'contact' | 'type' | 'survey' | 'panel'

export const DEFAULT_GROUP_BY: ResultsGroupBy = 'account'

/** The Tile 2 picker, in the spec's order, with the words for its (i). */
export const GROUP_BY_OPTIONS: { id: ResultsGroupBy; label: string; help: string }[] = [
  { id: 'account', label: 'Account', help: 'One row per client account, old name variants rolled together. An account fielded on more than one route splits into a row per route.' },
  { id: 'route', label: 'Route', help: 'How each study was actually fielded, read from its cost records: blast, panel or both.' },
  { id: 'month', label: 'Month', help: 'The month each study is placed in: its deliver date, else its launch date, else its submitted date.' },
  { id: 'contact', label: 'Contact', help: 'Who at the account asked for the study (Requested by on the project page).' },
  { id: 'type', label: 'Type as filed', help: 'The type the study was filed as (PS, B2B, Rerun). It can differ from how it was actually fielded; Route shows that.' },
  { id: 'survey', label: 'Study', help: 'Every study on its own line, with its budget, spend ÷ budget and spend ÷ price, and a tag for each thing that went wrong.' },
  { id: 'panel', label: 'Panel supplier', help: 'Panel spend by supplier, from the PureSpectrum rows of the studies in view. Clients pay per study, not per panel, so client price is not split by panel.' },
]

const GROUP_IDS = new Set<string>(GROUP_BY_OPTIONS.map(o => o.id))

/** Read `?by=`. Anything unknown is the default rather than an empty card. */
export function parseGroupBy(v: string | null | undefined): ResultsGroupBy {
  return v && GROUP_IDS.has(v) ? (v as ResultsGroupBy) : DEFAULT_GROUP_BY
}

/** The tables every Results figure is computed from: prices, the segments
 *  (the bill's one roll-up case) and all three cost tables. A card or the
 *  connector shows "Blocked" instead of a figure when one of them fails.
 *
 *  `clients` belongs here even though no figure divides by it. The loader
 *  builds the demo-account set from those rows (load.ts) and drops their
 *  surveys; a failed read gives it an EMPTY set, so demo money would quietly
 *  join every total. It is also where an account's name comes from — without
 *  it every row falls back to the stale `client` text column, the one that
 *  splits BAM nine ways. Both are wrong answers that look like answers. */
export const RESULTS_NEEDS: FinanceTable[] = [
  'survey_projects', 'project_blasts', 'project_suppliers', 'project_costs',
  'project_financials', 'project_segments', 'clients',
]

/* ── THRESHOLDS (named once, printed in the words that use them) ──────────── */

/** A trend is stated only when BOTH months have at least this many surveys in
 *  the margin set (finance spec, rule 7). */
export const TREND_MIN_N = 10
/** A group with fewer margin surveys than this is drawn muted and tagged "too
 *  few to judge": one survey's price is not an account's pricing. */
export const GROUP_MIN_N = 3
/** Two kept percentages within this many points of each other read as
 *  "level" in the verdict rather than as a rise or a fall. */
export const LEVEL_WITHIN = 0.02
/** The verdict names at most this many loss-making surveys, then "and N more". */
export const LOSSES_NAMED = 4

export const ROUTE_WORD: Record<Route, string> = {
  blast: 'Blast', panel: 'Panel', both: 'Both', none: 'No field rows',
}

/* ── SENTENCE PARTS ───────────────────────────────────────────────────────── */

/** What a clickable part of a sentence does. */
export type ResultsAction = 'waterfall' | 'unpriced' | 'improve' | 'cancelled' | 'archived'

export type Part =
  | { kind: 'text'; text: string }
  /** A survey code: the page renders it as a real link to /projects/<id>. */
  | { kind: 'survey'; id: string; text: string }
  | { kind: 'action'; action: ResultsAction; text: string }

const t = (text: string): Part => ({ kind: 'text', text })
const act = (action: ResultsAction, text: string): Part => ({ kind: 'action', action, text })

/** The parts joined into plain text — what the connector returns. */
export const partsText = (parts: Part[]): string => parts.map(p => p.text).join('')

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)
const surveysWord = (n: number) => `${fmtNum(n)} ${plural(n, 'study', 'studies')}`

/* ── INPUT ────────────────────────────────────────────────────────────────── */

export interface ResultsInput {
  load: Pick<FinanceLoad, 'raw' | 'blocked' | 'integrity'>
  /** buildIndex over the load's blasts, suppliers and costs. */
  ix: FinIndex
  /** Every survey except empty placeholders, classified once (itemsOf). */
  items: FinItem[]
  /** The tab's population: delivered × date × account × route. */
  population: FinItem[]
  filter: FinanceFilter
  /** Today in Eastern time. */
  today: string
  groupBy?: ResultsGroupBy
  /** The shell's scope words, when it has them; computed here otherwise. */
  scope?: FilterDescription
}

/** Everything the page builds before it renders a tab, built the same way for
 *  a caller that is not the page (the connector, the tests). */
export function resultsInputOf(
  load: Pick<FinanceLoad, 'raw' | 'blocked' | 'integrity'>,
  filter: FinanceFilter, today: string, groupBy: ResultsGroupBy = DEFAULT_GROUP_BY,
): ResultsInput {
  const raw = load.raw
  const ix = buildIndex(raw.blasts, raw.suppliers, raw.costs)
  const items = itemsOf(raw.projects, raw.blasts, raw.suppliers, raw.costs, ix)
  const population = populationFor(items, 'results', filter, today)
  return { load, ix, items, population, filter, today, groupBy }
}

/* ── THE MODEL ────────────────────────────────────────────────────────────── */

export interface FigureText { value: string; sub: string }

export interface Tile1 {
  /** The margin set. */
  surveys: number
  ids: string[]
  clientPrice: number
  ourCost: number
  /** Our cost per $1 of client price, or null with no price above $0. */
  costPerDollar: number | null
  kept: number
  keptPct: number | null
  /** The margin set without the surveys given away at $0. */
  paid: { surveys: number; kept: number; keptPct: number | null }
  free: { surveys: number; cost: number; ids: string[] }
  budget: {
    /** Median budget ÷ client price on margin surveys priced above $0. */
    medianPerDollar: number | null
    n: number
    overBudget: number
    overBudgetMadeMoney: number
    atOrUnderGoal: number
    /** Delivered surveys in view carrying a budget — what the drill lists. */
    withBudget: number
    /** Margin-set surveys carrying a budget — the base `overBudget` counts
     *  out of, which is neither `n` (those priced above $0) nor `withBudget`. */
    withBudgetInMargin: number
  }
  /** Priced above $0 but billed no respondents, so revenue is $0: in the margin
   *  set and in neither the paid nor the given-away bucket. Its whole cost is a
   *  loss, and the ledger tags it LOST MONEY. */
  zeroBilled: { surveys: number; cost: number; ids: string[] }
  /** Margin surveys priced above $0, and how many spent past the goal share
   *  of their price (half, while KEEP_GOAL is 50%). */
  pricedAboveZero: number
  spentOverGoal: number
  text: Record<'price' | 'cost' | 'kept' | 'budget', FigureText>
}

export interface CoverageLine {
  deliveredSurveys: number
  /** Recorded spend on every delivered survey in view. */
  deliveredSpend: number
  marginCost: number
  /** marginCost ÷ deliveredSpend. */
  share: number | null
  noPrice: { spend: number; surveys: number }
  /** Priced, but no delivered N or no target yet, so no revenue. */
  pricedBlocked: { surveys: number; spend: number; ids: string[] }
  /** Priced and delivered with no recorded cost — left out of the margin. */
  pricedNoCost: { surveys: number; ids: string[] }
  parts: Part[]
}

export type CostLineKey = 'panel' | 'rewardsGross' | 'recovered' | 'sends' | 'other' | 'total'

export interface WaterfallLine {
  key: CostLineKey
  label: string
  help: string
  amount: number
  /** Delivered surveys with a non-zero amount on this line. */
  surveys: number
}

export interface SmsWords {
  messages: number
  textBlasts: number
  /** The distinct per-message rates recorded on those blasts. */
  rates: number[]
  /** Blasts with no channel recorded — charged as text, as the database does. */
  unrecordedChannel: number
  words: string
}

export interface Waterfall {
  lines: WaterfallLine[]
  total: number
  recoveredSurveys: number
  recoveredLines: number
  sms: SmsWords
  note: string
}

export interface OutsideBucket {
  /** Surveys in the class, in scope, that spent anything — what the drill lists. */
  surveys: number
  spend: number
  ids: string[]
  /** Every survey in the class, in scope, spend or not. */
  inClass: number
}

export interface NotInFigures {
  cancelled: OutsideBucket
  archived: OutsideBucket
  parts: Part[]
}

export interface MonthBar {
  /** 'YYYY-MM'. */
  key: string
  label: string
  /** The axis label: "Aug", or "Aug 2025" when the view spans years. */
  short: string
  /** Client price and our cost on the month's margin set. null — a gap, never
   *  $0 — when the month has no margin survey. */
  price: number | null
  cost: number | null
  kept: number | null
  keptPct: number | null
  paidKeptPct: number | null
  /** Margin surveys in the month. */
  surveys: number
  paidSurveys: number
  freeSurveys: number
  freeCost: number
  spendNoPrice: number
  surveysNoPrice: number
  delivered: number
  priced: number
  /** Recorded spend on every delivered survey in the month (monthTable). */
  spend: number
  pricedShare: number | null
  /** Before the month from which costs are recorded on most delivered work
   *  (computed on the whole book): greyed and labelled "costs not recorded". */
  beforeReliable: boolean
  /** Few priced surveys, or a low share of the month priced: faded. */
  thin: boolean
  /** Why the month is greyed or faded, for the tooltip and table. */
  note: string | null
  recoveriesPending: boolean
  rewardedSurveys: number
  creditedSurveys: number
  ids: string[]
  /** The month as a custom range, for "Filter the page to …". */
  from: string
  to: string
}

export type LedgerTag = 'lost-money' | 'over-budget' | 'given-away' | 'no-price'

export const TAG_LABEL: Record<LedgerTag, string> = {
  'lost-money': 'LOST MONEY',
  'over-budget': 'OVER BUDGET',
  'given-away': 'GIVEN AWAY $0',
  'no-price': 'NO PRICE',
}

export const TAG_HELP: Record<LedgerTag, string> = {
  'lost-money': 'Our field cost was more than the client price, on a study priced above $0. A study that billed no respondents counts: its whole cost is a loss.',
  'over-budget': 'Spent more than its budget. Not the same as losing money: a study can go over budget and still make money.',
  'given-away': 'Priced at $0 on purpose (a trial or internal work). The cost is real and there is no revenue.',
  'no-price': 'No client price is recorded, so this study cannot appear in any margin figure. Price it on the project page.',
}

/** One survey — the three-way ledger's row, and the export's. */
export interface LedgerRow {
  id: string
  code: string | null
  name: string | null
  account: string
  accountId: string | null
  route: Route
  date: string | null
  rate: number | null
  billedN: number | null
  revenue: number | null
  cost: number
  /** Price − cost, only on the margin set (a priced survey with no recorded
   *  cost is not "100% kept"). */
  kept: number | null
  keptPct: number | null
  budget: number | null
  spendPerBudget: number | null
  /** Only on the margin set and a price above $0. */
  spendPerPrice: number | null
  budgetPerPrice: number | null
  pricePerBilledN: number | null
  /** Blank when the survey's N actual counts only some of its segments. */
  costPerBilledN: number | null
  inMargin: boolean
  priced: boolean
  free: boolean
  revenueReason: RevenueBlock
  partialRollUp: boolean
  /** Counted in the "Budget set at" median. */
  inMedian: boolean
  tags: LedgerTag[]
}

export interface GroupRouteRow {
  route: Route
  label: string
  measured: number
  revenue: number
  cost: number
  kept: number
  keptPct: number | null
  pricePerBilledN: number | null
  costPerBilledN: number | null
  /** Surveys left out of the two per-respondent figures because their N actual
   *  counts only some of their segments (see `perRespondentOf`). */
  partialExcluded: number
  ids: string[]
}

export interface GroupRow {
  key: string
  label: string
  /** A second line, e.g. the account a contact belongs to. */
  sub: string | null
  /** Delivered surveys in the group, and how many are in the margin set. */
  surveys: number
  measured: number
  revenue: number
  cost: number
  kept: number
  keptPct: number | null
  /** Per billed respondent on both sides; null on a row that blends routes. */
  pricePerBilledN: number | null
  costPerBilledN: number | null
  /** Surveys left out of the two per-respondent figures because their N actual
   *  counts only some of their segments (see `perRespondentOf`). */
  partialExcluded: number
  /** Spend on the group's surveys with no client price. */
  unpricedSpend: number
  unpricedSurveys: number
  freeSurveys: number
  tooFew: boolean
  /** The margin set spans more than one route, so the per-respondent figures
   *  are on the route rows only. */
  blended: boolean
  routes: GroupRouteRow[]
  /** The margin surveys (what the bar and the drill count). */
  ids: string[]
  /** Every delivered survey in the group. */
  memberIds: string[]
}

export interface Tile2 {
  by: ResultsGroupBy
  /** Group rows (empty for the survey and panel views). */
  rows: GroupRow[]
  /** Groups with no survey in the margin set. */
  unmeasured: number
  tooFew: number
  verdict: Part[]
}

export interface ResultsModel {
  groupBy: ResultsGroupBy
  scope: FilterDescription
  /** Why the price figures cannot be shown, or null. A failed or empty price
   *  read is "missing", never $0. */
  priceBlock: string | null
  tile1: Tile1
  coverage: CoverageLine
  waterfall: Waterfall
  notIn: NotInFigures
  months: MonthBar[]
  /** Delivered surveys with no date: in the figures, in no month. */
  undated: { delivered: number; surveys: number; spend: number } | null
  /** 'YYYY-MM' from which costs are recorded on most delivered work, on the
   *  whole book (coverage.ts), or null when no month qualifies yet. */
  costReliableFrom: string | null
  verdict: Part[]
  tile2: Tile2
  /** Every delivered survey in view, worst kept first. */
  ledger: LedgerRow[]
  /** The per-survey P&L behind everything above, kept for the drills. */
  pnl: SurveyPnl[]
}

/* ── BUILD ────────────────────────────────────────────────────────────────── */

const EPS = 1e-9

export function buildResultsModel(input: ResultsInput): ResultsModel {
  const { load, ix, population, filter, today } = input
  const groupBy = input.groupBy ?? DEFAULT_GROUP_BY
  const raw = load.raw
  const rows = population.map(it => it.p)
  const accounts = new Map(raw.accounts.map(a => [a.id, a.name ?? '(unnamed)']))
  const scope = input.scope ?? describe(filter, {
    tab: 'results', today, count: population.length,
    accountName: filter.account ? accounts.get(filter.account) ?? '(unknown account)' : null,
  })

  const pnl = surveyPnl(rows, raw.rates, raw.blasts, raw.suppliers, raw.costs, accounts)
  const margin = marginOf(rows, raw.rates, raw.blasts, raw.suppliers, raw.costs)
  const bvp = budgetVsPrice(pnl)
  const ledger = ledgerOf(pnl, new Set(bvp.ids))
  const spends = new Map<string, Spend>(rows.map(p => [p.id, spendOf(p, raw.blasts, raw.suppliers, raw.costs, ix)]))

  const tile1 = tile1Of(margin, bvp, ledger)
  const coverage = coverageOf(margin, spends)
  const waterfall = waterfallOf(rows, spends, input)
  const notIn = notInOf(input)
  const { months, undated, costReliableFrom } = monthsOf(input, rows)
  const verdict = verdictOf(tile1, months, ledger, costReliableFrom)
  const tile2 = tile2Of(groupBy, pnl, ledger, input)

  return {
    groupBy, scope,
    priceBlock: priceBlockText(load, { canViewFinancials: true }),
    tile1, coverage, waterfall, notIn, months, undated, costReliableFrom,
    verdict, tile2, ledger, pnl,
  }
}

/* ── Tile 1 ───────────────────────────────────────────────────────────────── */

function tile1Of(
  margin: ReturnType<typeof marginOf>, bvp: ReturnType<typeof budgetVsPrice>, ledger: LedgerRow[],
): Tile1 {
  const n = margin.surveys
  const costPerDollar = perDollarOfPrice(margin.cost, margin.revenue)
  const withBudget = ledger.filter(l => l.budget != null).length
  // THE BASE OF THE OVER-BUDGET COUNT. Three different populations meet on this
  // one figure: the median counts margin surveys with a budget AND a price
  // above $0, "went over budget" counts every margin survey with a budget, and
  // the drill lists every delivered survey with a budget. Naming only the first
  // let a reader take "7 went over" as 7 of the median's 21 when it was 7 of 22,
  // so the sentence now says the base of each count.
  const withBudgetInMargin = ledger.filter(l => l.inMargin && l.budget != null).length
  // Priced above $0 and billed NOTHING: a delivered N of 0, or an N target of 0.
  // Revenue is $0, so it is in neither the paid bucket (which needs revenue
  // above $0) nor the $0-price bucket — it would vanish from a sentence that
  // named only the giveaways, while its whole cost is a loss.
  const zeroBilled = ledger.filter(l => l.inMargin && !l.free && l.revenue === 0)
  const zeroBilledCost = zeroBilled.reduce((s, l) => s + l.cost, 0)
  const goal = pctText(KEEP_GOAL)
  const over = bvp.overBudget === 0
    ? withBudgetInMargin === 1
      ? 'The one study with a budget stayed inside it.'
      : `None of the ${surveysWord(withBudgetInMargin)} with a budget went over it.`
    : `Of the ${surveysWord(withBudgetInMargin)} with a budget, ${fmtNum(bvp.overBudget)} went over it; ${fmtNum(bvp.overBudgetMadeMoney)} of those still made money.`
  // What "on paid work" leaves out, named from the surveys actually left out.
  const leftOut: string[] = []
  if (margin.free.surveys > 0) {
    leftOut.push(`${surveysWord(margin.free.surveys)} given away at $0 (${money(-margin.free.cost)})`)
  }
  if (zeroBilled.length > 0) {
    leftOut.push(`${surveysWord(zeroBilled.length)} that billed no respondents (${money(-zeroBilledCost)})`)
  }
  return {
    surveys: n,
    ids: margin.ids,
    clientPrice: margin.revenue,
    ourCost: margin.cost,
    costPerDollar,
    kept: margin.margin,
    keptPct: margin.pct,
    paid: { surveys: margin.paid.surveys, kept: margin.paid.margin, keptPct: margin.paid.pct },
    free: { surveys: margin.free.surveys, cost: margin.free.cost, ids: margin.free.ids },
    budget: {
      medianPerDollar: bvp.medianPerDollar,
      n: bvp.n,
      overBudget: bvp.overBudget,
      overBudgetMadeMoney: bvp.overBudgetMadeMoney,
      atOrUnderGoal: bvp.atOrUnderGoal,
      withBudget,
      withBudgetInMargin,
    },
    zeroBilled: { surveys: zeroBilled.length, cost: zeroBilledCost, ids: zeroBilled.map(l => l.id) },
    pricedAboveZero: bvp.pricedAboveZero,
    spentOverGoal: bvp.spentOverGoal,
    text: {
      price: {
        value: money(margin.revenue),
        sub: `On ${surveysWord(n)} with both a client price and a recorded cost.`,
      },
      cost: {
        value: money(margin.cost),
        sub: costPerDollar != null
          ? `${centsText(costPerDollar)} of every $1 of client price. Field cost only.`
          : 'No client price above $0 to set it against.',
      },
      kept: {
        value: margin.pct != null ? `${money(margin.margin)} · ${pctText(margin.pct)}` : money(margin.margin),
        sub: (leftOut.length > 0
          ? `${pctText(margin.paid.pct)} on paid work — excludes ${leftOut.join(' and ')}.`
          : 'No study here was given away at $0 or billed nothing.') + ` Goal: ${goal}.`,
      },
      budget: {
        value: bvp.medianPerDollar != null ? `${centsText(bvp.medianPerDollar)} per $1` : '—',
        sub: bvp.n > 0
          ? `Median of ${surveysWord(bvp.n)} with a budget and a price above $0. ${over}`
          : withBudgetInMargin > 0
            ? `No study here has both a budget and a price above $0, so there is no median. ${over}`
            : 'No study here has both a budget and a price above $0, so there is no median.',
      },
    },
  }
}

/* ── The coverage line ────────────────────────────────────────────────────── */

function coverageOf(margin: ReturnType<typeof marginOf>, spends: Map<string, Spend>): CoverageLine {
  const blockedSpend = margin.pricedBlockedIds.reduce((s, id) => s + (spends.get(id)?.total ?? 0), 0)
  const share = margin.spend > 0 ? margin.cost / margin.spend : null
  const n = margin.surveys
  const parts: Part[] = []
  if (margin.spend <= 0) {
    parts.push(t('No spend is recorded on delivered work in this view.'))
  } else if (n === 0) {
    parts.push(
      t('No delivered study in this view has both a client price and a recorded cost. Delivered work here spent '),
      act('waterfall', money(margin.spend)), t('.'),
    )
  } else {
    parts.push(
      t(`${n === 1 ? 'This study holds' : `These ${surveysWord(n)} hold`} ${pctText(share)} of the `),
      act('waterfall', money(margin.spend)),
      t(' spent on delivered work in this view.'),
    )
  }
  if (margin.surveysNoPrice > 0) {
    parts.push(
      t(' '), act('unpriced', money(margin.spendNoPrice)),
      t(` of it is on ${surveysWord(margin.surveysNoPrice)} with no client price — `),
      act('improve', `price ${margin.surveysNoPrice === 1 ? 'it' : 'them'} from the Improve tab`), t('.'),
    )
  } else if (margin.spend > 0) {
    parts.push(t(' Every delivered study here that spent money carries a client price.'))
  }
  if (margin.pricedBlocked > 0) {
    parts.push(t(` Another ${money(blockedSpend)} is on ${fmtNum(margin.pricedBlocked)} priced ${plural(margin.pricedBlocked, 'study', 'studies')} that cannot be billed yet: no delivered N or no N target.`))
  }
  if (margin.pricedNoCost > 0) {
    parts.push(t(` ${fmtNum(margin.pricedNoCost)} priced ${plural(margin.pricedNoCost, 'study carries', 'studies carry')} no recorded cost and ${margin.pricedNoCost === 1 ? 'is' : 'are'} left out, so ${margin.pricedNoCost === 1 ? 'it does' : 'they do'} not read as 100% kept.`))
  }
  return {
    deliveredSurveys: margin.delivered,
    deliveredSpend: margin.spend,
    marginCost: margin.cost,
    share,
    noPrice: { spend: margin.spendNoPrice, surveys: margin.surveysNoPrice },
    pricedBlocked: { surveys: margin.pricedBlocked, spend: blockedSpend, ids: margin.pricedBlockedIds },
    pricedNoCost: { surveys: margin.pricedNoCost, ids: margin.pricedNoCostIds },
    parts,
  }
}

/* ── The spend waterfall ──────────────────────────────────────────────────── */

const SPEND_FIELD: Record<Exclude<CostLineKey, 'total'>, keyof Spend> = {
  panel: 'panel', rewardsGross: 'reward', recovered: 'recovered', sends: 'send', other: 'other',
}

/** One cost line of one survey, read off its Spend. */
export const lineOf = (sp: Spend, key: CostLineKey): number =>
  key === 'total' ? sp.total : (sp[SPEND_FIELD[key]] as number)

function smsWordsOf(ids: Set<string>, input: ResultsInput): SmsWords {
  const text = input.load.raw.blasts.filter(b =>
    ids.has(b.project_id) && b.channel !== 'email' &&
    Number(b.people ?? 0) > 0 && Number(b.cost_per_send ?? 0) > 0)
  const messages = text.reduce((s, b) => s + Number(b.people ?? 0), 0)
  const rates = [...new Set(text.map(b => Number(b.cost_per_send)))].sort((a, b) => a - b)
  const unrecordedChannel = text.filter(b => b.channel == null).length
  let words: string
  if (!text.length) {
    words = 'No text messages were charged on these studies. Email sends are free.'
  } else {
    words = `${fmtNum(messages)} text ${plural(messages, 'message')} on ${fmtNum(text.length)} ${plural(text.length, 'blast')}, ` +
      (rates.length === 1
        ? `at ${money2(rates[0])} a message — the rate recorded on every one of them`
        : `at ${fmtNum(rates.length)} different recorded rates, from ${money2(rates[0])} to ${money2(rates[rates.length - 1])} a message`) +
      '. The rate was backfilled rather than read off a carrier invoice, so this line is an estimate until an invoice confirms it. Email sends are free.'
    if (unrecordedChannel > 0) {
      words += ` ${fmtNum(unrecordedChannel)} ${plural(unrecordedChannel, 'blast has', 'blasts have')} no channel recorded and ${unrecordedChannel === 1 ? 'is' : 'are'} charged as text, as the database does.`
    }
  }
  return { messages, textBlasts: text.length, rates, unrecordedChannel, words }
}

function waterfallOf(rows: FinProject[], spends: Map<string, Spend>, input: ResultsInput): Waterfall {
  const raw = input.load.raw
  const split = costBreakdown(rows, raw.blasts, raw.suppliers, raw.costs, input.ix)
  const sms = smsWordsOf(new Set(rows.map(p => p.id)), input)
  const count = (key: CostLineKey) =>
    rows.filter(p => Math.abs(lineOf(spends.get(p.id) as Spend, key)) > EPS).length
  const lines: WaterfallLine[] = COST_LINES.map(l => ({
    key: l.key as CostLineKey,
    label: l.key === 'recovered' ? 'Rewards recovered (money back)' : l.label,
    help: l.key === 'sends' ? `${l.help} ${sms.words}` : l.help,
    amount: split[l.key] as number,
    surveys: count(l.key as CostLineKey),
  }))
  const note = 'Recovered rewards are their own negative line and are never folded into Other costs. ' +
    (split.recoveredSurveys > 0
      ? `${money(-split.recovered)} came back on ${surveysWord(split.recoveredSurveys)}; blast rewards net of it are ${money(split.rewardsNet)}.`
      : 'No recovered rewards are booked on these studies yet, so blast rewards are gross.')
  return {
    lines, total: split.total,
    recoveredSurveys: split.recoveredSurveys, recoveredLines: split.recoveredLines,
    sms, note,
  }
}

/* ── Not in these figures ─────────────────────────────────────────────────── */

/** Cancelled or archived work in the same account and route scope, at ANY
 *  date: spend that bought nothing billable, which the tile does not show. */
function outsideRule(cls: FinClass): TabRule {
  return { classes: [cls], side: [], date: false, account: true, route: true, word: CLASS_LABEL[cls] }
}

function outsideOf(input: ResultsInput, cls: FinClass): OutsideBucket {
  const raw = input.load.raw
  const out: OutsideBucket = { surveys: 0, spend: 0, ids: [], inClass: 0 }
  for (const it of populationByRule(input.items, outsideRule(cls), input.filter, input.today)) {
    out.inClass++
    const sp = spendOf(it.p, raw.blasts, raw.suppliers, raw.costs, input.ix).total
    if (Math.abs(sp) <= EPS) continue
    out.surveys++; out.spend += sp; out.ids.push(it.p.id)
  }
  return out
}

function notInOf(input: ResultsInput): NotInFigures {
  const cancelled = outsideOf(input, 'cancelled')
  const archived = outsideOf(input, 'archived')
  // "$721 spent by 1 of the 14 surveys cancelled before delivery": the drill
  // lists the ones that spent, and the count of all of them says how rare that is.
  const clause = (b: OutsideBucket, action: 'cancelled' | 'archived', what: string): Part[] => {
    if (b.inClass === 0) return [t(`no study ${what}`)]
    const all = b.inClass === 1 ? `the 1 study ${what}` : `the ${fmtNum(b.inClass)} studies ${what}`
    if (b.surveys === 0) return [t(`no spend on ${all}`)]
    const who = b.surveys === b.inClass
      ? (b.inClass === 1 ? all : `all ${fmtNum(b.inClass)} studies ${what}`)
      : `${fmtNum(b.surveys)} of ${all}`
    return [act(action, money(b.spend)), t(` spent by ${who}`)]
  }
  const parts: Part[] = [t('Not in these figures: ')]
  if (cancelled.surveys === 0 && archived.surveys === 0) {
    parts.push(t('nothing. No cancelled study, and none archived without delivery, has any recorded spend in this account and route.'))
  } else {
    parts.push(
      ...clause(cancelled, 'cancelled', 'cancelled before delivery'),
      t(', and '),
      ...clause(archived, 'archived', 'archived without delivery'),
      t(' — at any date, in the same account and route.'),
    )
  }
  return { cancelled, archived, parts }
}

/* ── Chart C1: months ─────────────────────────────────────────────────────── */

const endOfMonth = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

function monthsOf(input: ResultsInput, rows: FinProject[]): {
  months: MonthBar[]; undated: ResultsModel['undated']; costReliableFrom: string | null
} {
  const raw = input.load.raw
  const mt = monthTable(rows, raw.rates, raw.blasts, raw.suppliers, raw.costs)
  // The cost-reliability month is a fact about the WHOLE book, so it is
  // computed on every delivered survey, whatever this view is filtered to — a
  // fixed line, never the first month that happens to have spend in view.
  const book = coverageByMonth(input.items.map(it => it.p), raw.rates, raw.blasts, raw.suppliers, raw.costs, input.ix)
  const costReliableFrom = reliabilityDates(book).cost.month
  const years = new Set(mt.periods.map(p => p.key.slice(0, 4)))
  const threshold = RELIABILITY.price.threshold
  const months = mt.periods.map((p): MonthBar => {
    const m = p.margin
    const label = monthLabel(p.key)
    const beforeReliable = costReliableFrom == null || p.key < costReliableFrom
    const pricedShare = p.delivered > 0 ? p.pricedSurveys / p.delivered : null
    let note: string | null = null
    let thin = false
    if (beforeReliable) {
      note = costReliableFrom
        ? `Costs not recorded: before ${monthLabel(costReliableFrom)} most delivered studies carry no cost`
        : 'Costs not recorded: no month yet has a cost on most delivered studies'
    } else if (m.surveys < MIN_MONTH_SURVEYS) {
      thin = true
      note = m.surveys === 0
        ? 'No study this month has both a client price and a cost'
        : `Only ${surveysWord(m.surveys)} with both a client price and a cost`
    } else if (pricedShare != null && pricedShare < threshold) {
      thin = true
      note = `Only ${pctText(pricedShare)} of this month's delivered studies carry a price`
    }
    return {
      key: p.key,
      label,
      short: years.size > 1 ? label : label.slice(0, 3),
      price: m.surveys > 0 ? m.revenue : null,
      cost: m.surveys > 0 ? m.cost : null,
      kept: m.surveys > 0 ? m.kept : null,
      keptPct: m.keptPct,
      paidKeptPct: m.paidKeptPct,
      surveys: m.surveys,
      paidSurveys: m.paidSurveys,
      freeSurveys: m.freeSurveys,
      freeCost: m.freeCost,
      spendNoPrice: m.spendNoPrice,
      surveysNoPrice: m.surveysNoPrice,
      delivered: p.delivered,
      priced: p.pricedSurveys,
      spend: p.spend,
      pricedShare,
      beforeReliable,
      thin,
      note,
      recoveriesPending: p.recoveriesPending,
      rewardedSurveys: p.rewardedSurveys,
      creditedSurveys: p.creditedSurveys,
      ids: p.ids,
      from: `${p.key}-01`,
      to: endOfMonth(p.key),
    }
  })
  const u = mt.undated
  return {
    months,
    undated: u ? { delivered: u.delivered, surveys: u.margin.surveys, spend: u.spend } : null,
    costReliableFrom,
  }
}

/* ── The verdict ──────────────────────────────────────────────────────────── */

const goalShareWords = () =>
  KEEP_GOAL === 0.5 ? 'half their price' : `${pctText(1 - KEEP_GOAL)} of their price`

/** THE GOAL, IN WORDS, BUILT FROM THE CONSTANT.
 *
 *  The 50% goal was typed into six pieces of copy while KEEP_GOAL drove every
 *  computed figure and every colour, so moving the goal would have left six
 *  sentences saying something the page no longer did. These two helpers are the
 *  only way the goal is written: `goalKeptWords` is the share we aim to keep
 *  ("50%"), `goalCostWords` the other side of the same coin — the most a $1 of
 *  client price should cost us ("50¢"). */
export const goalKeptWords = () => pctText(KEEP_GOAL)
export const goalCostWords = () => centsText(1 - KEEP_GOAL)

function verdictOf(tile1: Tile1, months: MonthBar[], ledger: LedgerRow[], costFrom: string | null): Part[] {
  const out: Part[] = []
  if (tile1.surveys === 0) {
    out.push(
      t('No delivered study in this view carries both a client price and a recorded cost, so there is nothing to call yet. '),
      act('improve', 'Add the missing prices from the Improve tab'), t('.'),
    )
    return out
  }

  // Month over month, on the months whose costs are recorded.
  const usable = months.filter(m => !m.beforeReliable)
  const last2 = usable.slice(-2)
  const a = last2.length === 2 ? last2[0] : null
  const b = last2.length ? last2[last2.length - 1] : null
  if (a && b) {
    if (a.surveys >= TREND_MIN_N && b.surveys >= TREND_MIN_N) {
      out.push(t(`${a.label} ${pctText(a.keptPct)} → ${b.label} ${pctText(b.keptPct)}`))
      if (b.freeSurveys > 0 && b.paidKeptPct != null) {
        out.push(t(`, but ${b.label} is ${pctText(b.paidKeptPct)} without the ${surveysWord(b.freeSurveys)} given away at $0`))
        const aPaid = a.paidKeptPct ?? a.keptPct
        if (aPaid != null && b.paidSurveys >= TREND_MIN_N && a.paidSurveys >= TREND_MIN_N) {
          const d = b.paidKeptPct - aPaid
          out.push(t(Math.abs(d) < LEVEL_WITHIN ? ` — level with ${a.label}` : d > 0 ? ` — above ${a.label}` : ` — still below ${a.label}`))
        }
      }
      if (b.recoveriesPending) out.push(t(`, and ${b.label} blast cost is still waiting on reward recoveries`))
      out.push(t('. '))
    } else {
      out.push(t(`Too few studies to call a trend: ${a.label} has ${fmtNum(a.surveys)} and ${b.label} has ${fmtNum(b.surveys)} with both a price and a cost, and each month needs ${fmtNum(TREND_MIN_N)}. `))
      if (b.recoveriesPending) out.push(t(`${b.label} blast cost is still waiting on reward recoveries. `))
    }
  } else if (b) {
    out.push(t(`Only ${b.label} is in view, so there is no month-over-month trend to call. `))
    if (b.recoveriesPending) out.push(t(`Its blast cost is still waiting on reward recoveries. `))
  } else if (costFrom == null) {
    out.push(t('Costs are not yet recorded on most delivered studies in any month, so there is no trend to call. '))
  }

  const losers = ledger.filter(l => l.tags.includes('lost-money')).sort((x, y) => (x.kept ?? 0) - (y.kept ?? 0))
  if (losers.length) {
    out.push(t(`${fmtNum(losers.length)} priced ${plural(losers.length, 'study', 'studies')} lost money: `))
    losers.slice(0, LOSSES_NAMED).forEach((l, i) => {
      if (i > 0) out.push(t(', '))
      out.push({ kind: 'survey', id: l.id, text: l.code ?? '(no code)' }, t(` ${money(l.kept ?? 0)}`))
    })
    if (losers.length > LOSSES_NAMED) out.push(t(`, and ${fmtNum(losers.length - LOSSES_NAMED)} more`))
    out.push(t(`. Re-price ${losers.length === 1 ? "that account's" : "those accounts'"} next waves. `))
  } else if (tile1.paid.keptPct != null && tile1.paid.keptPct < KEEP_GOAL) {
    out.push(t(`No study priced above $0 lost money, but paid work keeps ${pctText(tile1.paid.keptPct)}, under the ${pctText(KEEP_GOAL)} goal. Price the next waves toward the goal. `))
  } else {
    out.push(t(`No study priced above $0 lost money. Keep quoting at this level. `))
  }
  if (tile1.pricedAboveZero > 0) {
    out.push(t(`${fmtNum(tile1.spentOverGoal)} of ${fmtNum(tile1.pricedAboveZero)} priced ${plural(tile1.pricedAboveZero, 'study', 'studies')} spent more than ${goalShareWords()}.`))
  }
  // Trim the trailing space a sentence left behind.
  const last = out[out.length - 1]
  if (last.kind === 'text') out[out.length - 1] = t(last.text.replace(/\s+$/, ''))
  return out
}

/* ── The three-way ledger ─────────────────────────────────────────────────── */

function ledgerOf(pnl: SurveyPnl[], inMedian: Set<string>): LedgerRow[] {
  const out = pnl.map((s): LedgerRow => {
    const billed = s.billableN
    const budget = s.budget != null && s.budget > 0 ? s.budget : null
    const tags: LedgerTag[] = []
    // `!s.free` rather than `s.ratioEligible`: a survey priced above $0 that
    // billed no respondents has $0 of revenue, so it is not ratio-eligible, but
    // its whole cost is still a loss and it was not given away on purpose. The
    // old test left it with no tag at all and out of the verdict's loss list.
    if (s.inMargin && !s.free && (s.margin ?? 0) < 0) tags.push('lost-money')
    if (budget != null && s.cost > budget) tags.push('over-budget')
    if (s.free) tags.push('given-away')
    if (!s.priced) tags.push('no-price')
    return {
      id: s.id, code: s.code, name: s.name, account: s.account, accountId: s.accountId,
      route: s.route, date: s.date,
      rate: s.rate, billedN: billed, revenue: s.revenue, cost: s.cost,
      kept: s.inMargin ? s.margin : null,
      keptPct: s.inMargin ? s.marginPct : null,
      budget,
      spendPerBudget: budget != null ? s.cost / budget : null,
      spendPerPrice: s.inMargin ? s.spendPerPrice : null,
      budgetPerPrice: s.budgetPerPrice,
      pricePerBilledN: s.revenue != null && billed != null && billed > 0 ? s.revenue / billed : null,
      // Cost over a partial segment roll-up would set every segment's cost
      // against one segment's N (revenue.ts perRespondentNOf).
      costPerBilledN: !s.partialRollUp && billed != null && billed > 0 && s.cost > 0 ? s.cost / billed : null,
      inMargin: s.inMargin, priced: s.priced, free: s.free, revenueReason: s.revenueReason,
      partialRollUp: s.partialRollUp,
      inMedian: inMedian.has(s.id),
      tags,
    }
  })
  // Worst kept first; surveys outside the margin set after them, most spend first.
  return out.sort((a, b) =>
    a.kept != null && b.kept != null ? a.kept - b.kept
      : a.kept != null ? -1 : b.kept != null ? 1 : b.cost - a.cost)
}

/* ── Tile 2: groups ───────────────────────────────────────────────────────── */

interface GroupKey { key: string; label: string; sub: string | null; order: string }

function groupKeyFn(by: ResultsGroupBy, input: ResultsInput): (s: SurveyPnl) => GroupKey {
  const raw = input.load.raw
  const project = new Map(input.population.map(it => [it.p.id, it.p]))
  const contacts = new Map<string, FinContact>(raw.contacts.map(c => [c.id, c]))
  switch (by) {
    case 'route':
      return s => ({ key: s.route, label: ROUTE_WORD[s.route], sub: null, order: s.route })
    case 'month':
      return s => {
        const k = s.date ? periodKey(s.date) : 'undated'
        return { key: k, label: monthLabel(k), sub: null, order: k === 'undated' ? '9999' : k }
      }
    case 'contact':
      return s => {
        const id = project.get(s.id)?.requested_by_contact_id ?? null
        const c = id ? contacts.get(id) : undefined
        if (id && c) return { key: `c:${id}`, label: contactName(c), sub: s.account, order: contactName(c) }
        if (id) return { key: `c:${id}`, label: '(unknown contact)', sub: s.account, order: '~' }
        return { key: `none:${s.accountId ?? s.account}`, label: 'No contact recorded', sub: s.account, order: '~~' }
      }
    case 'type':
      return s => {
        const ty = project.get(s.id)?.project_type ?? null
        return { key: `t:${ty ?? ''}`, label: ty ?? 'Not filed', sub: null, order: ty ?? '~' }
      }
    default:
      return s => ({ key: s.accountId ?? `n:${s.account}`, label: s.account, sub: null, order: s.account })
  }
}

/**
 * Price and cost PER BILLED RESPONDENT for a set of margin surveys, with
 * partial segment roll-ups left out of both sides.
 *
 * A survey whose N actual only adds up the segments that have a count carries
 * the cost of EVERY segment against an N that counts some of them, so its cost
 * per respondent reads far too high (revenue.ts `perRespondentNOf`; the month
 * table and the per-survey ledger both drop it for the same reason). The shared
 * account table cannot know that — it sums `billableN` for every margin survey —
 * so the group rows recompute the pair here rather than passing its blended
 * answer through, which would print a cost per respondent the ledger blanks.
 *
 * Both sides drop the same surveys, so the two figures stay on the same
 * respondents and still subtract to what we keep per respondent.
 */
function perRespondentOf(ids: string[], byId: Map<string, SurveyPnl>): {
  pricePerBilledN: number | null; costPerBilledN: number | null; partialExcluded: number
} {
  let revenue = 0, cost = 0, n = 0, partialExcluded = 0
  for (const id of ids) {
    const s = byId.get(id)
    if (!s) continue
    if (s.partialRollUp) { partialExcluded++; continue }
    revenue += s.revenue ?? 0
    cost += s.cost
    n += s.billableN ?? 0
  }
  return {
    pricePerBilledN: n > 0 ? revenue / n : null,
    costPerBilledN: n > 0 ? cost / n : null,
    partialExcluded,
  }
}

/** The groups for one picker choice, built by the account table's own code
 *  (analysis.ts accountPnl): each survey is handed to it wearing its group as
 *  its "account", so every grouping — route, month, contact, type — sums,
 *  splits by route and blanks blended per-respondent figures exactly as the
 *  account table does. The two per-respondent figures are the one exception:
 *  they are recomputed here (`perRespondentOf`) so a partial segment roll-up
 *  cannot set a whole survey's cost against part of its N. */
export function groupRowsOf(by: ResultsGroupBy, pnl: SurveyPnl[], input: ResultsInput): GroupRow[] {
  if (by === 'survey' || by === 'panel') return []
  const byId = new Map(pnl.map(s => [s.id, s]))
  const keyOf = groupKeyFn(by, input)
  const keys = new Map<string, GroupKey>()
  const members = new Map<string, SurveyPnl[]>()
  const worn = pnl.map(s => {
    const k = keyOf(s)
    keys.set(k.key, k)
    const m = members.get(k.key)
    if (m) m.push(s); else members.set(k.key, [s])
    return { ...s, accountId: k.key, account: k.label }
  })
  const rows = accountPnl(worn).map((a): GroupRow => {
    const key = a.accountId as string
    const k = keys.get(key) as GroupKey
    const mem = members.get(key) ?? []
    const unpriced = mem.filter(s => !s.priced && s.cost > 0)
    const blended = a.routes.length > 1
    const per = perRespondentOf(a.ids, byId)
    return {
      key, label: k.label, sub: k.sub,
      surveys: a.surveys, measured: a.measured,
      revenue: a.revenue, cost: a.cost, kept: a.margin, keptPct: a.marginPct,
      // A row that blends routes prints no per-respondent figure at all — a $3
      // panel price averaged with a $150 blast price describes the mix — so the
      // recomputation only applies where a figure is actually shown.
      pricePerBilledN: blended ? null : per.pricePerBilledN,
      costPerBilledN: blended ? null : per.costPerBilledN,
      partialExcluded: blended ? 0 : per.partialExcluded,
      unpricedSpend: unpriced.reduce((s, x) => s + x.cost, 0),
      unpricedSurveys: unpriced.length,
      freeSurveys: a.freeSurveys,
      tooFew: a.measured < GROUP_MIN_N,
      blended,
      routes: blended
        ? a.routes.map(r => {
          const rp = perRespondentOf(r.ids, byId)
          return {
            route: r.route, label: ROUTE_WORD[r.route], measured: r.measured,
            revenue: r.revenue, cost: r.cost, kept: r.margin, keptPct: r.marginPct,
            pricePerBilledN: rp.pricePerBilledN, costPerBilledN: rp.costPerBilledN,
            partialExcluded: rp.partialExcluded, ids: r.ids,
          }
        })
        : [],
      ids: a.ids,
      memberIds: mem.map(s => s.id),
    }
  })
  if (by === 'month') {
    return rows.sort((x, y) => (keys.get(x.key)!.order).localeCompare(keys.get(y.key)!.order))
  }
  // Most kept first, so the diverging chart reads from the biggest earner down
  // to the biggest loss; groups with nothing measurable after them, by the
  // unpriced spend that keeps them out.
  return rows.sort((x, y) =>
    x.measured > 0 && y.measured > 0 ? y.kept - x.kept
      : x.measured > 0 ? -1 : y.measured > 0 ? 1 : y.unpricedSpend - x.unpricedSpend)
}

function tile2Of(by: ResultsGroupBy, pnl: SurveyPnl[], ledger: LedgerRow[], input: ResultsInput): Tile2 {
  const rows = groupRowsOf(by, pnl, input)
  const unmeasured = rows.filter(r => r.measured === 0).length
  const tooFew = rows.filter(r => r.measured > 0 && r.tooFew).length
  return { by, rows, unmeasured, tooFew, verdict: by === 'survey' ? surveyVerdict(ledger) : by === 'panel' ? [] : groupVerdict(by, rows) }
}

const GROUP_NOUN: Record<ResultsGroupBy, [string, string]> = {
  account: ['account', 'accounts'], route: ['route', 'routes'], month: ['month', 'months'],
  contact: ['contact', 'contacts'], type: ['type', 'types'], survey: ['study', 'studies'],
  panel: ['panel', 'panels'],
}

function groupVerdict(by: ResultsGroupBy, rows: GroupRow[]): Part[] {
  const [one, many] = GROUP_NOUN[by]
  const measured = rows.filter(r => r.measured > 0)
  if (!measured.length) {
    return [
      t(`No ${one} here has a study with both a client price and a recorded cost. `),
      act('improve', 'Add the missing prices from the Improve tab'), t('.'),
    ]
  }
  const name = (r: GroupRow) => (r.sub ? `${r.label} (${r.sub})` : r.label)
  // A group whose only measured work was given away at $0 did not "lose
  // money" in a way re-pricing fixes: the price was $0 on purpose (a trial,
  // internal work). It is named as given away, and never told to re-price.
  const givenAway = measured.filter(r => r.freeSurveys === r.measured)
  const paid = measured.filter(r => r.freeSurveys < r.measured)
  const awayWords = (): Part[] => {
    if (!givenAway.length) return []
    const total = givenAway.reduce((s, r) => s + r.kept, 0)
    const who = givenAway.length <= 3
      ? givenAway.map(r => `${name(r)} (${money(r.kept)})`).join(', ')
      : `${fmtNum(givenAway.length)} ${many} (${money(total)})`
    return [t(`${who} had only work given away at $0; confirm the $0 ${givenAway.length === 1 && givenAway[0].measured === 1 ? 'price was' : 'prices were'} meant. `)]
  }
  if (!paid.length) {
    return [t(`Every ${one} here with a price and a cost was given away at $0. `), ...awayWords()].map((p, i, a) =>
      i === a.length - 1 && p.kind === 'text' ? t(p.text.replace(/\s+$/, '')) : p)
  }
  const judged = paid.filter(r => !r.tooFew)
  const pool = judged.length ? judged : paid
  const best = pool.reduce((x, y) => (y.kept > x.kept ? y : x))
  const losing = paid.filter(r => r.kept < 0)
  const out: Part[] = [
    t(`${name(best)} kept the most: ${money(best.kept)}${best.keptPct != null ? `, ${pctText(best.keptPct)}` : ''} on ${surveysWord(best.measured)}. `),
  ]
  const tooFew = paid.filter(r => r.tooFew).length
  if (tooFew > 0) {
    out.push(t(`${fmtNum(tooFew)} ${plural(tooFew, one, many)} ${tooFew === 1 ? 'has' : 'have'} fewer than ${fmtNum(GROUP_MIN_N)} studies and ${tooFew === 1 ? 'is' : 'are'} too few to judge. `))
  }
  out.push(...awayWords())
  const every = givenAway.length ? `Every other ${one}` : `Every ${one}`
  if (losing.length) {
    const worst = losing.reduce((x, y) => (y.kept < x.kept ? y : x))
    out.push(t(losing.length === 1
      ? `${name(worst)} lost money: ${money(worst.kept)}. Start the re-pricing with ${name(worst)}.`
      : `${fmtNum(losing.length)} ${many} lost money, the most ${name(worst)} at ${money(worst.kept)}. Start the re-pricing with ${name(worst)}.`))
    return out
  }
  const lowest = pool.reduce((x, y) => ((y.keptPct ?? 1) < (x.keptPct ?? 1) ? y : x))
  if (lowest.keptPct != null && lowest.keptPct < KEEP_GOAL) {
    out.push(t(`${every} kept money; the lowest is ${name(lowest)} at ${pctText(lowest.keptPct)}, under the ${pctText(KEEP_GOAL)} goal. Look at ${name(lowest)}'s pricing first.`))
  } else {
    out.push(t(`${every} kept money and ${judged.length ? `every one with ${fmtNum(GROUP_MIN_N)} or more studies` : 'each'} is at or above the ${pctText(KEEP_GOAL)} goal. Hold these prices.`))
  }
  return out
}

function surveyVerdict(ledger: LedgerRow[]): Part[] {
  const has = (tag: LedgerTag) => ledger.filter(l => l.tags.includes(tag))
  const lost = has('lost-money'), over = has('over-budget'), free = has('given-away'), none = has('no-price')
  const noPriceSpend = none.reduce((s, l) => s + (l.cost > 0 ? l.cost : 0), 0)
  if (!ledger.length) return [t('No delivered study is in this view. Widen the date range to see the ledger.')]
  const out: Part[] = [
    t(`Of ${surveysWord(ledger.length)}, ${fmtNum(lost.length)} lost money, ${fmtNum(over.length)} went over budget, ${fmtNum(free.length)} ${free.length === 1 ? 'was' : 'were'} given away at $0 and ${fmtNum(none.length)} ${none.length === 1 ? 'carries' : 'carry'} no price. `),
  ]
  if (none.length > 0 && noPriceSpend > 0) {
    out.push(t(`Price the unpriced ones first: they hold ${money(noPriceSpend)} of spend that no margin figure can see.`))
  } else if (lost.length > 0) {
    out.push(t(`Re-price the next waves of the ${fmtNum(lost.length)} that lost money.`))
  } else {
    out.push(t(`Nothing here lost money. Keep new budgets at ${goalCostWords()} per $1 of client price.`))
  }
  return out
}

/* ── Drills ───────────────────────────────────────────────────────────────── */

export type ResultsDrillRequest =
  | { kind: 'price' } | { kind: 'cost' } | { kind: 'kept' } | { kind: 'budget' }
  | { kind: 'line'; line: CostLineKey }
  | { kind: 'unpriced' } | { kind: 'cancelled' } | { kind: 'archived' }
  | { kind: 'month'; key: string }
  | { kind: 'group'; key: string; route?: Route }
  | { kind: 'group-unpriced'; key: string }

const num = (r: DrillRow, k: string): number | null => {
  const v = r[k]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** "no price", "no delivered N yet" … never $0 for a price nobody entered. */
function priceText(r: DrillRow): string {
  const v = num(r, 'revenue')
  if (v != null) return money(v)
  if (r.priced === false) return 'no price'
  if (r.revenueReason === 'no-n-actual') return 'no delivered N yet'
  if (r.revenueReason === 'no-cap') return 'no N target'
  return '—'
}

const COL = {
  account: { key: 'account', header: 'Account', tip: 'The client account, old name variants rolled together.', value: (r: DrillRow) => String(r.account ?? '—') },
  route: { key: 'route', header: 'Route', tip: 'How the study was actually fielded, read from its cost records.', value: (r: DrillRow) => ROUTE_WORD[(r.route as Route) ?? 'none'] ?? '—' },
  rate: { key: 'rate', header: 'Price per N', tip: "The study's price per respondent. A real $0 counts as a price.", num: true, value: (r: DrillRow) => { const v = num(r, 'rate'); return v == null ? 'no price' : money(v) } },
  billedN: { key: 'billedN', header: 'Billed N', tip: 'Respondents we can bill: delivered after QA, never more than the N sold.', num: true, value: (r: DrillRow) => fmtNum(num(r, 'billedN')) },
  price: { key: 'price', header: 'Client price', tip: 'Price per N × billed N.', num: true, value: priceText },
  cost: { key: 'cost', header: 'Our cost', tip: 'Recorded field cost, net of rewards recovered. No salaries or overhead.', num: true, value: (r: DrillRow) => money(num(r, 'cost') ?? 0) },
  kept: { key: 'margin', header: 'We keep', tip: 'Client price minus our cost, before salaries and overhead.', num: true, value: (r: DrillRow) => { const v = num(r, 'margin'); return v == null ? '—' : money(v) } },
  keptPct: { key: 'marginPct', header: 'Kept %', tip: 'We keep ÷ client price. Studies given away at $0 have no percentage: $0 never divides.', num: true, value: (r: DrillRow) => r.free ? 'given away' : pctText(num(r, 'marginPct')) },
  perPrice: { key: 'spendPerPrice', header: 'Spend ÷ price', tip: 'Cents of our cost per $1 of client price. $0 prices read "given away" and never divide.', num: true, value: (r: DrillRow) => r.free ? 'given away' : r.priced === false ? 'no price' : centsText(num(r, 'spendPerPrice')) },
  budget: { key: 'budget', header: 'Budget', tip: 'The most we planned to spend: a cost ceiling, never revenue.', num: true, value: (r: DrillRow) => { const v = num(r, 'budget'); return v == null ? '—' : money(v) } },
  perBudget: { key: 'spendPerBudget', header: 'Spend ÷ budget', tip: 'Our cost as a share of the budget. Over 100% went over budget, which is not the same as losing money.', num: true, value: (r: DrillRow) => pctText(num(r, 'spendPerBudget')) },
  budgetPerPrice: { key: 'budgetPerPrice', header: 'Budget ÷ price', tip: `Cents of budget per $1 of client price. The goal is about ${goalCostWords()}.`, num: true, value: (r: DrillRow) => r.free ? 'given away' : r.priced === false ? 'no price' : centsText(num(r, 'budgetPerPrice')) },
  inMedian: { key: 'inMedian', header: 'In the median', tip: 'Counted in "Budget set at": in the margin set, with a budget and a price above $0.', value: (r: DrillRow) => (r.inMedian ? 'Yes' : 'No') },
} satisfies Record<string, DrillColumn>

const ledgerRow = (l: LedgerRow, contribution: number): DrillRow =>
  ({ ...l, margin: l.kept, marginPct: l.keptPct, contribution })

/** Ids with non-zero spend on one cost line, and that line's total, summed
 *  straight off the raw child rows — never through spendOf — so a line drill
 *  built survey by survey from spendOf has something independent to meet. */
export function rawLineOfIds(
  ids: Iterable<string>, line: CostLineKey, raw: ResultsInput['load']['raw'],
): { total: number; ids: string[]; byId: Map<string, number> } {
  const set = new Set(ids)
  const by = new Map<string, number>()
  const add = (id: string, v: number) => { if (v !== 0) by.set(id, (by.get(id) ?? 0) + v) }
  const want = (k: CostLineKey) => line === 'total' || line === k
  for (const b of raw.blasts) {
    if (!set.has(b.project_id)) continue
    if (want('rewardsGross')) add(b.project_id, Number(b.bid ?? 0) * Number(b.completes ?? 0))
    if (want('sends') && b.channel !== 'email') add(b.project_id, Number(b.people ?? 0) * Number(b.cost_per_send ?? 0))
  }
  if (want('panel')) {
    for (const s of raw.suppliers) if (set.has(s.project_id)) add(s.project_id, Number(s.cpi ?? 0) * Number(s.n_collected ?? 0))
  }
  for (const c of raw.costs) {
    if (!set.has(c.project_id)) continue
    const credit = isCredit(c)
    if ((credit && want('recovered')) || (!credit && want('other'))) add(c.project_id, Number(c.amount ?? 0))
  }
  const kept = [...by.entries()].filter(([, v]) => Math.abs(v) > EPS)
  return { total: kept.reduce((s, [, v]) => s + v, 0), ids: kept.map(([id]) => id), byId: new Map(kept) }
}

const MARGIN_WORDS = 'the margin set: delivered, priced (a real $0 included), with a delivered N and an N target, and a recorded cost'

/**
 * The drill behind one figure. Rows come from the per-survey P&L; the
 * expected total and ids from a different function every time.
 */
export function resultsDrill(input: ResultsInput, model: ResultsModel, req: ResultsDrillRequest): DrillSpec {
  const raw = input.load.raw
  const chip = model.scope.chip
  const byId = new Map(model.ledger.map(l => [l.id, l]))
  const inMargin = model.ledger.filter(l => l.inMargin)
  const rowsOf = (ids: string[]) => ids.map(id => byId.get(id)).filter((l): l is LedgerRow => l != null)
  const projects = input.population.map(it => it.p)

  switch (req.kind) {
    case 'price':
      return {
        key: 'results-price', title: 'Client price, study by study',
        population: `${chip}. Only ${MARGIN_WORDS}.`,
        columns: [COL.account, COL.route, COL.rate, COL.billedN, COL.price, COL.cost],
        rows: [...inMargin].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0)).map(l => ledgerRow(l, l.revenue ?? 0)),
        expectedTotal: model.tile1.clientPrice, expectedIds: model.tile1.ids,
        totalLabel: 'Client price (from the margin total)', format: 'money',
      }
    case 'cost':
      return {
        key: 'results-cost', title: 'Our cost on the same studies',
        population: `${chip}. Only ${MARGIN_WORDS}.`,
        columns: [COL.account, COL.route, COL.price, COL.cost, COL.perPrice],
        rows: [...inMargin].sort((a, b) => b.cost - a.cost).map(l => ledgerRow(l, l.cost)),
        // Summed off the raw blast, panel and cost rows, not survey by survey.
        expectedTotal: spendOfIds(model.tile1.ids, raw.blasts, raw.suppliers, raw.costs),
        expectedIds: model.tile1.ids,
        totalLabel: 'Our cost (summed from the raw cost records)', format: 'money',
      }
    case 'kept':
      return {
        key: 'results-kept', title: 'What we keep, worst first',
        population: `${chip}. Only ${MARGIN_WORDS}. A study given away at $0 shows its whole cost as a loss.`,
        columns: [COL.account, COL.route, COL.price, COL.cost, COL.kept, COL.keptPct],
        rows: marginRows(model.pnl),
        expectedTotal: model.tile1.kept, expectedIds: model.tile1.ids,
        totalLabel: 'We keep (from the margin total)', format: 'money',
      }
    case 'budget': {
      // The ids straight off the survey records, not off the ledger.
      const ids = projects.filter(p => Number(p.budget ?? 0) > 0).map(p => p.id)
      return {
        key: 'results-budget', title: 'Every delivered study with a budget',
        population: `${chip}. Every delivered study in view that carries a budget. The median in "Budget set at" uses the ones in the margin set priced above $0.`,
        columns: [COL.account, COL.budget, COL.cost, COL.perBudget, COL.price, COL.perPrice, COL.budgetPerPrice, COL.inMedian],
        rows: model.ledger.filter(l => l.budget != null)
          .sort((a, b) => (b.spendPerBudget ?? -1) - (a.spendPerBudget ?? -1))
          .map(l => ledgerRow(l, l.cost)),
        expectedTotal: spendOfIds(ids, raw.blasts, raw.suppliers, raw.costs),
        expectedIds: ids,
        totalLabel: 'Spend on these studies (summed from the raw cost records)', format: 'money',
      }
    }
    case 'line': {
      const line = model.waterfall.lines.find(l => l.key === req.line)
      const ids = projects.map(p => p.id)
      const rawLine = rawLineOfIds(ids, req.line, raw)
      const rows = projects
        .map(p => ({ p, v: lineOf(spendOf(p, raw.blasts, raw.suppliers, raw.costs, input.ix), req.line) }))
        .filter(x => Math.abs(x.v) > EPS)
        .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
        .map(x => {
          const l = byId.get(x.p.id) as LedgerRow
          return { ...ledgerRow(l, x.v), line: x.v }
        })
      return {
        key: `results-line-${req.line}`, title: `${line?.label ?? 'Spend'}, study by study`,
        population: `${chip}. Every delivered study in view with an amount on this line. ${line?.help ?? ''}`.trim(),
        columns: [COL.account, COL.route, {
          key: 'line', header: line?.label ?? 'Amount', tip: line?.help, num: true,
          value: (r: DrillRow) => money(num(r, 'line') ?? 0),
        }, COL.cost],
        rows,
        expectedTotal: rawLine.total, expectedIds: rawLine.ids,
        totalLabel: `${line?.label ?? 'Spend'} (summed from the raw cost records)`, format: 'money',
      }
    }
    case 'unpriced': {
      // The ids off the survey records and the raw cost rows; the total from
      // marginOf. Neither comes from the P&L rows listed.
      const ids = projects.filter(p => !hasPrice(p, raw.rates.get(p.id))).map(p => p.id)
      const spent = rawLineOfIds(ids, 'total', raw)
      const positive = spent.ids.filter(id => (spent.byId.get(id) ?? 0) > 0)
      return {
        key: 'results-unpriced', title: 'Delivered spend with no client price',
        population: `${chip}. Delivered studies that spent money and carry no client price, so no margin figure can see them. Price them on the project page.`,
        columns: [COL.account, COL.route, COL.cost],
        rows: unpricedRows(model.pnl),
        expectedTotal: model.coverage.noPrice.spend, expectedIds: positive,
        totalLabel: 'Spend with no price (from the margin total)', format: 'money',
      }
    }
    case 'cancelled':
    case 'archived': {
      const bucket = model.notIn[req.kind]
      const all = populationByRule(input.items, outsideRule(req.kind), input.filter, input.today).map(it => it.p)
      const byP = new Map(all.map(p => [p.id, p]))
      const accounts = new Map(raw.accounts.map(a => [a.id, a.name ?? '(unnamed)']))
      const pnl = surveyPnl(bucket.ids.map(id => byP.get(id) as FinProject), raw.rates, raw.blasts, raw.suppliers, raw.costs, accounts)
      const expected = rawLineOfIds(all.map(p => p.id), 'total', raw)
      return {
        key: `results-${req.kind}`,
        title: req.kind === 'cancelled' ? 'Spend on cancelled studies' : 'Spend on studies archived without delivery',
        population: `${req.kind === 'cancelled' ? 'Cancelled before delivery' : 'Archived without delivery'} · any date · the same account and route as the page. None of this is in the Results figures.`,
        columns: [COL.account, COL.route, COL.cost],
        rows: pnl.map(s => ({ id: s.id, code: s.code, account: s.account, route: s.route, cost: s.cost, contribution: s.cost }))
          .sort((a, b) => b.contribution - a.contribution),
        expectedTotal: expected.total, expectedIds: expected.ids,
        totalLabel: 'Spend (summed from the raw cost records)', format: 'money',
      }
    }
    case 'month': {
      const m = model.months.find(x => x.key === req.key)
      const ids = m?.ids ?? []
      return {
        key: `results-month-${req.key}`, title: `${monthLabel(req.key)}: delivered studies`,
        population: `${chip} · ${monthLabel(req.key)}. Every delivered study placed in the month; client price and kept only where the study is in the margin set.`,
        columns: [COL.account, COL.route, COL.price, COL.cost, COL.kept, COL.keptPct],
        rows: rowsOf(ids).sort((a, b) => b.cost - a.cost).map(l => ledgerRow(l, l.cost)),
        // The month table's own spend for the month.
        expectedTotal: m?.spend ?? 0, expectedIds: ids,
        totalLabel: `Spend in ${monthLabel(req.key)} (from the month table)`, format: 'money',
      }
    }
    case 'group':
    case 'group-unpriced': {
      const g = model.tile2.rows.find(r => r.key === req.key)
      const members = new Set(g?.memberIds ?? [])
      const route = req.kind === 'group' ? req.route : undefined
      const scoped = input.population.filter(it => members.has(it.p.id) && (!route || it.route === route)).map(it => it.p)
      const pnl = model.pnl.filter(s => members.has(s.id) && (!route || s.route === route))
      const label = `${g?.label ?? 'Group'}${g?.sub ? ` (${g.sub})` : ''}${route ? ` · ${ROUTE_WORD[route]}` : ''}`
      if (req.kind === 'group') {
        const m = marginOf(scoped, raw.rates, raw.blasts, raw.suppliers, raw.costs)
        return {
          key: `results-group-${req.key}${route ? `-${route}` : ''}`, title: `${label}: what we keep, worst first`,
          population: `${chip} · ${label}. Only ${MARGIN_WORDS}.`,
          columns: [COL.account, COL.route, COL.price, COL.cost, COL.kept, COL.keptPct],
          rows: marginRows(pnl),
          expectedTotal: m.margin, expectedIds: m.ids,
          totalLabel: 'We keep (from the margin total)', format: 'money',
        }
      }
      const ids = scoped.filter(p => !hasPrice(p, raw.rates.get(p.id))).map(p => p.id)
      const spent = rawLineOfIds(ids, 'total', raw)
      const positive = spent.ids.filter(id => (spent.byId.get(id) ?? 0) > 0)
      return {
        key: `results-group-unpriced-${req.key}`, title: `${label}: spend with no client price`,
        population: `${chip} · ${label}. Delivered studies that spent money and carry no client price.`,
        columns: [COL.account, COL.route, COL.cost],
        rows: unpricedRows(pnl),
        expectedTotal: spendOfIds(positive, raw.blasts, raw.suppliers, raw.costs), expectedIds: positive,
        totalLabel: 'Spend with no price (summed from the raw cost records)', format: 'money',
      }
    }
  }
}

/* ── Export ───────────────────────────────────────────────────────────────── */

/** The shape the shell's "Export what you see" writes (components/finance/tabs/types.ts FinanceExport). */
export interface ResultsExport {
  name: string
  columns: { key: string; header: string }[]
  rows: Record<string, string | number | null>[]
}

export const RESULTS_EXPORT_COLUMNS: { key: string; header: string }[] = [
  { key: 'code', header: 'Study' },
  { key: 'name', header: 'Study name' },
  { key: 'account', header: 'Account' },
  { key: 'route', header: 'Route (as fielded)' },
  { key: 'date', header: 'Placed on (deliver, else launch, else submitted date)' },
  { key: 'rate', header: 'Price per N' },
  { key: 'billed_n', header: 'Billed N' },
  { key: 'client_price', header: 'Client price' },
  { key: 'our_cost', header: 'Our cost' },
  { key: 'we_keep', header: 'We keep' },
  { key: 'kept_pct', header: 'Kept (%)' },
  { key: 'budget', header: 'Budget' },
  { key: 'spend_per_budget_pct', header: 'Spend ÷ budget (%)' },
  { key: 'spend_per_price_cents', header: 'Spend ÷ price (cents per $1)' },
  { key: 'budget_per_price_cents', header: 'Budget ÷ price (cents per $1)' },
  { key: 'price_per_billed_n', header: 'Price per billed N' },
  { key: 'cost_per_billed_n', header: 'Cost per billed N' },
  { key: 'tags', header: 'Tags' },
]

const c2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100)
const p1 = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 10)

/** The rows behind Tile 1: the margin-set surveys, with every ledger column. */
export function resultsExport(model: ResultsModel): ResultsExport {
  return {
    name: 'finance-results-surveys',
    columns: RESULTS_EXPORT_COLUMNS,
    rows: model.ledger.filter(l => l.inMargin).map(l => ({
      code: l.code,
      name: l.name,
      account: l.account,
      route: ROUTE_WORD[l.route],
      date: l.date,
      rate: c2(l.rate),
      billed_n: l.billedN,
      client_price: c2(l.revenue),
      our_cost: c2(l.cost),
      we_keep: c2(l.kept),
      kept_pct: l.free ? 'given away' : p1(l.keptPct),
      budget: c2(l.budget),
      spend_per_budget_pct: p1(l.spendPerBudget),
      spend_per_price_cents: l.free ? 'given away' : p1(l.spendPerPrice),
      budget_per_price_cents: l.free ? 'given away' : p1(l.budgetPerPrice),
      price_per_billed_n: c2(l.pricePerBilledN),
      cost_per_billed_n: c2(l.costPerBilledN),
      tags: l.tags.map(x => TAG_LABEL[x]).join('; '),
    })),
  }
}

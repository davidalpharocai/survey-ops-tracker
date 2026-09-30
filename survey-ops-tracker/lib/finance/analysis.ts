/**
 * The analytical layer: the questions the cost report could not answer.
 *
 * `hub.ts` answers "what did this cost and what did it earn". This file answers
 * the four an FP&A director asks next — what is unresolved right now, what is a
 * unit worth, what is out of line, and what happened over time.
 *
 * ── THREE RULES EVERYTHING HERE OBEYS ───────────────────────────────────────
 * 1. Every aggregate returns the IDS it summed. A drill-down that re-derives
 *    its own population will eventually disagree with its headline, and a table
 *    that disagrees with its headline is worse than no table.
 * 2. Gross, never netted. Surveys that blew their budget and surveys that came
 *    in under are reported side by side and never summed: nobody can spend the
 *    headroom on one survey to pay for the overrun on another.
 * 3. One classifier (lib/finance/lifecycle.ts) and one revenue function
 *    (lib/finance/revenue.ts). Nothing in this file decides for itself whether
 *    a survey is live, or what it earned.
 */

import {
  buildIndex, finDate, isCredit, routeOf, spendOf,
  type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier,
  type Leg, type Route,
} from './hub'
// One-way: cpqr.ts imports only from hub.ts and revenue.ts, so this cannot cycle.
import { contributingLegs } from './cpqr'
// One-way too: coverage.ts never imports this file.
import { RECOVERY_PENDING_BELOW } from './coverage'
import { classOf, type FinClass } from './lifecycle'
import {
  capOf, deliveredNOf, keptPct, KEEP_GOAL, overDeliveredOf, perDollarOfPrice, perRespondentNOf,
  revenueDetail, segmentCheck, segmentPriceDiffers, shortfallOf, surveyLineOf,
  type NSource, type RevenueBlock,
} from './revenue'
import { money, moneyAuto } from './format'
import { fmtNum } from '@/lib/utils/number'

/* ── LIFECYCLE ─────────────────────────────────────────────────────────────
 * The page's lifecycle selector is the classifier's classes, minus the one
 * class that is excluded everywhere (empty placeholders). */

export type Lifecycle = Exclude<FinClass, 'placeholder'> | 'all'

/** The selectable classes, in display order. */
export const LIFECYCLES: Exclude<Lifecycle, 'all'>[] = [
  'delivered', 'active', 'hold', 'cancelled', 'archived', 'scoping',
]

/**
 * Read a `?lifecycle=` value. Unknown values fall back to the default instead
 * of silently emptying the page, and the two ids written before the classifier
 * existed (`inflight`, `abandoned`) keep working in bookmarks.
 */
export function parseLifecycle(v: string | null | undefined, fallback: Lifecycle = 'delivered'): Lifecycle {
  if (!v) return fallback
  if (v === 'inflight') return 'active'
  if (v === 'abandoned') return 'archived'
  if (v === 'all' || (LIFECYCLES as string[]).includes(v)) return v as Lifecycle
  return fallback
}

export const inLifecycle = (c: FinClass, l: Lifecycle) =>
  c !== 'placeholder' && (l === 'all' || c === l)

export interface LifecycleCount { key: Exclude<Lifecycle, 'all'>; surveys: number; spend: number; n: number }

export function lifecycleCounts(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): LifecycleCount[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const acc = new Map<string, LifecycleCount>()
  for (const k of LIFECYCLES) acc.set(k, { key: k, surveys: 0, spend: 0, n: 0 })
  for (const p of rows) {
    const e = acc.get(classOf(p, ix))
    if (!e) continue // an empty placeholder, which counts nowhere
    e.surveys++
    e.spend += spendOf(p, blasts, suppliers, costs, ix).total
    e.n += Number(p.n_collected ?? 0)
  }
  return [...acc.values()]
}

/* ── BUDGET VARIANCE ───────────────────────────────────────────────────────
 * `survey_projects.budget` is a COST CEILING — the most we intend to spend —
 * and NOT client revenue (David, 2026-08-24). The only meaningful comparison
 * runs actual spend against it. Going over it is NOT the same as losing money,
 * and the two never share a badge (see `exceptions`). */

export interface Breach {
  id: string
  code: string | null
  name: string | null
  account: string
  route: Route
  lifecycle: FinClass
  board: string | null
  budget: number
  spend: number
  over: number
  pct: number
  target: number | null
  collected: number | null
}

export interface BudgetVariance {
  /** Surveys that exceeded their ceiling, and by how much IN TOTAL. Gross. */
  breaches: Breach[]
  overrun: number
  /** Surveys that came in under, and the unused room. Reported beside the
   *  overrun and never subtracted from it: headroom on one survey cannot pay
   *  for an overrun on another, and netting them reports ~$0 and hides both. */
  underSurveys: number
  headroom: number
  /** Surveys carrying BOTH a ceiling and a recorded cost — the only ones this
   *  can speak about. */
  measurable: number
  /** Carrying a ceiling but no recorded cost, so unmeasurable rather than fine. */
  noCost: number
  ids: string[]
}

export function budgetVariance(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string> = new Map(),
): BudgetVariance {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: BudgetVariance = {
    breaches: [], overrun: 0, underSurveys: 0, headroom: 0,
    measurable: 0, noCost: 0, ids: [],
  }
  for (const p of rows) {
    const cls = classOf(p, ix)
    if (cls === 'placeholder') continue
    const budget = Number(p.budget ?? 0)
    if (!(budget > 0)) continue
    const spend = spendOf(p, blasts, suppliers, costs, ix).total
    if (spend <= 0) { out.noCost++; continue }
    out.measurable++
    if (spend > budget) {
      const over = spend - budget
      out.overrun += over
      out.ids.push(p.id)
      out.breaches.push({
        id: p.id, code: p.project_code, name: p.project_name,
        account: (p.client_id && accounts.get(p.client_id)) || p.client || '(no account)',
        route: routeOf(p, blasts, suppliers, ix),
        lifecycle: cls, board: p.board_column,
        budget, spend, over, pct: spend / budget,
        target: p.n_target == null ? null : Number(p.n_target),
        collected: p.n_collected == null ? null : Number(p.n_collected),
      })
    } else {
      out.underSurveys++
      out.headroom += budget - spend
    }
  }
  out.breaches.sort((a, b) => b.pct - a.pct)
  return out
}

/* ── LIVE EXPOSURE ─────────────────────────────────────────────────────────
 * The only band on the page that changes an action TODAY: money still moving.
 * A live survey that has already blown its ceiling or blown past its target is
 * spending money right now that nobody has approved. Live means the ACTIVE
 * class only — a survey on hold is not spending, and it has its own bucket
 * (`holds` below) so it is never counted as live. */

export interface Exposure {
  id: string
  code: string | null
  name: string | null
  account: string
  board: string | null
  route: Route
  spend: number
  budget: number | null
  target: number | null
  collected: number | null
  /** Completes already bought beyond target — unbillable the moment they land. */
  overTargetN: number
  overTargetCost: number
  reasons: string[]
}

/**
 * `canViewFinancials` is REQUIRED, not defaulted, like the export's: the budget
 * is finance-only, and a reason such as "140% of its ceiling" printed beside the
 * spend gives the budget away (spend ÷ 1.4). For a reader without the
 * capability the budget plays no part at all — it adds no reason, admits no
 * survey (a survey on the list only for its overrun would itself reveal the
 * breach), sets no order, and is not carried on the row.
 */
export function liveExposure(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string>, opts: { canViewFinancials: boolean },
): Exposure[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: Exposure[] = []
  for (const p of rows) {
    if (classOf(p, ix) !== 'active') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0) continue
    const budget = !opts.canViewFinancials || p.budget == null ? null : Number(p.budget)
    const target = p.n_target == null ? null : Number(p.n_target)
    const collected = p.n_collected == null ? null : Number(p.n_collected)
    const reasons: string[] = []
    if (budget != null && budget > 0 && sp.total > budget) {
      reasons.push(`${Math.round((sp.total / budget) * 100)}% of its ceiling`)
    }
    const overN = target != null && target > 0 && collected != null
      ? Math.max(0, collected - target) : 0
    if (overN > 0) reasons.push(`${overN.toLocaleString('en-US')} completes past target`)
    if (!reasons.length) continue
    const rate = sp.paidCompletes > 0 ? sp.total / sp.paidCompletes : 0
    out.push({
      id: p.id, code: p.project_code, name: p.project_name,
      account: (p.client_id && accounts.get(p.client_id)) || p.client || '(no account)',
      board: p.board_column, route: routeOf(p, blasts, suppliers, ix),
      spend: sp.total, budget, target, collected,
      overTargetN: overN, overTargetCost: overN * rate, reasons,
    })
  }
  // Worst exposure first: money already past a ceiling, then N past target.
  return out.sort((a, b) =>
    (b.spend - (b.budget ?? b.spend)) - (a.spend - (a.budget ?? a.spend)) ||
    b.overTargetCost - a.overTargetCost)
}

/* ── HOLDS ─────────────────────────────────────────────────────────────────
 * David, 2026-09-24: "give it its own bucket and keep out of live totals. im
 * trying to minimize # of holds." So holds are counted and shown, each with a
 * "resume or cancel" decision, and never added to anything live. */

export interface Holds {
  surveys: number
  /** Money already spent on held surveys — real, and not moving. */
  spend: number
  collected: number
  ids: string[]
}

export function holds(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Holds {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: Holds = { surveys: 0, spend: 0, collected: 0, ids: [] }
  for (const p of rows) {
    if (classOf(p, ix) !== 'hold') continue
    out.surveys++
    out.spend += spendOf(p, blasts, suppliers, costs, ix).total
    out.collected += Number(p.n_collected ?? 0)
    out.ids.push(p.id)
  }
  return out
}

/* ── PER-SURVEY P&L ────────────────────────────────────────────────────────
 * The row every other band drills into. */

export interface SurveyPnl {
  id: string
  code: string | null
  name: string | null
  account: string
  accountId: string | null
  route: Route
  /** The classifier's class. Named `lifecycle` for the callers that predate
   *  it; `cls` is the same value. */
  lifecycle: FinClass
  cls: FinClass
  date: string | null
  /** The survey's price per N — the one rate the invoice uses — a real $0
   *  included. null = no price recorded. */
  rate: number | null
  /** The survey carries a price (a real $0 counts). */
  priced: boolean
  /** Priced at exactly $0 — work given away on purpose. */
  free: boolean
  /** revenue > 0: the only surveys any per-survey ratio may use. */
  ratioEligible: boolean
  /** Why `revenue` is null, when it is. */
  revenueReason: RevenueBlock
  target: number | null
  /** The top of the sold range — the cap on billed N. */
  cap: number | null
  /** The survey's delivered N (post-QA) — revenue.ts deliveredNOf, the figure
   *  the bill uses. Its own n_actual, or the segments' sum when that is blank
   *  and every segment has one (`actualSource` says which). */
  actual: number | null
  actualSource: NSource | null
  collected: number | null
  /** min(delivered, top of the sold range), on the survey. Named billableN for
   *  existing callers; it is the billed N of lib/finance/revenue.ts. */
  billableN: number | null
  revenue: number | null
  cost: number
  /** Recovered rewards inside `cost` (≤ 0). */
  recovered: number
  paidCompletes: number
  /** revenue − cost. For a $0 survey that is −cost: the real cost of giving it
   *  away. null when revenue is unknown. */
  margin: number | null
  /** Kept % — null unless the price is above $0. */
  marginPct: number | null
  /** cost ÷ revenue and budget ÷ revenue ("cents per $1 of price"), only where
   *  the price is above $0. */
  spendPerPrice: number | null
  budgetPerPrice: number | null
  /** The cost ceiling. Finance-only — the page decides whether to show it. */
  budget: number | null
  /** Delivered, priced, counted, capped, costed: in every margin figure. */
  inMargin: boolean
  cpc: number | null
  /** cost ÷ the delivered N — null when the survey's N actual is only a
   *  partial segment roll-up (`partialRollUp`), because the cost covers every
   *  segment and that N does not. */
  cpqr: number | null
  /** Do the recorded completes cover the N this survey claims? Everything
   *  derived from a survey where this is false is suspect, and the drill-down
   *  shows it as a column rather than silently dropping the row. */
  reconciled: boolean
  /** DATA NOTES, never a reason to change a figure (David, 2026-09-27: the
   *  bill is the survey's). `segmentsDisagree`: the segments' N actuals do not
   *  add up to the survey's — `segmentsMissingN` of `segments` have no count,
   *  or they sum to `segmentSum`. `segmentPriceDiffers`: a segment carries a
   *  price that is not the survey's rate (the invoice uses one rate). */
  segmentsDisagree: boolean
  segmentsMissingN: number
  segments: number
  segmentSum: number | null
  segmentPriceDiffers: boolean
  /** The survey's N actual is only the roll-up of the segments that have a
   *  count (revenue.ts segmentCheck). The bill on this row still reads it; the
   *  per-respondent figures — `cpqr`, scrub, over-delivery at cost, the month
   *  table's cost per N — leave the survey out and say so. */
  partialRollUp: boolean
  /** N short of the N sold, on the survey, and its value at the client's own
   *  price — the per-survey half of foregone(). shortValue is null when the
   *  survey has no price or its shortfall cannot be measured. */
  shortN: number
  shortValue: number | null
  /** N delivered above the survey's sold range (revenue.ts overDeliveredOf) —
   *  the part of `actual` that `billableN` leaves out, so billableN + overN =
   *  actual on every row that has both. null when there is no delivered N. */
  overN: number | null
  /**
   * 117: the route legs this survey contributes to CPQR — empty when it
   * contributes nothing.
   *
   * Carried on the row rather than recomputed in drills.ts because a mixed
   * survey reaches the CPQR card with only PART of its cost on each side, and
   * `cost` is still the whole bill. A drill strip that summed `cost` for a
   * mixed survey would over-report its panel contribution and trip the panel's
   * own reconciliation check. Filled by contributingLegs, the same predicate
   * the card uses.
   */
  cpqrLegs: Leg[]
}

export function surveyPnl(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string> = new Map(),
): SurveyPnl[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: SurveyPnl[] = []
  for (const p of rows) {
    const cls = classOf(p, ix)
    if (cls === 'placeholder') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    const rv = revenueDetail(p, rates.get(p.id))
    const target = p.n_target == null ? null : Number(p.n_target)
    // The delivered N the bill uses, so every N on this row — billed, over,
    // short — reads the same figure as the revenue beside it. CPQR reads it too,
    // except on a partial segment roll-up (`qualified` below).
    const delivered = deliveredNOf(p)
    const actual = delivered.n
    // The same N, unless it is a partial segment roll-up: then null, and no
    // per-respondent figure on this row divides by it (revenue.ts).
    const qualified = perRespondentNOf(p)
    const collected = p.n_collected == null ? null : Number(p.n_collected)
    const seg = segmentCheck(p)
    const budget = p.budget == null ? null : Number(p.budget)
    const margin = rv.revenue == null ? null : rv.revenue - sp.total
    const short = shortfallOf(p, rates.get(p.id))
    out.push({
      id: p.id, code: p.project_code, name: p.project_name,
      account: (p.client_id && accounts.get(p.client_id)) || p.client || '(no account)',
      accountId: p.client_id,
      route: routeOf(p, blasts, suppliers, ix),
      lifecycle: cls, cls, date: finDate(p),
      rate: rv.rate,
      priced: rv.priced,
      free: rv.free,
      ratioEligible: rv.ratioEligible,
      revenueReason: rv.reason,
      target,
      cap: capOf({ nMin: target, nMax: p.n_target_max == null ? null : Number(p.n_target_max) }),
      actual, actualSource: delivered.source, collected,
      billableN: rv.billedN,
      revenue: rv.revenue,
      cost: sp.total, recovered: sp.recovered, paidCompletes: sp.paidCompletes,
      margin,
      marginPct: keptPct(rv.revenue, sp.total),
      spendPerPrice: perDollarOfPrice(sp.total, rv.revenue),
      budgetPerPrice: budget != null && budget > 0 ? perDollarOfPrice(budget, rv.revenue) : null,
      budget,
      inMargin: cls === 'delivered' && rv.revenue != null && sp.total > 0,
      cpc: sp.paidCompletes > 0 && sp.total > 0 ? sp.total / sp.paidCompletes : null,
      // The survey's own N actual is the denominator even when its segments do
      // not add up — a typed figure states the whole survey, and the row carries
      // the note (segmentsDisagree) so a reader checks the count. The one
      // exception is a partial roll-up (PR00231): all of the cost over part of
      // the N is not a price per respondent, so there is no rate.
      cpqr: qualified != null && qualified > 0 && sp.total > 0 ? sp.total / qualified : null,
      reconciled: collected != null && collected > 0 && sp.paidCompletes >= collected,
      segmentsDisagree: seg.disagree,
      segmentsMissingN: seg.missing,
      segments: seg.segments,
      segmentSum: seg.segmentSum,
      segmentPriceDiffers: segmentPriceDiffers(p, rates.get(p.id)),
      partialRollUp: seg.partialRollUp,
      shortN: short?.n ?? 0,
      shortValue: short && short.n > 0 ? short.dollars : null,
      overN: overDeliveredOf(p),
      cpqrLegs: contributingLegs(p, blasts, suppliers, costs, ix).legs,
    })
  }
  return out
}

/* ── BUDGET AGAINST PRICE ──────────────────────────────────────────────────
 * Everything read against the client's price, in cents per $1. The goal is
 * KEEP_GOAL (50%) — a GUIDE, not a rule (David, 2026-09-24): a budget at or
 * under half the price, and spend at or under half the price, is "a great
 * place". Going over the budget and losing money are different events. */

export interface BudgetVsPrice {
  /** Margin-set surveys priced above $0 that carry a budget. */
  n: number
  /** Median budget ÷ client price across them. */
  medianPerDollar: number | null
  /** How many were budgeted at or under the goal share of price. */
  atOrUnderGoal: number
  /** Of the margin set with a budget, how many spent past it — and how many of
   *  those still made money, which is why the two badges are never merged. */
  overBudget: number
  overBudgetMadeMoney: number
  /** Margin-set surveys priced above $0, and how many spent more than the goal
   *  share of their price. */
  pricedAboveZero: number
  spentOverGoal: number
  ids: string[]
}

/** The true median: the middle value, or the mean of the two middle values
 *  when the count is even. The card says "median", so it must be one — the
 *  nearest-rank shortcut returned the UPPER middle value (on 2026-09-27 it
 *  printed 69¢ where the median of the 20 budgets in view was 68¢). */
const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function budgetVsPrice(pnl: SurveyPnl[]): BudgetVsPrice {
  const per: number[] = []
  const out: BudgetVsPrice = {
    n: 0, medianPerDollar: null, atOrUnderGoal: 0, overBudget: 0, overBudgetMadeMoney: 0,
    pricedAboveZero: 0, spentOverGoal: 0, ids: [],
  }
  for (const s of pnl) {
    if (!s.inMargin) continue
    if (s.ratioEligible) {
      out.pricedAboveZero++
      if ((s.spendPerPrice ?? 0) > 1 - KEEP_GOAL) out.spentOverGoal++
    }
    if (s.budget == null || !(s.budget > 0)) continue
    if (s.cost > s.budget) {
      out.overBudget++
      if ((s.margin ?? 0) > 0) out.overBudgetMadeMoney++
    }
    if (s.budgetPerPrice == null) continue
    out.n++
    out.ids.push(s.id)
    per.push(s.budgetPerPrice)
    if (s.budgetPerPrice <= 1 - KEEP_GOAL) out.atOrUnderGoal++
  }
  out.medianPerDollar = median(per)
  return out
}

/* ── ACCOUNT P&L ───────────────────────────────────────────────────────────
 * What an account pays against what it costs, per BILLED respondent on both
 * sides. The old table put price per billed N beside cost per PAID complete;
 * paid completes run 1.1–1.9× billed N (scrub and over-delivery), so reading
 * across a row overstated margin by 8–32 points against the Margin column
 * beside it. On one denominator, price − cost IS what we keep per respondent.
 *
 * And it is split by ROUTE. A $3 panel price averaged with a $150 blast price
 * is a number about the mix, not about the client: blended, BAM ranked as the
 * best payer; on blast work alone it pays less than DE Shaw for work that costs
 * the same. An account with more than one route prints its per-respondent
 * figures only on the route rows, never on the blended row. */

export interface AccountRow {
  /** Surveys contributing to revenue and cost — the margin set. Printed on
   *  every row: a figure from n=2 is not comparable to one from n=14. */
  measured: number
  revenue: number
  cost: number
  margin: number
  marginPct: number | null
  billableN: number
  /** Revenue ÷ billed N: what the account actually pays per respondent. */
  realisedRate: number | null
  /** Cost ÷ billed N — on the SAME denominator as realisedRate, so the two
   *  subtract. */
  costPerBilledN: number | null
  /** Cost ÷ completes PAID for. A buying metric; never read against a price. */
  costPerComplete: number | null
  /** Surveys in the margin set priced at $0. */
  freeSurveys: number
  ids: string[]
}

export interface AccountRouteRow extends AccountRow {
  route: Route
}

export interface AccountPnl extends AccountRow {
  accountId: string | null
  account: string
  surveys: number
  /** Total recorded spend on the account, measured or not. */
  totalSpend: number
  /** Spend on surveys with no price at all — the data-entry worklist. */
  unpricedSpend: number
  /** One row per route the account's margin set was fielded on. When there is
   *  more than one, the blended row's per-respondent figures are null. */
  routes: AccountRouteRow[]
}

const emptyRow = (): AccountRow => ({
  measured: 0, revenue: 0, cost: 0, margin: 0, marginPct: null, billableN: 0,
  realisedRate: null, costPerBilledN: null, costPerComplete: null, freeSurveys: 0, ids: [],
})

function addTo(e: AccountRow & { paid?: number }, s: SurveyPnl) {
  e.measured++
  e.revenue += s.revenue ?? 0
  e.cost += s.cost
  e.billableN += s.billableN ?? 0
  e.paid = (e.paid ?? 0) + s.paidCompletes
  if (s.free) e.freeSurveys++
  e.ids.push(s.id)
}

function finish(e: AccountRow & { paid?: number }) {
  e.margin = e.revenue - e.cost
  e.marginPct = keptPct(e.revenue, e.cost)
  e.realisedRate = e.billableN > 0 ? e.revenue / e.billableN : null
  e.costPerBilledN = e.billableN > 0 ? e.cost / e.billableN : null
  e.costPerComplete = (e.paid ?? 0) > 0 ? e.cost / (e.paid as number) : null
  delete e.paid
}

export function accountPnl(
  pnl: SurveyPnl[], opts: { route?: Route | null } = {},
): AccountPnl[] {
  const by = new Map<string, AccountPnl>()
  const routes = new Map<string, Map<Route, AccountRouteRow>>()
  for (const s of pnl) {
    if (opts.route && s.route !== opts.route) continue
    const key = s.accountId ?? s.account
    let e = by.get(key)
    if (!e) {
      e = {
        ...emptyRow(), accountId: s.accountId, account: s.account, surveys: 0,
        totalSpend: 0, unpricedSpend: 0, routes: [],
      }
      by.set(key, e)
      routes.set(key, new Map())
    }
    e.surveys++
    e.totalSpend += s.cost
    if (!s.priced) e.unpricedSpend += s.cost
    if (!s.inMargin) continue
    addTo(e, s)
    const rm = routes.get(key)!
    let r = rm.get(s.route)
    if (!r) { r = { ...emptyRow(), route: s.route }; rm.set(s.route, r) }
    addTo(r, s)
  }
  const out = [...by.values()]
  for (const e of out) {
    finish(e)
    const rs = [...(routes.get(e.accountId ?? e.account)?.values() ?? [])]
    for (const r of rs) finish(r)
    e.routes = rs.sort((a, b) => b.revenue - a.revenue)
    // A blended per-respondent figure across routes 60× apart describes the mix.
    if (e.routes.length > 1) {
      e.realisedRate = null
      e.costPerBilledN = null
      e.costPerComplete = null
    }
  }
  return out.sort((a, b) => b.totalSpend - a.totalSpend)
}

/* ── THE WORKLIST ──────────────────────────────────────────────────────────
 * David's "guidance and suggestions" ask, answered with rows rather than
 * adjectives. ONE ROW PER SURVEY carrying every badge that applies, ranked by
 * DOLLARS AT STAKE in one unit, each ending in a verb.
 *
 * What the old queue got wrong, and this one does not:
 *   · It sorted dollars-per-respondent (a cost outlier's amount) against total
 *     dollars (losses, overruns), so the largest cost problems sank to the
 *     bottom and were cut off. An outlier's amount is now
 *       (its CPQR − the BOOK median for its route) × its delivered N
 *     — the total it cost above a typical survey.
 *   · It kept one kind per survey, so a loss-maker whose overrun was larger
 *     than its loss showed only as "over budget". Losing money and going over
 *     budget are different events: every badge now shows.
 *   · Its benchmark moved with the filter. The median is the BOOK's (passed in
 *     by the caller, computed on the unfiltered delivered book), with the
 *     slice's own median printed beside it when it differs. */

export type Badge = 'lost-money' | 'given-away' | 'cost-outlier' | 'over-budget' | 'segment-counts'

export const BADGE_LABEL: Record<Badge, string> = {
  'lost-money': 'Lost money',
  'given-away': 'Given away at $0',
  'cost-outlier': 'Cost outlier',
  'over-budget': 'Over budget',
  'segment-counts': 'Segment counts do not add up',
}

export const BADGE_HELP: Record<Badge, string> = {
  'lost-money': 'Our field cost was more than the client price on a study priced above $0.',
  'given-away': 'Priced at $0 on purpose (a trial or internal work). The cost is real; there is no revenue.',
  'cost-outlier': 'Cost per qualified respondent was more than twice the typical study on the same route.',
  'over-budget': 'Spent past its budget. Not the same as losing money: a study can go over budget and still make money.',
  'segment-counts': "The segments' N actuals do not add up to the study's N actual. The bill still uses the study's N actual. When that N only adds up the segments that have a count, the study is left out of cost per respondent and scrub until the missing count is entered.",
}

/** Which badge leads a row when several apply: the most serious first. */
const SEVERITY: Badge[] = ['lost-money', 'given-away', 'cost-outlier', 'over-budget', 'segment-counts']

/** What to do, per lead badge. `live` is for a survey still running. */
function verbFor(b: Badge, live: boolean): string {
  switch (b) {
    case 'lost-money': return 'Re-price the next wave'
    case 'given-away': return 'Confirm the $0 price was meant'
    case 'cost-outlier': return 'Find out why it cost more'
    case 'over-budget': return live ? 'Freeze the bid or stop buying' : 'Set the next budget from this cost'
    case 'segment-counts': return 'Make the segment N actuals add up'
  }
}

/** The segment note in words: which way the counts disagree. */
export function segmentWords(s: Pick<SurveyPnl, 'code' | 'actual' | 'actualSource' | 'segments' | 'segmentsMissingN' | 'segmentSum'>): string {
  if (s.segmentsMissingN > 0) {
    return `${s.code}: ${fmtNum(s.segmentsMissingN)} of ${fmtNum(s.segments)} segments ${s.segmentsMissingN === 1 ? 'has' : 'have'} no N actual`
  }
  return `${s.code}: the segments add up to ${fmtNum(s.segmentSum ?? 0)} N, the study says ${fmtNum(s.actual ?? 0)}`
}

export interface QueueItem { badge: Badge; amount: number; headline: string; detail: string }

export interface Exception {
  id: string
  code: string | null
  account: string
  route: Route
  lifecycle: FinClass
  /** The lead badge. */
  kind: Badge
  badges: Badge[]
  items: QueueItem[]
  /** Dollars at stake: the LARGEST item. Items overlap (a loss and an overrun
   *  on one survey are partly the same dollars), so they are never summed. */
  amount: number
  /** The lead item's words. */
  headline: string
  detail: string
  /** What to do. */
  verb: string
}

export interface QueueMedians {
  /** Median CPQR per route on the whole delivered book — the fixed yardstick. */
  book: Map<Route, number>
  /** The same median on the filtered view, printed beside it when different. */
  slice?: Map<Route, number>
}

const ROUTE_WORD: Record<Route, string> = { blast: 'blast', panel: 'panel', both: 'mixed-route', none: 'unfielded' }

/** Badges that rest on finance-only facts: the client price (lost money, given
 *  away) or the budget (over budget). A reader without the capability never
 *  gets one — not a hidden one, none. */
export const FINANCE_BADGES: Badge[] = ['lost-money', 'given-away', 'over-budget']

/**
 * `canViewFinancials` is REQUIRED, not defaulted. Without it, the worklist is
 * built as though prices and budgets did not exist, so a survey that is on the
 * list only because it went over budget is not on the list at all: its row, its
 * rank, its verb ("Set the next budget from this cost") and the "Showing X of
 * Y" count would each tell an analyst which surveys breached a budget. Hiding
 * the badge while keeping the row was the leak.
 */
export function exceptions(
  pnl: SurveyPnl[], variance: BudgetVariance, medians: QueueMedians | Map<Route, number>,
  opts: { canViewFinancials: boolean },
): Exception[] {
  const finance = opts.canViewFinancials
  const m: QueueMedians = medians instanceof Map ? { book: medians } : medians
  const byId = new Map<string, { s: SurveyPnl | null; base: Omit<Exception, 'kind' | 'badges' | 'items' | 'amount' | 'headline' | 'detail' | 'verb'>; items: QueueItem[] }>()
  const entry = (s: SurveyPnl) => {
    let e = byId.get(s.id)
    if (!e) {
      e = { s, base: { id: s.id, code: s.code, account: s.account, route: s.route, lifecycle: s.lifecycle }, items: [] }
      byId.set(s.id, e)
    }
    return e
  }
  const pnlById = new Map(pnl.map(s => [s.id, s]))

  for (const s of pnl) {
    if (finance && s.lifecycle === 'delivered' && s.margin != null && s.cost > 0) {
      if (s.ratioEligible && s.margin < 0) {
        entry(s).items.push({
          badge: 'lost-money', amount: -s.margin,
          headline: `${s.code} lost ${money(-s.margin)}`,
          detail: `Client price ${money(s.revenue ?? 0)} against ${money(s.cost)} of field cost` +
            (s.rate != null ? ` at ${moneyAuto(s.rate)} per N` : ''),
        })
      } else if (s.free) {
        entry(s).items.push({
          badge: 'given-away', amount: s.cost,
          headline: `${s.code} was given away at $0 — ${money(s.cost)} of field cost`,
          detail: 'Priced at $0. If that was not the plan, record the real price.',
        })
      }
    }
    // A data note, never a block on the bill (David, 2026-09-27: the bill is
    // the survey's). No dollars ride on it — nothing is withheld from revenue —
    // so it ranks below every item that costs money. A partial roll-up says
    // what it costs the reader: the survey is missing from the per-respondent
    // figures until the uncounted segment gets its N actual.
    if (s.lifecycle === 'delivered' && s.segmentsDisagree) {
      entry(s).items.push({
        badge: 'segment-counts', amount: 0,
        headline: segmentWords(s),
        detail: s.partialRollUp
          ? "The bill uses the study's N actual, which only adds up the segments that have one. Cost per respondent and scrub leave this study out until every segment has its N actual."
          : "The bill and every figure here use the study's own N actual. Correct the segments, or the study's N actual, so the two agree.",
      })
    }
    const med = m.book.get(s.route)
    if (s.cpqr != null && s.actual != null && med != null && med > 0 && s.cpqr > med * 2 && s.reconciled) {
      const excess = (s.cpqr - med) * s.actual
      const slice = m.slice?.get(s.route)
      entry(s).items.push({
        badge: 'cost-outlier', amount: excess,
        headline: `${s.code} cost ${money(excess)} more than a typical ${ROUTE_WORD[s.route]} study`,
        detail: `${moneyAuto(s.cpqr)} per qualified respondent against a book median of ${moneyAuto(med)}` +
          ` (${(s.cpqr / med).toFixed(1)}×)` +
          (slice != null && Math.abs(slice - med) >= 0.005 ? `; the median in this view is ${moneyAuto(slice)}` : '') +
          // The rate divides by the survey's N actual. When its segments do not
          // add up to that typed figure, the count is the first thing to check.
          // (A partial roll-up never gets here: it has no rate.)
          (s.segmentsDisagree ? '. Its segment counts do not add up to its N actual, so check the count first' : ''),
      })
    }
  }
  for (const b of finance ? variance.breaches : []) {
    const s = pnlById.get(b.id)
    const e = s ? entry(s) : (() => {
      const x = { s: null, base: { id: b.id, code: b.code, account: b.account, route: b.route, lifecycle: b.lifecycle }, items: [] as QueueItem[] }
      byId.set(b.id, x)
      return x
    })()
    const madeMoney = s?.margin != null && s.margin > 0
    e.items.push({
      badge: 'over-budget', amount: b.over,
      headline: `${b.code} spent ${money(b.over)} past its budget`,
      detail: `${money(b.spend)} against a ${money(b.budget)} budget — ${Math.round(b.pct * 100)}%` +
        (b.lifecycle === 'active' ? `, and it is still live in ${b.board}` : '') +
        (madeMoney ? '. It still made money.' : ''),
    })
  }

  const out: Exception[] = []
  for (const { base, items } of byId.values()) {
    if (!items.length) continue
    const lead = SEVERITY.map(k => items.find(i => i.badge === k)).find(Boolean) as QueueItem
    out.push({
      ...base,
      kind: lead.badge,
      badges: SEVERITY.filter(k => items.some(i => i.badge === k)),
      items: SEVERITY.flatMap(k => items.filter(i => i.badge === k)),
      amount: Math.max(...items.map(i => i.amount)),
      headline: lead.headline,
      detail: lead.detail,
      verb: verbFor(lead.badge, base.lifecycle === 'active'),
    })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/* ── THE TIME DIMENSION ────────────────────────────────────────────────────
 * Cost recording became reliable from June 2026 — the first dated blast is
 * 1 June, and the share of delivered surveys carrying any cost steps up that
 * month. Earlier months show real delivered N against little recorded spend, so
 * a naive monthly cost line reads as growth when it is the ledger filling in.
 * The reliability date is COMPUTED (lib/finance/coverage.ts), not written here.
 *
 * Three traps this avoids:
 *   · Routes are never blended into one $/N. A qualified blast respondent costs
 *     tens of times a panel one, so a month's blended $/N moves with the mix,
 *     not with cost. Every month carries a per-route breakdown.
 *   · Per-unit figures use ONE population: spend and N from surveys that carry
 *     both a cost and a delivered N. A survey with no delivered N used to add
 *     its spend to the numerator and 0 to the denominator. A survey whose N
 *     actual is only a partial segment roll-up is left out of that population
 *     too (it put all of PR00231's cost over one segment's N and read August's
 *     panel cost per N high), and counted in `nPartial`.
 *   · Revenue and spend are never read off different surveys. `margin` on each
 *     period is the MARGIN SET, exactly as marginOf defines it, so the months
 *     (plus Undated) add up to the book. The old `revenue` field covered every
 *     priced survey while spend covered every survey, and subtracting them
 *     printed June at −132%. It is gone. */

export interface RouteSlice {
  surveys: number
  spend: number
  /** Delivered N and spend on delivered surveys carrying both a cost and a
   *  delivered N — the one population a per-unit figure may use. */
  costedN: number
  costedSpend: number
  costPerN: number | null
}

export interface PeriodMargin {
  surveys: number
  revenue: number
  cost: number
  kept: number
  keptPct: number | null
  /** The same without surveys priced at $0 ("on paid work"). */
  paidSurveys: number
  paidRevenue: number
  paidCost: number
  paidKeptPct: number | null
  freeSurveys: number
  freeCost: number
  /** Spend on delivered surveys in the period with no price at all. */
  spendNoPrice: number
  surveysNoPrice: number
}

export interface Period {
  /** 'YYYY-MM', 'YYYY-Qn', or 'undated' / 'total' for the two extra rows. */
  key: string
  surveys: number
  delivered: number
  spend: number
  /** Blast rewards as issued (bid × completes), before anything came back. */
  rewardsGross: number
  /** Recovered rewards inside `spend` (≤ 0). spend − recovered is the gross. */
  recovered: number
  /** Surveys in the period that paid blast rewards, and how many of them carry
   *  a recovered-reward line yet. Recoveries are booked in batches, so a period
   *  whose recoveries have not landed reads dearer than one whose have. */
  rewardedSurveys: number
  creditedSurveys: number
  /** Fewer than RECOVERY_PENDING_BELOW of the rewarded surveys carry a
   *  recovery: read this period's blast cost as gross, still to come down. */
  recoveriesPending: boolean
  /** Delivered N across delivered surveys that HAVE one. */
  n: number
  /** Delivered surveys in the period with no delivered N. */
  nMissing: number
  /** Delivered surveys whose N actual is only the roll-up of the segments that
   *  have a count: in `n` (it is the survey's figure) but left out of
   *  costedN / costedSpend, so no cost per N is drawn from them. */
  nPartial: number
  costedN: number
  costedSpend: number
  costedSurveys: number
  pricedSurveys: number
  /** costedSpend ÷ costedN, all routes. Prefer `byRoute` — see the header. */
  costPerN: number | null
  coverage: number
  byRoute: Record<Route, RouteSlice>
  margin: PeriodMargin
  ids: string[]
}

const slice = (): RouteSlice => ({ surveys: 0, spend: 0, costedN: 0, costedSpend: 0, costPerN: null })

const emptyPeriod = (key: string): Period => ({
  key, surveys: 0, delivered: 0, spend: 0, rewardsGross: 0, recovered: 0,
  rewardedSurveys: 0, creditedSurveys: 0, recoveriesPending: false, n: 0, nMissing: 0, nPartial: 0,
  costedN: 0, costedSpend: 0, costedSurveys: 0, pricedSurveys: 0, costPerN: null, coverage: 0,
  byRoute: { blast: slice(), panel: slice(), both: slice(), none: slice() },
  margin: {
    surveys: 0, revenue: 0, cost: 0, kept: 0, keptPct: null,
    paidSurveys: 0, paidRevenue: 0, paidCost: 0, paidKeptPct: null,
    freeSurveys: 0, freeCost: 0, spendNoPrice: 0, surveysNoPrice: 0,
  },
  ids: [],
})

export const periodKey = (d: string, grain: 'month' | 'quarter' = 'month') =>
  grain === 'month' ? d.slice(0, 7) : `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`

function addSurvey(
  e: Period, p: FinProject, route: Route, cls: FinClass,
  rates: Map<string, number>, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[], ix: FinIndex,
) {
  e.surveys++
  e.ids.push(p.id)
  const sp = spendOf(p, blasts, suppliers, costs, ix)
  e.spend += sp.total
  e.rewardsGross += sp.reward
  e.recovered += sp.recovered
  if (sp.reward > 0) {
    e.rewardedSurveys++
    if ((ix.costs.get(p.id) ?? []).some(isCredit)) e.creditedSurveys++
  }
  const r = e.byRoute[route]
  r.surveys++
  r.spend += sp.total
  if (sp.total > 0) e.costedSurveys++
  if (cls !== 'delivered') return
  e.delivered++
  // The survey's delivered N — the same figure the bill uses (revenue.ts).
  const delivered = deliveredNOf(p).n
  if (delivered == null) e.nMissing++
  else {
    const actual = delivered
    e.n += actual
    // Cost per N divides the survey's whole cost, so the N has to cover the
    // whole survey: a partial segment roll-up is counted in `n` and nowhere
    // in the per-unit population.
    if (perRespondentNOf(p) == null) e.nPartial++
    else if (sp.total > 0) {
      e.costedN += actual; e.costedSpend += sp.total
      r.costedN += actual; r.costedSpend += sp.total
    }
  }
  const rv = revenueDetail(p, rates.get(p.id))
  if (rv.priced) e.pricedSurveys++
  const mg = e.margin
  if (!rv.priced) {
    if (sp.total > 0) { mg.spendNoPrice += sp.total; mg.surveysNoPrice++ }
    return
  }
  if (rv.revenue == null || sp.total <= 0) return
  mg.surveys++; mg.revenue += rv.revenue; mg.cost += sp.total
  if (rv.free) { mg.freeSurveys++; mg.freeCost += sp.total }
  else if (rv.ratioEligible) { mg.paidSurveys++; mg.paidRevenue += rv.revenue; mg.paidCost += sp.total }
}

function finishPeriod(e: Period) {
  e.costPerN = e.costedN > 0 ? e.costedSpend / e.costedN : null
  e.coverage = e.surveys > 0 ? e.costedSurveys / e.surveys : 0
  e.recoveriesPending = e.rewardedSurveys > 0 &&
    e.creditedSurveys / e.rewardedSurveys < RECOVERY_PENDING_BELOW
  for (const r of Object.values(e.byRoute)) r.costPerN = r.costedN > 0 ? r.costedSpend / r.costedN : null
  const mg = e.margin
  mg.kept = mg.revenue - mg.cost
  mg.keptPct = keptPct(mg.revenue, mg.cost)
  mg.paidKeptPct = keptPct(mg.paidRevenue, mg.paidCost)
}

export interface MonthTable {
  /** Dated periods, oldest first. */
  periods: Period[]
  /** Surveys with no deliver, launch or submitted date. They appear in no
   *  date range, so they get their own row rather than vanishing. */
  undated: Period | null
  /** Everything above, so the rows visibly add up to the book. */
  total: Period
}

export function monthTable(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  grain: 'month' | 'quarter' = 'month',
): MonthTable {
  const ix = buildIndex(blasts, suppliers, costs)
  const by = new Map<string, Period>()
  const undated = emptyPeriod('undated')
  const total = emptyPeriod('total')
  for (const p of rows) {
    const cls = classOf(p, ix)
    if (cls === 'placeholder') continue
    const route = routeOf(p, blasts, suppliers, ix)
    const d = finDate(p)
    let e = undated
    if (d) {
      const k = periodKey(d, grain)
      e = by.get(k) ?? emptyPeriod(k)
      by.set(k, e)
    }
    addSurvey(e, p, route, cls, rates, blasts, suppliers, costs, ix)
    addSurvey(total, p, route, cls, rates, blasts, suppliers, costs, ix)
  }
  const periods = [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const e of periods) finishPeriod(e)
  finishPeriod(undated)
  finishPeriod(total)
  return { periods, undated: undated.surveys > 0 ? undated : null, total }
}

/** The dated periods only — kept for callers that draw a time axis. */
export function monthly(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  grain: 'month' | 'quarter' = 'month',
): Period[] {
  return monthTable(rows, rates, blasts, suppliers, costs, grain).periods
}

/* ── THE BID LADDER ────────────────────────────────────────────────────────
 * Across the projects that ran more than one bid level, each project is
 * compared with its OWN lowest bid. Head to head, the higher bid has done
 * worse in most comparisons, and the premium paid above each project's own
 * base rate is the money at stake. The counts are computed on every load.
 *
 * The likely mechanism is that escalation is sequential — the expensive blast
 * is chasing a list the cheap one already worked — so this is evidence about
 * ORDER, not proof that money repels respondents. It is reported as a measured
 * association with the confound named, because the decision it supports (buy
 * more list before bidding up) is right under either reading.
 *
 * Rewards here are GROSS — bid × completes as issued, before any unclaimed
 * reward came back — because recoveries are booked per survey, not per blast,
 * and cannot be placed on one rung of the ladder. */

export interface BidLadder {
  projects: number
  base: { sends: number; completes: number; rate: number; costPer: number }
  raised: { sends: number; completes: number; rate: number; costPer: number }
  /** Reward paid above each project's own lowest bid. */
  premium: number
  /** Projects with 500+ sends in both arms, and how many got a WORSE response
   *  after raising. The head-to-head is the honest comparison; the totals above
   *  are dominated by a few large campaigns. */
  headToHead: number
  worseAfterRaise: number
}

export function bidLadder(rows: FinProject[], blasts: FinBlast[]): BidLadder | null {
  const ix = buildIndex(blasts, [], [])
  const z = () => ({ sends: 0, completes: 0, reward: 0 })
  const base = z(), raised = z()
  let projects = 0, premium = 0, headToHead = 0, worseAfterRaise = 0
  for (const p of rows) {
    const mine = (ix.blasts.get(p.id) ?? []).filter(
      b => b.bid != null && b.people != null && b.completes != null)
    const bids = [...new Set(mine.map(b => Number(b.bid)))]
    if (bids.length < 2) continue
    projects++
    const low = Math.min(...bids)
    const lo = mine.filter(b => Number(b.bid) === low)
    const hi = mine.filter(b => Number(b.bid) > low)
    const sum = (rs: FinBlast[], f: (b: FinBlast) => number) => rs.reduce((t, b) => t + f(b), 0)
    const lS = sum(lo, b => Number(b.people)), lC = sum(lo, b => Number(b.completes))
    const hS = sum(hi, b => Number(b.people)), hC = sum(hi, b => Number(b.completes))
    base.sends += lS; base.completes += lC
    base.reward += sum(lo, b => Number(b.bid) * Number(b.completes))
    raised.sends += hS; raised.completes += hC
    raised.reward += sum(hi, b => Number(b.bid) * Number(b.completes))
    premium += sum(hi, b => (Number(b.bid) - low) * Number(b.completes))
    if (lS >= 500 && hS >= 500) {
      headToHead++
      if (hC / hS < lC / lS) worseAfterRaise++
    }
  }
  if (!projects) return null
  const shape = (a: ReturnType<typeof z>) => ({
    sends: a.sends, completes: a.completes,
    rate: a.sends > 0 ? a.completes / a.sends : 0,
    costPer: a.completes > 0 ? a.reward / a.completes : 0,
  })
  return { projects, base: shape(base), raised: shape(raised), premium, headToHead, worseAfterRaise }
}

/* ── BACKLOG ───────────────────────────────────────────────────────────────
 * What is sold and not yet delivered, valued at the N sold. LIVE work only:
 * a held survey is its own bucket, and a scoping survey is not sold. */

export interface Backlog {
  surveys: number
  /** Price × N sold, if every live priced survey lands exactly on target. An
   *  upper bound: it assumes no shortfall, and surveys regularly come in short. */
  revenueAtTarget: number
  spentSoFar: number
  /** Live surveys this cannot value — no price, or no N target. */
  unpriced: number
  /** Of `unpriced`, how many are missing only the target. */
  noTarget: number
  ids: string[]
}

export function backlog(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Backlog {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: Backlog = { surveys: 0, revenueAtTarget: 0, spentSoFar: 0, unpriced: 0, noTarget: 0, ids: [] }
  for (const p of rows) {
    if (classOf(p, ix) !== 'active') continue
    // The survey's one rate × the survey's N sold — the invoice's shape, as
    // revenue.ts bills it. Segment prices do not enter.
    const l = surveyLineOf(p, rates.get(p.id))
    if (l.rate == null) { out.unpriced++; continue }
    if (l.nMin == null || !(l.nMin > 0)) { out.unpriced++; out.noTarget++; continue }
    out.surveys++
    out.revenueAtTarget += l.rate * l.nMin
    out.spentSoFar += spendOf(p, blasts, suppliers, costs, ix).total
    out.ids.push(p.id)
  }
  return out
}

/* ── UNPRICED SPEND ────────────────────────────────────────────────────────
 * Recorded spend on work with no client price attached can never appear in a
 * margin. Ranked by dollars, this is a worklist rather than a lament. A real
 * $0 price is a price, so a free trial is NOT on this list. */

export interface UnpricedAccount {
  accountId: string | null
  account: string
  surveys: number
  spend: number
  ids: string[]
}

export function unpricedSpend(pnl: SurveyPnl[]): {
  total: number; share: number; accounts: UnpricedAccount[]
} {
  const by = new Map<string, UnpricedAccount>()
  let total = 0, all = 0
  for (const s of pnl) {
    if (s.cost <= 0) continue
    all += s.cost
    if (s.priced) continue
    total += s.cost
    const key = s.accountId ?? s.account
    let e = by.get(key)
    if (!e) { e = { accountId: s.accountId, account: s.account, surveys: 0, spend: 0, ids: [] }; by.set(key, e) }
    e.surveys++; e.spend += s.cost; e.ids.push(s.id)
  }
  return {
    total, share: all > 0 ? total / all : 0,
    accounts: [...by.values()].sort((a, b) => b.spend - a.spend),
  }
}

export type { FinIndex }

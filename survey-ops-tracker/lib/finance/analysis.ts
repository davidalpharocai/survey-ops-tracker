/**
 * The analytical layer: the questions the cost report could not answer.
 *
 * `hub.ts` answers "what did this cost and what did it earn". This file answers
 * the four an FP&A director asks next — what is unresolved right now, what is a
 * unit worth, what is out of line, and what happened over time.
 *
 * ── TWO RULES EVERYTHING HERE OBEYS ─────────────────────────────────────────
 * 1. Every aggregate returns the IDS it summed. A drill-down that re-derives
 *    its own population will eventually disagree with its headline, and a table
 *    that disagrees with its headline is worse than no table.
 * 2. Gross, never netted. Ten surveys blew their budget ceiling by $31,604 and
 *    thirteen came in under by $28,961. Netting those reports roughly zero and
 *    the finding disappears — but nobody can spend the headroom on the survey
 *    that overran. Overrun and headroom are reported side by side, never summed.
 */

import {
  buildIndex, finDate, isCancelled, isDelivered, routeOf, spendOf,
  type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier, type Route,
} from './hub'

/* ── LIFECYCLE ─────────────────────────────────────────────────────────────
 * Replaces five hardcoded `isDelivered` checks with one visible selector.
 * `abandoned` is the bucket nobody had a name for: 24 surveys closed without
 * ever reaching Delivery, holding 7,526 collected N and $0 of recorded cost.
 * They are not cancelled — nobody called them off — they were simply closed,
 * and the N they collected is real work that no cost record accounts for. */
export type Lifecycle = 'delivered' | 'inflight' | 'cancelled' | 'abandoned' | 'all'

/**
 * Work that is still being SCOPED, not yet sold.
 *
 * David, 2026-09-17: "surveys that are in scoping bucket shouldnt be included
 * in financials by default. there can be a toggle to include them but they
 * shouldnt be included by default."
 *
 * 30 surveys sit in phase='Scoping'. They are a pipeline, not a book: counting
 * them dilutes every coverage percentage with work nobody has agreed to do yet,
 * and a survey that never gets sold would sit in the denominator for ever. Note
 * this is `phase`, NOT `scoping_stage` — that column is populated on 373 of 416
 * surveys (329 of them still reading "New Inquiry" long after delivery) and
 * filtering on it would empty the page.
 */
export const isScoping = (p: FinProject) => p.phase === 'Scoping'

export function lifecycleOf(p: FinProject): Exclude<Lifecycle, 'all'> {
  if (isCancelled(p)) return 'cancelled'
  if (isDelivered(p)) return 'delivered'
  // `status` is the app's own word for "this is finished". A finished survey
  // that never reached Delivery was dropped, whatever the board says.
  if (p.status === 'Closed') return 'abandoned'
  return 'inflight'
}

export const inLifecycle = (p: FinProject, l: Lifecycle) =>
  l === 'all' ? true : lifecycleOf(p) === l

export interface LifecycleCount { key: Exclude<Lifecycle, 'all'>; surveys: number; spend: number; n: number }

export function lifecycleCounts(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): LifecycleCount[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const acc = new Map<string, LifecycleCount>()
  for (const k of ['delivered', 'inflight', 'cancelled', 'abandoned'] as const) {
    acc.set(k, { key: k, surveys: 0, spend: 0, n: 0 })
  }
  for (const p of rows) {
    const e = acc.get(lifecycleOf(p))!
    e.surveys++
    e.spend += spendOf(p, blasts, suppliers, costs, ix).total
    e.n += Number(p.n_collected ?? 0)
  }
  return [...acc.values()]
}

/* ── BUDGET VARIANCE ───────────────────────────────────────────────────────
 * `survey_projects.budget` is a COST CEILING — the most we intend to spend —
 * and NOT client revenue (David, 2026-08-24). The only meaningful comparison
 * runs actual spend against it. The word "budget" appeared nowhere in the
 * finance hub before this. */

export interface Breach {
  id: string
  code: string | null
  name: string | null
  account: string
  route: Route
  lifecycle: Exclude<Lifecycle, 'all'>
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
   *  can speak about. 24 of 403. */
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
        lifecycle: lifecycleOf(p), board: p.board_column,
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
 * A survey that has already blown its ceiling or blown past its target while
 * still in the field is spending money right now that nobody has approved. */

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

export function liveExposure(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string> = new Map(),
): Exposure[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: Exposure[] = []
  for (const p of rows) {
    if (lifecycleOf(p) !== 'inflight') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0) continue
    const budget = p.budget == null ? null : Number(p.budget)
    const target = p.n_target == null ? null : Number(p.n_target)
    const collected = p.n_collected == null ? null : Number(p.n_collected)
    const reasons: string[] = []
    if (budget != null && budget > 0 && sp.total > budget) {
      reasons.push(`${Math.round((sp.total / budget) * 100)}% of its ceiling`)
    }
    const overN = target != null && target > 0 && collected != null
      ? Math.max(0, collected - target) : 0
    if (overN > 0) reasons.push(`${overN.toLocaleString()} completes past target`)
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

/* ── PER-SURVEY P&L ────────────────────────────────────────────────────────
 * The row every other band drills into. */

export interface SurveyPnl {
  id: string
  code: string | null
  name: string | null
  account: string
  accountId: string | null
  route: Route
  lifecycle: Exclude<Lifecycle, 'all'>
  date: string | null
  rate: number | null
  target: number | null
  actual: number | null
  collected: number | null
  billableN: number | null
  revenue: number | null
  cost: number
  paidCompletes: number
  margin: number | null
  marginPct: number | null
  cpc: number | null
  cpqr: number | null
  /** Do the recorded completes cover the N this survey claims? Everything
   *  derived from a survey where this is false is suspect, and the drill-down
   *  shows it as a column rather than silently dropping the row. */
  reconciled: boolean
}

export function surveyPnl(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  accounts: Map<string, string> = new Map(),
): SurveyPnl[] {
  const ix = buildIndex(blasts, suppliers, costs)
  return rows.map(p => {
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    const r = rates.get(p.id)
    const target = p.n_target == null ? null : Number(p.n_target)
    const actual = p.n_actual == null ? null : Number(p.n_actual)
    const collected = p.n_collected == null ? null : Number(p.n_collected)
    const billableN = target != null && actual != null ? Math.min(target, actual) : null
    const revenue = r != null && r > 0 && billableN != null ? r * billableN : null
    const margin = revenue == null ? null : revenue - sp.total
    return {
      id: p.id, code: p.project_code, name: p.project_name,
      account: (p.client_id && accounts.get(p.client_id)) || p.client || '(no account)',
      accountId: p.client_id,
      route: routeOf(p, blasts, suppliers, ix),
      lifecycle: lifecycleOf(p), date: finDate(p),
      rate: r != null && r > 0 ? r : null,
      target, actual, collected, billableN, revenue,
      cost: sp.total, paidCompletes: sp.paidCompletes,
      margin,
      marginPct: revenue != null && revenue > 0 ? (revenue - sp.total) / revenue : null,
      cpc: sp.paidCompletes > 0 && sp.total > 0 ? sp.total / sp.paidCompletes : null,
      cpqr: actual != null && actual > 0 && sp.total > 0 ? sp.total / actual : null,
      reconciled: collected != null && collected > 0 && sp.paidCompletes >= collected,
    }
  })
}

/* ── ACCOUNT P&L ───────────────────────────────────────────────────────────
 * The finding this exists for: BAM's blast work costs $68 a complete against
 * DE Shaw's $70 — cheaper to field — and realises $106/N against DE Shaw's
 * $128. That is a pricing gap, not an execution problem, and no card on the
 * old page could show it because realised rate was never computed. */

export interface AccountPnl {
  accountId: string | null
  account: string
  surveys: number
  /** Surveys contributing to the revenue and margin figures. Printed on every
   *  row: a realised rate from n=2 is not comparable to one from n=14. */
  measured: number
  revenue: number
  cost: number
  margin: number
  marginPct: number | null
  billableN: number
  /** Revenue ÷ billable N: what this account actually pays per interview, as
   *  opposed to the rate card, which min() may never have charged. */
  realisedRate: number | null
  /** Recorded cost ÷ paid completes on the SAME surveys, so the two can be
   *  compared without crossing populations. */
  costPerComplete: number | null
  /** Total recorded spend on the account, measured or not. */
  totalSpend: number
  /** Spend carrying no client rate — the data-entry worklist, ranked. */
  unpricedSpend: number
  ids: string[]
}

export function accountPnl(
  pnl: SurveyPnl[], opts: { route?: Route | null } = {},
): AccountPnl[] {
  const by = new Map<string, AccountPnl>()
  for (const s of pnl) {
    if (opts.route && s.route !== opts.route) continue
    const key = s.accountId ?? s.account
    let e = by.get(key)
    if (!e) {
      e = {
        accountId: s.accountId, account: s.account, surveys: 0, measured: 0,
        revenue: 0, cost: 0, margin: 0, marginPct: null, billableN: 0,
        realisedRate: null, costPerComplete: null, totalSpend: 0, unpricedSpend: 0,
        ids: [],
      }
      by.set(key, e)
    }
    e.surveys++
    e.totalSpend += s.cost
    if (s.rate == null) e.unpricedSpend += s.cost
    if (s.revenue != null && s.cost > 0 && s.billableN != null && s.paidCompletes > 0) {
      e.measured++
      e.revenue += s.revenue
      e.cost += s.cost
      e.billableN += s.billableN
      e.ids.push(s.id)
    }
  }
  const out = [...by.values()]
  for (const e of out) {
    e.margin = e.revenue - e.cost
    e.marginPct = e.revenue > 0 ? e.margin / e.revenue : null
    e.realisedRate = e.billableN > 0 ? e.revenue / e.billableN : null
    e.costPerComplete = null
  }
  // Cost per complete needs paid completes on exactly the measured surveys.
  const measured = new Set(out.flatMap(e => e.ids))
  const paidBy = new Map<string, number>()
  for (const s of pnl) {
    if (!measured.has(s.id)) continue
    const key = s.accountId ?? s.account
    paidBy.set(key, (paidBy.get(key) ?? 0) + s.paidCompletes)
  }
  for (const e of out) {
    const paid = paidBy.get(e.accountId ?? e.account) ?? 0
    e.costPerComplete = paid > 0 ? e.cost / paid : null
  }
  return out.sort((a, b) => b.totalSpend - a.totalSpend)
}

/* ── EXCEPTION QUEUE ───────────────────────────────────────────────────────
 * David's "guidance and suggestions" ask, answered with rows rather than
 * adjectives. Each entry names a survey, a dollar figure and what to do. */

export type ExceptionKind = 'loss' | 'over-budget' | 'cpqr-outlier' | 'over-delivered' | 'unpriced-spend'

export interface Exception {
  kind: ExceptionKind
  id: string
  code: string | null
  account: string
  headline: string
  detail: string
  /** Dollars at stake, used to rank. */
  amount: number
}

const money = (n: number) => '$' + Math.round(Math.abs(n)).toLocaleString('en-US')

export function exceptions(
  pnl: SurveyPnl[], variance: BudgetVariance, routeMedianCpqr: Map<Route, number>,
): Exception[] {
  const out: Exception[] = []
  for (const s of pnl) {
    if (s.margin != null && s.margin < 0 && s.lifecycle === 'delivered') {
      out.push({
        kind: 'loss', id: s.id, code: s.code, account: s.account,
        headline: `${s.code} lost ${money(s.margin)}`,
        detail: `${money(s.revenue ?? 0)} billed against ${money(s.cost)} of field cost` +
          (s.rate != null ? ` at ${money(s.rate)}/N` : ''),
        amount: Math.abs(s.margin),
      })
    }
    const med = routeMedianCpqr.get(s.route)
    if (s.cpqr != null && med != null && med > 0 && s.cpqr > med * 2 && s.reconciled) {
      out.push({
        kind: 'cpqr-outlier', id: s.id, code: s.code, account: s.account,
        headline: `${s.code} cost ${money(s.cpqr)} per qualified respondent`,
        detail: `against a ${s.route} median of ${money(med)} — ${(s.cpqr / med).toFixed(1)}× the typical survey`,
        amount: s.cpqr - med,
      })
    }
  }
  for (const b of variance.breaches) {
    out.push({
      kind: 'over-budget', id: b.id, code: b.code, account: b.account,
      headline: `${b.code} spent ${money(b.over)} past its ceiling`,
      detail: `${money(b.spend)} against ${money(b.budget)} — ${Math.round(b.pct * 100)}%` +
        (b.lifecycle === 'inflight' ? `, and it is still in ${b.board}` : ''),
      amount: b.over,
    })
  }
  // One entry per survey, worst first: a survey that is both a loss and over
  // budget should not occupy two rows of a worklist.
  const seen = new Set<string>()
  return out
    .sort((a, b) => b.amount - a.amount)
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

/* ── THE TIME DIMENSION ────────────────────────────────────────────────────
 * The old page had none at all.
 *
 * COVERAGE IS THE TRAP HERE. Cost capture began in May 2026: February to April
 * show real delivered N against $0 of recorded spend. A naive monthly cost line
 * therefore reads as 30x growth when it is the ledger filling in, and a naive
 * cost-per-N line reads as an 8x cost explosion for the same reason. So every
 * point carries its own coverage, and any per-unit figure is computed on the
 * COSTED subset only — same numerator, same denominator. */

export interface Period {
  key: string
  surveys: number
  delivered: number
  spend: number
  revenue: number
  /** Delivered N across all surveys in the period. */
  n: number
  /** Delivered N on the surveys that actually carry a cost — the only honest
   *  denominator for a per-unit figure. */
  costedN: number
  costedSurveys: number
  pricedSurveys: number
  /** spend ÷ costedN. Null when nothing in the period is costed, rather than 0. */
  costPerN: number | null
  coverage: number
  ids: string[]
}

export function monthly(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  grain: 'month' | 'quarter' = 'month',
): Period[] {
  const ix = buildIndex(blasts, suppliers, costs)
  const keyOf = (d: string) =>
    grain === 'month' ? d.slice(0, 7) : `${d.slice(0, 4)}-Q${Math.floor(Number(d.slice(5, 7)) / 3.01) + 1}`
  const by = new Map<string, Period>()
  for (const p of rows) {
    const d = finDate(p)
    if (!d) continue
    const k = keyOf(d)
    let e = by.get(k)
    if (!e) {
      e = {
        key: k, surveys: 0, delivered: 0, spend: 0, revenue: 0, n: 0,
        costedN: 0, costedSurveys: 0, pricedSurveys: 0, costPerN: null,
        coverage: 0, ids: [],
      }
      by.set(k, e)
    }
    e.surveys++
    e.ids.push(p.id)
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    e.spend += sp.total
    if (sp.total > 0) e.costedSurveys++
    if (!isDelivered(p)) continue
    e.delivered++
    const actual = Number(p.n_actual ?? 0)
    e.n += actual
    if (sp.total > 0) e.costedN += actual
    const r = rates.get(p.id)
    if (r != null && r > 0 && p.n_target != null && p.n_actual != null) {
      e.revenue += r * Math.min(Number(p.n_actual), Number(p.n_target))
      e.pricedSurveys++
    }
  }
  const out = [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const e of out) {
    e.costPerN = e.costedN > 0 ? e.spend / e.costedN : null
    e.coverage = e.surveys > 0 ? e.costedSurveys / e.surveys : 0
  }
  return out
}

/* ── THE BID LADDER ────────────────────────────────────────────────────────
 * Measured across the 53 projects that ran more than one bid level: at each
 * project's OWN lowest bid, 1,512 completes from 1.60M sends (0.0945%) at $24
 * each; at every higher bid, 1,788 completes from 2.96M sends (0.0604%) at $52.
 * Head to head with 500+ sends in both arms, the higher bid did WORSE in 29 of
 * 44. $59,401 was paid as premium over each project's own base rate.
 *
 * The likely mechanism is that escalation is sequential — the expensive blast
 * is chasing a list the cheap one already worked — so this is evidence about
 * ORDER, not proof that money repels respondents. It is reported as a measured
 * association with the confound named, because the decision it supports (buy
 * more list before bidding up) is right under either reading.
 *
 * `blastEfficiency` averages every bid into one response rate, which destroys
 * this entirely. */

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
 * What is contracted and not yet billed. Forward visibility existed nowhere. */

export interface Backlog {
  surveys: number
  /** Revenue if every in-flight priced survey lands exactly on target. An
   *  upper bound: it assumes no shortfall, and 13 of the last delivered
   *  surveys came in short. */
  revenueAtTarget: number
  spentSoFar: number
  /** In-flight surveys with no rate — the part of the pipeline this cannot see. */
  unpriced: number
  ids: string[]
}

export function backlog(
  rows: FinProject[], rates: Map<string, number>,
  blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Backlog {
  const ix = buildIndex(blasts, suppliers, costs)
  const out: Backlog = { surveys: 0, revenueAtTarget: 0, spentSoFar: 0, unpriced: 0, ids: [] }
  for (const p of rows) {
    if (lifecycleOf(p) !== 'inflight') continue
    const r = rates.get(p.id)
    const target = p.n_target == null ? null : Number(p.n_target)
    if (r == null || r <= 0 || target == null || target <= 0) { out.unpriced++; continue }
    out.surveys++
    out.revenueAtTarget += r * target
    out.spentSoFar += spendOf(p, blasts, suppliers, costs, ix).total
    out.ids.push(p.id)
  }
  return out
}

/* ── UNPRICED SPEND ────────────────────────────────────────────────────────
 * 52.5% of every dollar recorded — $181,119 — sits on work with no client rate
 * attached, so it can never appear in a margin. Ranked by dollars, this is a
 * worklist rather than a lament. */

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
    if (s.rate != null) continue
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

/**
 * The populations behind the figures.
 *
 * Each builder returns the SAME rows the corresponding aggregate summed, with a
 * per-row `contribution` that adds back to the headline. The panel checks that
 * sum on every open, so a builder that drifts from its aggregate announces
 * itself in red rather than quietly showing a different set.
 *
 * That is why these are built from `SurveyPnl` — the object the tabs already
 * render — rather than by re-querying or re-filtering. Two code paths computing
 * "the scrubbed surveys" is exactly how a detail table comes to disagree with
 * the number that opened it.
 */

import type { DrillRow } from '@/components/finance/DrillPanel'
import type { Breach, Exposure, SurveyPnl, UnpricedAccount } from './analysis'

const scrubN = (r: SurveyPnl) =>
  r.collected != null && r.actual != null ? Math.max(0, r.collected - r.actual) : 0
const overN = (r: SurveyPnl) =>
  r.target != null && r.actual != null && r.collected != null
    ? Math.max(0, Math.min(r.actual, r.collected) - r.target) : 0
const shortN = (r: SurveyPnl) =>
  r.target != null && r.actual != null ? Math.max(0, r.target - r.actual) : 0

const base = (r: SurveyPnl) => ({
  id: r.id, code: r.code, account: r.account, route: r.route,
  target: r.target, collected: r.collected, actual: r.actual,
  cost: r.cost, cpc: r.cpc, cpqr: r.cpqr, rate: r.rate,
  revenue: r.revenue, margin: r.margin, marginPct: r.marginPct,
  reconciled: r.reconciled,
})

/** Surveys that bought completes QA then removed, priced at each survey's own
 *  cost per complete — the same arithmetic `moneyLost` does. */
export function scrubRows(pnl: SurveyPnl[]): DrillRow[] {
  return pnl
    .filter(r => r.lifecycle === 'delivered' && r.cost > 0 && r.paidCompletes > 0 && scrubN(r) > 0)
    .map(r => ({
      ...base(r),
      scrubN: scrubN(r),
      contribution: scrubN(r) * (r.cost / r.paidCompletes),
      // Whether this survey still cleared its target: if it did, the scrub cost
      // cash and cost no revenue, which changes what to do about it.
      stillHitTarget: r.target != null && r.actual != null && r.actual >= r.target,
    }))
    .sort((a, b) => b.contribution - a.contribution)
}

/** Completes bought past the promised N. Billing caps at min(), so these earn
 *  nothing at all. */
export function overTargetRows(pnl: SurveyPnl[]): DrillRow[] {
  return pnl
    .filter(r => r.lifecycle === 'delivered' && r.cost > 0 && r.paidCompletes > 0 && overN(r) > 0)
    .map(r => ({
      ...base(r),
      overN: overN(r),
      contribution: overN(r) * (r.cost / r.paidCompletes),
    }))
    .sort((a, b) => b.contribution - a.contribution)
}

/** Delivered short of target, priced at the CLIENT rate — revenue never billed.
 *  A different currency from the two above and never summed with them. */
export function foregoneRows(pnl: SurveyPnl[]): DrillRow[] {
  return pnl
    .filter(r => r.lifecycle === 'delivered' && r.rate != null && r.rate > 0 && shortN(r) > 0)
    .map(r => ({ ...base(r), shortN: shortN(r), contribution: shortN(r) * r.rate! }))
    .sort((a, b) => b.contribution - a.contribution)
}

/** Every survey in the margin figure. `contribution` is margin dollars, so the
 *  strip reconciles against the headline margin and a negative row visibly
 *  drags the running total down. */
export function marginRows(pnl: SurveyPnl[]): DrillRow[] {
  return pnl
    .filter(r => r.lifecycle === 'delivered' && r.revenue != null && r.cost > 0)
    .map(r => ({ ...base(r), contribution: r.margin ?? 0 }))
    .sort((a, b) => (a.contribution as number) - (b.contribution as number))
}

/**
 * CPQR contributors for one route. `contribution` is SPEND, not the rate: a
 * blended rate is a ratio of two sums and cannot be reconciled row-by-row, so
 * the strip checks the numerator it was actually built from.
 *
 * READS `cpqrLegs`, WHICH THE CARD ALSO READS. This used to re-state the card's
 * admission test as its own filter, which was survivable while a survey was
 * wholly on one route. It stopped being survivable in 117: a MIXED survey now
 * contributes a PART of its cost to each route, so `r.cost` — the whole bill —
 * is the wrong contribution on both sides. On PR00425 it would report $13,514
 * against a panel headline built from $2,086.
 */
export function cpqrRows(pnl: SurveyPnl[], route: 'blast' | 'panel'): DrillRow[] {
  return pnl
    .flatMap(r => {
      const leg = r.cpqrLegs.find(l => l.route === route)
      if (!leg) return []
      return [{
        ...base(r),
        paidCompletes: leg.paid,
        // The leg's own figures, so a mixed survey's row reads as the part of it
        // this card is about rather than as the whole survey.
        cost: leg.spend,
        actual: leg.delivered,
        cpqr: leg.delivered && leg.delivered > 0 ? leg.spend / leg.delivered : null,
        cpc: leg.paid > 0 ? leg.spend / leg.paid : null,
        contribution: leg.spend,
      }]
    })
    .sort((a, b) => (b.cpqr as number ?? 0) - (a.cpqr as number ?? 0))
}

/** Surveys past their cost ceiling. `contribution` is the overrun, gross — the
 *  under-spenders are deliberately not here, because netting them reports ~$0. */
export function breachRows(breaches: Breach[]): DrillRow[] {
  return breaches.map(b => ({
    id: b.id, code: b.code, account: b.account, route: b.route,
    board: b.board, lifecycle: b.lifecycle,
    budget: b.budget, spend: b.spend, pct: b.pct,
    target: b.target, collected: b.collected,
    contribution: b.over,
  }))
}

/** In-flight surveys past a ceiling or past target. `contribution` is spend to
 *  date, which is what is actually at risk right now. */
export function exposureRows(rows: Exposure[]): DrillRow[] {
  return rows.map(e => ({
    id: e.id, code: e.code, account: e.account, route: e.route, board: e.board,
    budget: e.budget, spend: e.spend, target: e.target, collected: e.collected,
    overTargetN: e.overTargetN, overTargetCost: e.overTargetCost,
    reasons: e.reasons.join(' · '),
    contribution: e.spend,
  }))
}

/** Recorded spend on surveys with no client rate — it can never reach a margin.
 *  Rows are SURVEYS, not accounts, so the panel drills past the account rollup
 *  to the thing someone actually has to price. */
export function unpricedRows(pnl: SurveyPnl[], accountId?: string | null): DrillRow[] {
  return pnl
    .filter(r => r.cost > 0 && r.rate == null && (!accountId || r.accountId === accountId))
    .map(r => ({ ...base(r), contribution: r.cost }))
    .sort((a, b) => b.contribution - a.contribution)
}

/** The account rollup, for the portfolio-level view of the same money. */
export function unpricedAccountRows(accounts: UnpricedAccount[]): DrillRow[] {
  return accounts.map(a => ({
    // Not a survey, so there is no project to link to — the panel renders the
    // code cell and an account has none. Carrying the account name as the code
    // keeps the row readable and the link inert.
    id: a.accountId ?? a.account,
    code: a.account,
    surveys: a.surveys,
    contribution: a.spend,
  }))
}

/**
 * Credits, and the dollar figure behind them.
 *
 * David, 2026-09-17: "both options should be there but it will, at least for
 * now, have data entered in one or the other. additionally, a record may have
 * credits associated with it, but id ideally still want to see the $ / N so i
 * can better understand costs, etc."
 *
 * ── THE TWO UNITS ANSWER DIFFERENT QUESTIONS ────────────────────────────────
 *
 *   credits      price the SCOPE. Agreed once, up front, when the work is sold.
 *                A survey "costs 44 credits" whatever it goes on to deliver.
 *   price_per_n  prices the DELIVERY, and bills at min(n_actual, n_target).
 *
 * A survey carrying both is therefore NOT double-priced. It has a contracted
 * value and a delivered value, and the gap between them is the shortfall seen
 * from the revenue side rather than the N side. PR00257 is the clean example:
 * 15 credits agreed for a 50-N study that delivered 7, so its contracted value
 * is roughly $3,000 and its delivered value $875. Nothing is wrong with either
 * number; the distance between them is the finding.
 *
 * ── WHICH ONE BECOMES REVENUE ───────────────────────────────────────────────
 * `price_per_n` wins when it is present, because revenue is what was billed and
 * billing follows delivery. Credits then supply the contracted figure alongside
 * it. When only credits exist, they become revenue, because that is the only
 * price on file. The two are never added.
 *
 * ── WHERE THE DOLLARS PER CREDIT COMES FROM ─────────────────────────────────
 * NOT a new column. Migration 100 already put `dollars_total` on
 * client_term_financials — a separate, RLS-gated table, for exactly the reason
 * a credit's dollar value needs one: credits are public and their price is not.
 * A contract's rate is therefore simply
 *
 *     dollars_total / credits_total
 *
 * and this file derives it rather than storing a second copy. A stored rate
 * would be a third number that could disagree with the two it came from, which
 * is the mistake this codebase keeps paying for.
 *
 * ── WHY THE IMPLIED RATE IS SHOWN AND NEVER WRITTEN BACK ────────────────────
 * Eight surveys carry both units today and imply a median $198.28 a credit,
 * $200.00 at p75. It is tempting to write $200 onto DE Shaw's contract from
 * that. Migration 100 refused the same shortcut and the reasoning holds: a
 * derived rate presented as an agreed one is a number the business never
 * confirmed. The app shows it, labelled implied, and David types the contract
 * total. Suggesting is not the same as claiming.
 */

import type { FinProject } from './hub'

/** One row of `client_terms` — the contract a survey draws down. */
export interface FinTerm {
  id: string
  client_id: string | null
  name: string | null
  credits_total: number | null
}

/** One row of `client_term_financials` (migration 100). RLS-restricted, so for
 *  a reader without VIEW_FINANCIALS this arrives EMPTY — which reads as "no
 *  contract value on file" and degrades to showing credits with no dollar
 *  figure, rather than erroring. Deliberately indistinguishable from "not set":
 *  a UI that could tell those apart would leak that a number exists. */
export interface FinTermValue {
  term_id: string
  dollars_total: number | null
}

/**
 * Dollars per credit for each contract, derived from what the contract is worth
 * and how many credits it carries. Contracts with either figure missing are
 * simply absent from the map, so a caller gets null rather than a rate built on
 * half the inputs.
 */
export function creditValues(
  terms: FinTerm[], dollars: Map<string, number | null>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of terms) {
    const d = dollars.get(t.id)
    const c = t.credits_total
    if (d == null || c == null || !(Number(c) > 0) || !(Number(d) > 0)) continue
    out.set(t.id, Number(d) / Number(c))
  }
  return out
}

/** A survey carrying credits. */
export interface CreditedProject extends FinProject {
  credits?: number | null
  term_id?: string | null
}

export interface CreditValuation {
  credits: number
  /** Dollars per credit from the survey's own contract, or null when the
   *  contract has no agreed rate (or the reader may not see it). */
  creditValue: number | null
  /** credits x creditValue — what the client contracted to pay for this survey,
   *  whatever it went on to deliver. Null when the rate is unknown; NEVER 0,
   *  because "no agreed rate" and "free" are different facts. */
  contracted: number | null
  /** contracted ÷ N — the $/N David asked to see on a credit-priced survey.
   *  Divided by BILLABLE N where the survey has delivered, because that is what
   *  a rate-priced survey would bill on and the two must be comparable; falls
   *  back to target while the survey is still running, which is the figure that
   *  was quoted against. */
  impliedRatePerN: number | null
  /** Which N the division used, so the number can never travel without it. */
  impliedBasis: 'billable' | 'target' | null
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Billable N: min(delivered, promised). The cap is min(), so over-delivery
 *  bills nothing — pricing against n_collected would overstate every rate. */
export function billableN(p: FinProject): number | null {
  const t = num(p.n_target), a = num(p.n_actual)
  return t != null && a != null ? Math.min(t, a) : null
}

/**
 * Value one survey's credits.
 *
 * `values` is keyed by term_id. A survey with credits but no contract attached
 * cannot be valued at all — its credits draw down nothing — and that returns a
 * null `contracted` rather than a zero, because an unattached survey is a
 * bookkeeping gap and not free work.
 */
export function valueCredits(
  p: CreditedProject,
  values: Map<string, number>,
): CreditValuation | null {
  const credits = num(p.credits)
  if (credits == null || credits <= 0) return null
  const creditValue = p.term_id ? (values.get(p.term_id) ?? null) : null
  const contracted = creditValue != null && creditValue > 0 ? credits * creditValue : null

  const bill = billableN(p)
  const target = num(p.n_target)
  const basis: CreditValuation['impliedBasis'] =
    bill != null && bill > 0 ? 'billable' : target != null && target > 0 ? 'target' : null
  const denom = basis === 'billable' ? bill : basis === 'target' ? target : null

  return {
    credits,
    creditValue,
    contracted,
    impliedRatePerN: contracted != null && denom != null && denom > 0 ? contracted / denom : null,
    impliedBasis: contracted != null && denom != null && denom > 0 ? basis : null,
  }
}

export interface CreditRevenue {
  /** The revenue figure to use, and where it came from. Null when neither unit
   *  is priced — never 0. */
  revenue: number | null
  source: 'rate' | 'credits' | null
  /** The OTHER unit's figure, when both exist, so the page can show the gap.
   *  Null when only one is on file. */
  alternate: number | null
  alternateSource: 'rate' | 'credits' | null
}

/**
 * One revenue figure per survey, from whichever unit is priced.
 *
 * `price_per_n` wins because revenue is what was billed and billing follows
 * delivery; credits supply the contracted figure alongside. THEY ARE NEVER
 * ADDED — a survey priced both ways has one revenue and one contracted value,
 * and summing them would double-count the same sale.
 */
export function creditRevenue(
  p: CreditedProject,
  rate: number | null | undefined,
  values: Map<string, number>,
): CreditRevenue {
  const bill = billableN(p)
  const fromRate = rate != null && rate >= 0 && bill != null ? rate * bill : null
  const v = valueCredits(p, values)
  const fromCredits = v?.contracted ?? null

  if (fromRate != null) {
    return {
      revenue: fromRate, source: 'rate',
      alternate: fromCredits, alternateSource: fromCredits != null ? 'credits' : null,
    }
  }
  if (fromCredits != null) {
    return { revenue: fromCredits, source: 'credits', alternate: null, alternateSource: null }
  }
  return { revenue: null, source: null, alternate: null, alternateSource: null }
}

export interface ImpliedCreditRate {
  /** Median dollars per credit across surveys carrying BOTH units. */
  median: number
  p25: number
  p75: number
  n: number
  /** The surveys behind it, worst-fitting first, so an outlier can be opened
   *  and explained rather than quietly widening the spread. */
  rows: { id: string; code: string | null; credits: number; revenue: number; perCredit: number }[]
}

/**
 * What a credit appears to be worth, derived from surveys that carry both a
 * credit count and a client rate.
 *
 * This is the cross-check that makes `credit_value` safe to type: a wrong rate
 * announces itself against this instead of quietly restating revenue. Measured
 * today it is a median $198.28 and $200.00 at p75 across eight surveys.
 *
 * Read the spread carefully rather than the point. A survey that came up short
 * implies a LOW rate per credit — PR00257 implies $58.33 because it delivered 7
 * of 50 — which is a statement about that delivery, not about the contract. The
 * median is robust to a few of those; a mean would not be.
 */
export function impliedCreditRate(
  rows: CreditedProject[], rates: Map<string, number>,
): ImpliedCreditRate | null {
  const out: ImpliedCreditRate['rows'] = []
  for (const p of rows) {
    const credits = num(p.credits)
    if (credits == null || credits <= 0) continue
    const r = rates.get(p.id)
    if (r == null || !(r > 0)) continue
    const bill = billableN(p)
    if (bill == null || bill <= 0) continue
    const revenue = r * bill
    out.push({ id: p.id, code: p.project_code, credits, revenue, perCredit: revenue / credits })
  }
  if (!out.length) return null
  const v = out.map(x => x.perCredit).sort((a, b) => a - b)
  const q = (pp: number) => v[Math.min(v.length - 1, Math.floor(v.length * pp))]
  const median = q(0.5)
  return {
    median, p25: q(0.25), p75: q(0.75), n: v.length,
    // Furthest from the median first: those are the ones worth explaining.
    rows: out.slice().sort((a, b) =>
      Math.abs(b.perCredit - median) - Math.abs(a.perCredit - median)),
  }
}

export interface CreditCoverage {
  /** Surveys carrying a credit count. */
  credited: number
  /** …of which draw down an attached contract. Credits with no contract count
   *  toward nothing: the client's balance never moves. */
  attached: number
  /** …of which sit on a contract with an agreed dollar rate, so they can show
   *  a $/N at all. */
  valued: number
  /** Surveys priced BOTH ways — the cross-check population. */
  both: number
  /** Credits on surveys with no contract. The size of the bookkeeping gap. */
  unattachedCredits: number
}

export function creditCoverage(
  rows: CreditedProject[], rates: Map<string, number>, values: Map<string, number>,
): CreditCoverage {
  const c: CreditCoverage = { credited: 0, attached: 0, valued: 0, both: 0, unattachedCredits: 0 }
  for (const p of rows) {
    const credits = num(p.credits)
    if (credits == null || credits <= 0) continue
    c.credited++
    if (p.term_id) {
      c.attached++
      if (values.get(p.term_id) != null) c.valued++
    } else {
      c.unattachedCredits += credits
    }
    const r = rates.get(p.id)
    if (r != null && r > 0) c.both++
  }
  return c
}

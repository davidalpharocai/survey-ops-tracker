// Pure client-price / revenue math for the project Money card.
//
// Price per N is REVENUE — what the client pays us per completed response. It is
// the OPPOSITE side of the ledger from survey_projects.budget, which is a COST
// CEILING (the most we intend to spend). Nothing in here reconciles the two as if
// they ought to agree; the single comparison worth making is ceilingOvershoot() —
// a ceiling above what the contract earns is permission to spend into a loss.
//
// Since migration 078 the N target is a RANGE: n_target is the MINIMUM and
// n_target_max the maximum. Every revenue figure is therefore a range too —
// sold at the floor vs sold at the cap — and a single "contract value" number
// would be a fiction, so nothing here returns one.

/** Which end of the N range to roll up at. `collected` is the actual N banked so
 *  far, used for the invoice-at-what-we-delivered view. */
export type RangeEnd = 'min' | 'max' | 'collected'

export interface PriceLine {
  /** Effective $ per completed response — the segment's own rate, or the project
   *  default it inherits. null when neither is set. */
  rate: number | null
  /** N at the low end of the range (n_target — the contracted minimum). */
  nMin: number | null
  /** N at the high end (n_target_max). */
  nMax: number | null
  /** N banked so far, for the invoiced-at-N-collected figure. */
  nCollected?: number | null
}

/**
 * The rate that actually applies to a segment: its own override when set,
 * otherwise the project default. null at BOTH levels means "nobody has priced
 * this yet" — deliberately NOT 0, because a genuine $0.00/N (a freebie, a
 * make-good) and an unpriced segment must not roll up the same way.
 */
export function effectiveRate(
  segmentRate: number | null | undefined,
  projectRate: number | null | undefined,
): number | null {
  return segmentRate ?? projectRate ?? null
}

/** True when a segment carries no rate of its own and is riding the project
 *  default — what the UI marks "inherited" rather than "override". */
export function isInherited(segmentRate: number | null | undefined): boolean {
  return segmentRate == null
}

/** N for one line at one end of the range. n_target_max was backfilled equal to
 *  n_target by 078, so a project that was never given a range answers the same
 *  number at both ends; the `?? nMin` is belt-and-braces for a row written before
 *  that backfill. */
function nAt(line: PriceLine, end: RangeEnd): number {
  if (end === 'collected') return line.nCollected ?? 0
  return (end === 'max' ? (line.nMax ?? line.nMin) : line.nMin) ?? 0
}

export interface RateRollup {
  /** Σ(rate × N) over PRICED lines — the revenue at this end of the range. */
  revenue: number
  /** ΣN over priced lines — the denominator of the blended rate. */
  pricedN: number
  /** ΣN over lines with no rate at all — excluded from the blend entirely. */
  unpricedN: number
  /** Σ(rate × N) ÷ ΣN over priced lines; null when nothing is priced. */
  blended: number | null
}

/**
 * Roll a set of lines up at one end of the N range.
 *
 * Unpriced lines are excluded from BOTH the numerator and the denominator of the
 * blended rate. If their N counted in the denominator the blend would sag toward
 * zero and read as a discount we never gave, so they come back separately as
 * `unpricedN` and the UI says out loud how much N is missing a price.
 */
export function rollup(lines: PriceLine[], end: RangeEnd): RateRollup {
  let revenue = 0
  let pricedN = 0
  let unpricedN = 0
  for (const line of lines) {
    const n = nAt(line, end)
    if (line.rate == null) {
      unpricedN += n
      continue
    }
    revenue += line.rate * n
    pricedN += n
  }
  return { revenue, pricedN, unpricedN, blended: pricedN > 0 ? revenue / pricedN : null }
}

/** Blended $/N at one end of the range = Σ(rate × N) ÷ ΣN over priced lines.
 *  null when nothing at that end is both priced and non-zero. */
export function blendedRate(lines: PriceLine[], end: RangeEnd): number | null {
  return rollup(lines, end).blended
}

/**
 * Contract value = Σ(rate × n_target) .. Σ(rate × n_target_max).
 *
 * null when no line is priced — an unpriced project has NO contract value, which
 * is a different statement from a contract worth $0 and must not render as one.
 */
export function contractRange(lines: PriceLine[]): { low: number; high: number } | null {
  const lo = rollup(lines, 'min')
  const hi = rollup(lines, 'max')
  if (lo.pricedN === 0 && hi.pricedN === 0) return null
  // The 078 trigger enforces max ≥ min in the database, but this file is pure and
  // gets whatever it is handed — including rows written before that trigger — so
  // order the two ends instead of assuming which one is larger.
  return { low: Math.min(lo.revenue, hi.revenue), high: Math.max(lo.revenue, hi.revenue) }
}

/** Revenue if we invoiced at N collected instead of at target. null until
 *  something priced has actually been collected. */
export function invoicedAtCollected(lines: PriceLine[]): number | null {
  const r = rollup(lines, 'collected')
  return r.pricedN > 0 ? r.revenue : null
}

/**
 * Has any cost actually been recorded for this project?
 *
 * `actual_spend` is nullable, and recompute_project_spend writes 0 when a project
 * has no blast, supplier or cost line at all — so null and 0 both mean "nothing
 * logged yet", not "this study is free". Margin computed against either is the
 * contract value wearing a green 100%, which is the most flattering possible
 * reading of "we have no idea what this costs". Callers ask this BEFORE dressing a
 * margin up as a percentage; a study genuinely run for nothing is
 * indistinguishable here, and labelling that one indicative too is the cheap error.
 */
export function hasRecordedCost(actualSpend: number | null | undefined): boolean {
  return actualSpend != null && actualSpend > 0
}

/**
 * Margin = revenue − actual cost. `actualSpend` is survey_projects.actual_spend,
 * the trigger-maintained Σ(blast bid × completes) + Σ(supplier CPI × collected) +
 * Σ(flat cost lines), so this is margin against money already committed — not a
 * forecast against the budget ceiling.
 *
 * A null spend counts as 0 so the arithmetic stays total-able at both ends of the
 * range. That is NOT the same as knowing the cost is zero — see hasRecordedCost(),
 * which is what stops the widget presenting an unknown cost as pure profit.
 */
export function margin(revenue: number, actualSpend: number | null | undefined): number {
  return revenue - (actualSpend ?? 0)
}

/** Margin as a percentage of revenue. null when there is no revenue to divide
 *  by — an unpriced project's margin percentage is undefined, not −100%. */
export function marginPct(revenue: number, actualSpend: number | null | undefined): number | null {
  if (revenue <= 0) return null
  return (margin(revenue, actualSpend) / revenue) * 100
}

/** Margin at both ends of the contract range. null when the project is unpriced. */
export function marginRange(
  lines: PriceLine[],
  actualSpend: number | null | undefined,
): { low: number; high: number } | null {
  const c = contractRange(lines)
  if (!c) return null
  return { low: margin(c.low, actualSpend), high: margin(c.high, actualSpend) }
}

/**
 * The budget is a COST CEILING, so it is never checked against the contract for
 * agreement — they are opposite sides of the ledger and there is nothing wrong
 * with them differing. The one thing worth flagging: a ceiling ABOVE the
 * contract's FLOOR value means we have authorised ourselves to spend more than
 * the job earns at the N we actually committed to, so spending the full budget
 * is a guaranteed loss.
 *
 * Compared against the low end deliberately — the high end assumes the client
 * takes the full range, which is the optimistic case and not what a ceiling
 * should be sanity-checked against. Returns the overshoot in dollars, or null
 * when the ceiling is safely under (or either side is unset).
 */
export function ceilingOvershoot(
  budget: number | null | undefined,
  contractLow: number | null | undefined,
): number | null {
  if (budget == null || budget <= 0 || contractLow == null) return null
  return budget > contractLow ? budget - contractLow : null
}

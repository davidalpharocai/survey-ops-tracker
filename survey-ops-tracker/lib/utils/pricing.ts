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
export type RangeEnd = 'min' | 'max' | 'collected' | 'billable'

export interface PriceLine {
  /** Effective $ per completed response — the segment's own rate, or the project
   *  default it inherits. null when neither is set. */
  rate: number | null
  /** N at the low end of the range (n_target — the contracted minimum). */
  nMin: number | null
  /** N at the high end (n_target_max). */
  nMax: number | null
  /** N banked so far — the RAW count, before cleaning. */
  nCollected?: number | null
  /** The CLEANED final N. This, not nCollected, is what the client is billed on
   *  (David 2026-09-10). Falls back to nCollected while a study is still in the
   *  field and no cleaned figure exists yet. */
  nActual?: number | null
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
  if (end === 'billable') return billableNOf(line)
  return (end === 'max' ? (line.nMax ?? line.nMin) : line.nMin) ?? 0
}

/**
 * The N this line can actually be INVOICED for.
 *
 *   billable = min(cleaned N delivered, the target the client asked for)
 *
 * TWO RULES, BOTH FROM DAVID 2026-09-10, AND THE CODE HONOURED NEITHER:
 *
 *   1. CAP AT TARGET. "any N delivered above the target is not charged to the
 *      client." Over-delivery is work we paid for and cannot bill.
 *   2. BILL THE CLEANED N. "The N actual is then what we bill the client."
 *      n_collected is the raw count; n_actual is what survives cleaning.
 *
 * Measured on the twenty projects whose rate was recovered from email, invoicing
 * at raw uncapped n_collected overstated revenue by $44,326 against these rules —
 * 36% high. PR00371 is the extreme: 1,114 collected, 533 actual, 500 target, so
 * the old figure billed 1,114 N and the true billable is 500.
 *
 * The cap is the TOP of the target range (nMax), not the bottom: a range means
 * the client asked for up to that many, so delivering inside the range is
 * billable and only delivery ABOVE the range is the give-away. Only 12 of 395
 * live projects carry a range at all, so this choice moves little today — but it
 * is the reading of "the target is what the client asked for".
 */
function billableNOf(line: PriceLine): number {
  const delivered = line.nActual ?? line.nCollected ?? 0
  const cap = line.nMax ?? line.nMin
  return cap == null ? delivered : Math.min(delivered, cap)
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
 *  something priced has actually been collected.
 *  NOT what the client owes — see invoicedBillable. Kept because the raw
 *  collected figure is still worth showing beside the billable one. */
export function invoicedAtCollected(lines: PriceLine[]): number | null {
  const r = rollup(lines, 'collected')
  return r.pricedN > 0 ? r.revenue : null
}

/** What the client is ACTUALLY invoiced: Σ(rate × min(n_actual, target)).
 *  null until something priced has been delivered. */
export function invoicedBillable(lines: PriceLine[]): number | null {
  const r = rollup(lines, 'billable')
  return r.pricedN > 0 ? r.revenue : null
}

/**
 * N delivered above the target, and what it would have been worth.
 *
 * This is the margin leak nothing in SOCC showed before: work we paid to collect
 * and cannot invoice. Returns zeroes rather than null when there is no overage,
 * because "none" is a real and reassuring answer that deserves rendering.
 */
export function overage(lines: PriceLine[]): { n: number; dollars: number } {
  let n = 0
  let dollars = 0
  for (const line of lines) {
    const delivered = line.nActual ?? line.nCollected ?? 0
    const cap = line.nMax ?? line.nMin
    if (cap == null) continue
    const extra = Math.max(0, delivered - cap)
    if (extra === 0) continue
    n += extra
    if (line.rate != null) dollars += line.rate * extra
  }
  return { n, dollars }
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

/**
 * What will this survey actually DELIVER?
 *
 * David, 2026-09-17: "the N vs target should be the N actual if its filled in.
 * otherwise it should be an estimated number based on the average % we throw
 * away in QA and what the target is. for example, if the PS survey target is
 * 1000 and we collected 2000, it shouldnt be 2000/1000; rather, it should be an
 * estimated number closer to the 1000 … then you put a note on that line item
 * stating that the anticipated N Actual vs target is estimated based on x".
 *
 * ── THE OBVIOUS FORMULA IS THE WORST OF THE THREE ───────────────────────────
 * "Apply the QA keep rate to what was collected" is the natural reading, and it
 * loses. Replayed against the 134 delivered surveys that over-collected:
 *
 *     estimator                              median abs error
 *     ≈ target                                     6.3%
 *     min(collected x keep, target)                9.0%
 *     collected x keep                            10.0%
 *
 * Because a study that over-collects does not deliver everything it bought — it
 * delivers roughly what was sold. n_actual ÷ n_target on those 134 surveys has
 * a MEDIAN of 1.033 (p25 1.000, p75 1.200). PR00231 is the extreme: 5,342
 * collected against an 800 target, 342 delivered. Scaling its collection by a
 * keep rate predicts 4,637.
 *
 * The mirror case behaves differently and needs its own rule. On the 54 surveys
 * that finished at or under target, n_actual ÷ n_collected has a median of
 * 1.000 — when you have not got enough, essentially everything ships. So the
 * estimator is piecewise, because the underlying behaviour is.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
 * It does not pace against the delivery date. Only 19 of 48 in-flight surveys
 * carry a deliver_date or due_date to pace against, so a pacing term would be
 * unavailable on most of the rows that need the estimate and would look like a
 * measurement where it fired. The window is reported as CONTEXT on the note
 * when a date exists, and never folded into the number.
 */

export interface DeliveryInput {
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
  /** For the note only — never part of the arithmetic. */
  deliver_date?: string | null
  due_date?: string | null
}

/**
 * Measured on delivered surveys, 2026-09-17. Recomputed rather than assumed
 * when a caller passes its own — see `DeliveryStats`.
 *
 * These are ratios of MEDIANS over whole surveys, not a pooled ratio: one study
 * that scrubbed 94% of its collection would otherwise set the expectation for
 * everyone.
 */
export interface RatioBand {
  p25: number
  median: number
  p75: number
  /** Surveys behind it. Carried so a caller can refuse to use a band drawn
   *  from too few of them. */
  n: number
}

export interface DeliveryStats {
  /** n_actual ÷ n_target on surveys that collected AT OR ABOVE target. */
  overTargetRatio: RatioBand
  /** n_actual ÷ n_collected on surveys that finished BELOW target. */
  underTargetRatio: RatioBand
}

/** Not `as const`: measureDeliveryStats returns computed numbers in this shape,
 *  and a literal type would make the live measurement unassignable to the
 *  constant it is meant to replace. */
export const DELIVERY_STATS: DeliveryStats = {
  overTargetRatio: { p25: 1.000, median: 1.033, p75: 1.200, n: 134 },
  underTargetRatio: { p25: 0.898, median: 1.000, p75: 1.000, n: 54 },
}

export interface DeliveredN {
  /** The number to show against target. */
  value: number
  /** False when n_actual was recorded — then `value` IS n_actual and no note
   *  is needed. True when this is a projection. */
  estimated: boolean
  /** Plausible range, from the p25/p75 of the same comparison. Shown so the
   *  estimate never reads as a measurement. Null when not estimated. */
  low: number | null
  high: number | null
  /** Which behaviour the estimate came from, so the note can say it. */
  basis: 'recorded' | 'at-or-over-target' | 'short-of-target' | null
  /** The sentence for the line item. Empty when `value` is recorded. */
  note: string
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The delivered-N figure for one survey: recorded where it exists, projected
 * where it does not.
 *
 * Returns null only when there is nothing to say — no collection and no
 * recorded actual. A survey with no target still gets a figure, because
 * "collected 400" is useful even when nothing was promised; it simply cannot
 * be compared to anything.
 */
export function deliveredN(
  p: DeliveryInput,
  stats: DeliveryStats = DELIVERY_STATS,
): DeliveredN | null {
  const actual = num(p.n_actual)
  // Recorded beats projected, always. This is the half David had to ask for
  // twice: the row was showing n_collected even where n_actual existed.
  if (actual != null) {
    return { value: actual, estimated: false, low: null, high: null, basis: 'recorded', note: '' }
  }

  const collected = num(p.n_collected)
  if (collected == null) return null
  const target = num(p.n_target)

  // No target: nothing to project TOWARD, so report the collection as-is and
  // say it is unQA'd rather than inventing a ratio.
  if (target == null || target <= 0) {
    return {
      value: collected, estimated: true, low: null, high: null, basis: 'short-of-target',
      note: `${fmt(collected)} collected and not yet through QA. No target is set on this survey, so there is nothing to project against.`,
    }
  }

  if (collected >= target) {
    const r = stats.overTargetRatio
    const window = dateNote(p)
    return {
      value: Math.round(target * r.median),
      estimated: true,
      low: Math.round(target * r.p25),
      high: Math.round(target * r.p75),
      basis: 'at-or-over-target',
      note:
        `Estimated. ${fmt(collected)} collected against a ${fmt(target)} target, but a study that ` +
        `over-collects delivers roughly what it sold, not everything it bought: across ${r.n} past ` +
        `surveys the delivered N came in at a median ${r.median.toFixed(2)}x target ` +
        `(${r.p25.toFixed(2)}–${r.p75.toFixed(2)}x). QA has not run yet.` + window,
    }
  }

  const r = stats.underTargetRatio
  const window = dateNote(p)
  return {
    value: Math.round(collected * r.median),
    estimated: true,
    low: Math.round(collected * r.p25),
    high: Math.round(collected * r.p75),
    basis: 'short-of-target',
    note:
      `Estimated. ${fmt(collected)} collected against a ${fmt(target)} target. A study still short ` +
      `of target loses almost nothing in QA — across ${r.n} past surveys the delivered N was a ` +
      `median ${r.median.toFixed(2)}x what was collected (${r.p25.toFixed(2)}–${r.p75.toFixed(2)}x) ` +
      `— so this is a collection problem, not a QA one.` + window,
  }
}

/**
 * The delivery window, as CONTEXT on the note and never in the arithmetic.
 *
 * Only 19 of 48 in-flight surveys carry a date to pace against, so a pacing
 * term folded into the number would be unavailable on most of the rows that
 * need it — and a figure that silently changes meaning depending on whether a
 * date happens to be filled in is worse than one that does not use dates.
 */
function dateNote(p: DeliveryInput): string {
  const d = p.deliver_date || p.due_date
  return d ? ` Due ${d}.` : ''
}

/**
 * Recompute the two ratios from a set of delivered surveys.
 *
 * The constants above were measured once; this lets the app sharpen them from
 * its own current book instead of carrying a number that ages. Falls back to
 * the shipped constants for whichever half has too few surveys to speak for
 * itself — a percentile over four surveys is noise wearing a number's clothes.
 */
export const MIN_STATS_N = 20

export function measureDeliveryStats(
  rows: DeliveryInput[], fallback: DeliveryStats = DELIVERY_STATS,
): DeliveryStats {
  const over: number[] = [], under: number[] = []
  for (const p of rows) {
    const t = num(p.n_target), c = num(p.n_collected), a = num(p.n_actual)
    if (t == null || c == null || a == null || t <= 0 || c <= 0) continue
    if (c >= t) over.push(a / t); else under.push(a / c)
  }
  const q = (xs: number[], pp: number) => {
    const s = xs.slice().sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.floor(s.length * pp))]
  }
  return {
    overTargetRatio: over.length >= MIN_STATS_N
      ? { p25: q(over, 0.25), median: q(over, 0.5), p75: q(over, 0.75), n: over.length }
      : fallback.overTargetRatio,
    underTargetRatio: under.length >= MIN_STATS_N
      ? { p25: q(under, 0.25), median: q(under, 0.5), p75: q(under, 0.75), n: under.length }
      : fallback.underTargetRatio,
  }
}

// Over-delivery check (SOFT advisory) — "you already have enough, stop fielding".
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// Revenue is rate x min(n_actual, n_target): delivery ABOVE the target is not
// chargeable to the client (David, 2026-09-10). We still pay for it — the reward
// on every extra complete and the postage that bought them. Measured across the
// book on 2026-09-11: 27,749 N delivered above target, 18.3% of everything ever
// delivered, and $60,161 of recorded spend that bought nothing billable.
//
// Nothing in SOCC says so at the moment it matters, which is BEFORE the next
// blast goes out. Reruns are the proof that the discipline works when it is
// applied: 1 N of overshoot across 25 projects, against ~19% on both other
// routes. The difference is not the audience, it is that somebody stops.
//
// ── WHY NOT SIMPLY "COLLECTED >= TARGET" ────────────────────────────────────
// Because collected N is the RAW count and cleaning removes a fifth of it.
// Measured over the 181 projects carrying both figures:
//
//     volume-weighted keep rate   79.5%   (cleaning loses 20.5%)
//     B2B   85.5%      PS   78.0%      Rerun  93.2%
//
// So a study needs roughly 1.17x (B2B) to 1.28x (PS) its target in raw completes
// to actually DELIVER the target. Warning the moment raw completes cross 1.0x
// would have fired on 31 of 177 projects that were genuinely still short — an
// 18% false-positive rate, on a warning whose entire value is being believed.
//
// !! THIS DETECTOR IS DELIBERATELY BIASED TOWARD SILENCE, for the same reason
// !! nFloor is: a missed warning costs one conversation, but a warning that
// !! fires on a correctly-run study teaches the team to click through every
// !! warning this app will ever show them. Raise the thresholds rather than
// !! lower them if this ever gets noisy.
//
// ── WHICH SIGNAL, IN ORDER OF TRUST ─────────────────────────────────────────
//  1. n_actual, once fielding is over. A fact; nothing to predict.
//  2. n_internal_target x 1.25. The cushion the team set THEMSELVES, so it
//     already encodes this study's screen-out rate. 91% precision.
//  3. collected x keepRate(route) vs target x 1.1. Only when neither of the
//     above exists, because a route average is weak: real keep rates run from
//     6% (PR00231: 5,342 raw -> 342 delivered) to 100%.
//
// A raw-count rule was tried and rejected at 63% precision. 40 of 177 finished
// projects deliver EXACTLY their target because the team over-collects on
// purpose and cleans down — a raw rule reads every one of those as a problem.

import { fmtNum } from '@/lib/utils/number'

/** Measured share of raw completes that survives cleaning, by route.
 *  Derived 2026-09-11 from the 181 projects carrying both n_collected and
 *  n_actual; volume-weighted, not a mean of ratios, so large studies dominate
 *  as they should. Re-derive with scripts/_cleaning-loss.mjs. */
export const KEEP_RATE: Record<string, number> = {
  B2B: 0.855,
  PS: 0.780,
  Rerun: 0.932,
}
/** Used when project_type is missing or unrecognised — the whole-book figure. */
export const KEEP_RATE_DEFAULT = 0.795

/** How far past target projected delivery must go before we say anything, when
 *  there is no internal target to measure against. */
export const OVER_TARGET_MARGIN = 1.1

/** THE PRIMARY SIGNAL. `n_internal_target` is the cushion the team sets itself —
 *  literally their own answer to "how much raw do we need to deliver the
 *  target" — so it beats any keep rate this module could estimate. Backtested
 *  over the 109 finished projects that carry one:
 *
 *      raw >= internal x 1.00   precision 63%   29 false alarms
 *      raw >= internal x 1.25   precision 91%    2 false alarms   <- chosen
 *      raw >= internal x 1.50   precision 100%   0 false alarms
 *
 *  1.25 rather than 1.5 because at 1.5 recall falls to 26% and the warning stops
 *  being worth wiring up. Re-derive with scripts/_overtarget-v2.mjs.
 *
 *  For comparison the naive "raw >= n_target" rule scores 63% precision — it
 *  fires on 33 projects that were still short. 40 of 177 finished projects
 *  deliver EXACTLY their target, because the team over-collects on purpose and
 *  cleans down; a raw-count rule reads all of that as over-delivery. */
export const INTERNAL_TARGET_MARGIN = 1.25

export type OverTargetVerdict =
  | { over: false; reason: 'no-target' | 'no-data' | 'under' }
  | {
      over: true
      /** Raw completes banked so far. */
      collected: number
      /** collected x keepRate — what we expect to actually deliver. */
      projected: number
      target: number
      /** Projected delivery above target. Never negative. */
      excess: number
      keepRate: number
      /** Human sentence for the UI and the connector. */
      message: string
    }

export interface OverTargetInput {
  n_target: number | null | undefined
  /** Raw completes banked. Prefer the project's n_collected. */
  n_collected: number | null | undefined
  /** The team's own raw-completes cushion. When present this is the signal used,
   *  because it is their judgement of this study's screen-out rate rather than a
   *  route average that swings from 6% to 100% between studies. */
  n_internal_target?: number | null
  /** Cleaned figure, when fielding is already finished. Overrides the estimate:
   *  a known delivered N does not need projecting from a keep rate. */
  n_actual?: number | null
  project_type?: string | null
  /** What the next blast is expected to cost, if known — turns the warning from
   *  an observation into a price. */
  nextBlastCost?: number | null
}

/**
 * Should we warn before more fielding is bought?
 *
 * NULL-SAFE BY DESIGN. A missing target or a missing collected count returns
 * `over: false` with a reason, never a warning — an unknown is not a problem,
 * and guessing here is how a detector loses its credibility.
 */
export function overTargetCheck(input: OverTargetInput): OverTargetVerdict {
  const target = Number(input.n_target ?? 0)
  if (!Number.isFinite(target) || target <= 0) return { over: false, reason: 'no-target' }

  const collected = Number(input.n_collected ?? 0)
  const actual = input.n_actual == null ? null : Number(input.n_actual)
  if ((!Number.isFinite(collected) || collected <= 0) && actual == null) {
    return { over: false, reason: 'no-data' }
  }

  const keepRate = KEEP_RATE[String(input.project_type ?? '')] ?? KEEP_RATE_DEFAULT
  const internal = Number(input.n_internal_target ?? 0)

  /* THREE SIGNALS, BEST FIRST.
     1. A known cleaned figure — fielding is over, there is nothing to predict.
     2. The team's own internal target — their judgement of THIS study's
        screen-out rate. 91% precision against 63% for a raw-count rule.
     3. A route keep rate — only when neither of the above exists. Weakest,
        because the real keep rate ranges from 6% to 100% between studies. */
  const projected = actual != null && actual > 0 ? actual : collected * keepRate

  const fired =
    actual != null && actual > 0
      ? actual > target
      : internal > 0
        ? collected >= internal * INTERNAL_TARGET_MARGIN
        : projected >= target * OVER_TARGET_MARGIN

  if (!fired) return { over: false, reason: 'under' }

  const excess = Math.max(0, Math.round(projected - target))
  const pct = Math.round((projected / target - 1) * 100)
  const cost = input.nextBlastCost
  const costLine =
    cost != null && cost > 0
      ? ` This blast adds about $${cost.toLocaleString('en-US', { maximumFractionDigits: 0 })} that cannot be invoiced.`
      : ''

  return {
    over: true,
    collected: Math.round(collected),
    projected: Math.round(projected),
    target,
    excess,
    keepRate,
    message:
      `Already on track to deliver about ${fmtNum(Math.round(projected))} against a target of ` +
      `${fmtNum(target)} — roughly ${fmtNum(excess)} N (${pct}%) more than the client is billed for. ` +
      `Delivery above target is not chargeable.${costLine}`,
  }
}

/** The cost of one blast, for nextBlastCost. Mirrors migration 095's formula:
 *  reward on those who finish, plus postage on everyone it reaches. */
export function estimateBlastCost(opts: {
  bid?: number | null
  people?: number | null
  completes?: number | null
  cost_per_send?: number | null
}): number | null {
  const people = Number(opts.people ?? 0)
  const bid = Number(opts.bid ?? 0)
  const send = Number(opts.cost_per_send ?? 0)
  const completes = opts.completes == null ? null : Number(opts.completes)
  if (people <= 0 && (completes == null || completes <= 0)) return null
  // Before a blast has sent, its completes are unknown. Postage alone is the
  // floor and is certain; stating a floor beats inventing a response rate.
  return (completes != null ? bid * completes : 0) + people * send
}

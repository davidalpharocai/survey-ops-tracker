import type { Tables } from '@/lib/supabase/types'

export type Blast = Tables<'project_blasts'>

/** The three hand-entered figures on a blast, any of which may be unrecorded. */
type BlastFigures = { bid?: number | null; completes?: number | null }

/**
 * NULL vs 0 on a blast (migration 091). `bid`, `people` and `completes` are
 * nullable, and the two values mean different things:
 *   · 0    — recorded, and it really was zero.
 *   · NULL — NOT RECORDED YET. Completes trickle in for days after a send and
 *            are typed in by hand, so unknown is the common state, not zero.
 * Everything below keeps that distinction, because collapsing it is what made 8
 * of 12 blast projects report $0 spend while collecting real N, and made 13 of
 * 18 blasts show a 0.00% response rate they never had. Same discipline as
 * project_financials.price_per_n (migration 082): unknown renders as unknown,
 * never as zero.
 *
 * There are therefore TWO cost functions, and picking the wrong one is the whole
 * bug class:
 *   · `blastTotal` / `totalBidDollars` — mirror the SQL. Use for reconciling
 *     against survey_projects.actual_spend.
 *   · `blastCost` / `unknownCostBlasts` — for DISPLAY. Use anywhere a human
 *     reads the number and would take $0 as a fact.
 */

/**
 * Cost of one blast AS THE DATABASE COMPUTES IT = $/bid × # of COMPLETES, with
 * an unrecorded figure counted as 0. The bid is a per-completion reward, so we
 * only pay for people who actually completed the survey — not everyone it was
 * sent to (`people` is the reach, informational only).
 *
 * This deliberately mirrors recompute_project_spend (migration 060, third term
 * added by 080, coalesced by 091): `sum(coalesce(bid,0) * coalesce(completes,0))`.
 * Its callers reconcile against the stored actual_spend, so it MUST agree with
 * the SQL to the cent — including agreeing that an unrecorded blast adds nothing.
 *
 * NOT for display. A blast with unrecorded completes returns 0 here, and 0 shown
 * to a human reads as "this blast cost nothing", which is a claim we cannot make.
 * Use `blastCost` for anything on screen.
 */
export function blastTotal(b: BlastFigures): number {
  return (b.bid ?? 0) * (b.completes ?? 0)
}

/**
 * True when a blast's cost is UNKNOWN rather than zero: either the reward or the
 * completes count has never been recorded, so $/bid × completes has no answer.
 */
export function isBlastCostUnknown(b: BlastFigures): boolean {
  return b.bid == null || b.completes == null
}

/**
 * Cost of one blast FOR DISPLAY — $/bid × completes, or `null` when either
 * figure is unrecorded. Callers must render null as "not recorded"/an em dash,
 * never as $0. (A recorded bid with recorded completes of 0 correctly returns 0:
 * that send genuinely cost nothing.)
 */
export function blastCost(b: BlastFigures): number | null {
  return isBlastCostUnknown(b) ? null : (b.bid as number) * (b.completes as number)
}

/** Total blast spend for a project = Σ($/bid × # completes), mirroring the SQL —
 *  an unrecorded figure contributes 0, exactly as `sum()` skipping a NULL row
 *  does. Pair it with `unknownCostBlasts` before showing it to anyone: on its own
 *  it is a FLOOR, not the cost. */
export function totalBidDollars(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + blastTotal(b), 0)
}

/** How many of these blasts have an unknown cost — i.e. how much of
 *  `totalBidDollars` is missing rather than zero. 0 means the total is complete. */
export function unknownCostBlasts(blasts: BlastFigures[]): number {
  return blasts.reduce((n, b) => n + (isBlastCostUnknown(b) ? 1 : 0), 0)
}

/** Total # of people reached across all blasts (unrecorded reach adds nothing). */
export function totalPeople(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + (b.people ?? 0), 0)
}

/** Total # of completed responses across all blasts (unrecorded adds nothing). */
export function totalCompletes(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + (b.completes ?? 0), 0)
}

/** Blended $/bid = total spend ÷ total completes (the effective $ paid per
 *  completed response); null if there are no completes yet. */
export function blendedBid(blasts: Blast[]): number | null {
  const c = totalCompletes(blasts)
  return c > 0 ? totalBidDollars(blasts) / c : null
}

/** All-in cost per collected N = total blast $ ÷ N collected; null if none. */
export function costPerN(totalBid: number, nCollected: number): number | null {
  return nCollected > 0 ? totalBid / nCollected : null
}

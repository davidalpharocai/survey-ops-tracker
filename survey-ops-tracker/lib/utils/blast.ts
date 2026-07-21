import type { Tables } from '@/lib/supabase/types'

export type Blast = Tables<'project_blasts'>

/**
 * Cost of one blast = $/bid × # of COMPLETES. The bid is a per-completion
 * reward, so we only pay for people who actually completed the survey — not
 * everyone it was sent to (`people` is the reach, informational only).
 */
export function blastTotal(b: { bid?: number | null; completes?: number | null }): number {
  return (b.bid ?? 0) * (b.completes ?? 0)
}

/** Total blast spend for a project = Σ($/bid × # completes). */
export function totalBidDollars(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + blastTotal(b), 0)
}

/** Total # of people reached across all blasts. */
export function totalPeople(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + (b.people ?? 0), 0)
}

/** Total # of completed responses across all blasts. */
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

import type { Tables } from '@/lib/supabase/types'

export type Blast = Tables<'project_blasts'>

/** Cost of one blast = $/bid × # of people it went to. */
export function blastTotal(b: { bid?: number | null; people?: number | null }): number {
  return (b.bid ?? 0) * (b.people ?? 0)
}

/** Total blast spend for a project = Σ($/bid × # of people). */
export function totalBidDollars(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + blastTotal(b), 0)
}

/** Total # of people across all blasts. */
export function totalPeople(blasts: Blast[]): number {
  return blasts.reduce((s, b) => s + (b.people ?? 0), 0)
}

/** Blended $/bid = total spend ÷ total people; null if there are no people. */
export function blendedBid(blasts: Blast[]): number | null {
  const p = totalPeople(blasts)
  return p > 0 ? totalBidDollars(blasts) / p : null
}

/** All-in cost per completed N = total blast $ ÷ N collected; null if no completes. */
export function costPerN(totalBid: number, nCollected: number): number | null {
  return nCollected > 0 ? totalBid / nCollected : null
}

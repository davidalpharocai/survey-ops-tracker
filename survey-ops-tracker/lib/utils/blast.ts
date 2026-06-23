import type { Tables } from '@/lib/supabase/types'

export type Blast = Tables<'project_blasts'>

/** Total cost of one blast = (# delivered × $/bid) + the fixed blast fee. */
export function blastTotal(b: Pick<Blast, 'delivered' | 'bid' | 'blast_cost'>): number {
  return (b.delivered ?? 0) * (b.bid ?? 0) + (b.blast_cost ?? 0)
}

/** Sum of every blast's total — the project's actual spend ("Total bid $" / "Actual $"). */
export function totalBidDollars(blasts: Blast[]): number {
  return blasts.reduce((sum, b) => sum + blastTotal(b), 0)
}

/** Sum of # delivered across blasts. */
export function totalDelivered(blasts: Blast[]): number {
  return blasts.reduce((sum, b) => sum + (b.delivered ?? 0), 0)
}

/** Sum of the fixed blast fees across blasts. */
export function totalBlastFees(blasts: Blast[]): number {
  return blasts.reduce((sum, b) => sum + (b.blast_cost ?? 0), 0)
}

/** Average $/bid weighted by # delivered; null if nothing delivered. */
export function weightedAvgBid(blasts: Blast[]): number | null {
  const d = totalDelivered(blasts)
  if (d <= 0) return null
  return blasts.reduce((sum, b) => sum + (b.bid ?? 0) * (b.delivered ?? 0), 0) / d
}

/** Simple mean of each blast's $/bid; null if there are no blasts. */
export function avgBid(blasts: Blast[]): number | null {
  if (blasts.length === 0) return null
  return blasts.reduce((sum, b) => sum + (b.bid ?? 0), 0) / blasts.length
}

/** All-in cost per completed N = total bid $ ÷ N collected; null if no completes. */
export function costPerN(totalBid: number, nCollected: number): number | null {
  return nCollected > 0 ? totalBid / nCollected : null
}

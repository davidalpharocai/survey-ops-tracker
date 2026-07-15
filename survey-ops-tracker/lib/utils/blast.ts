import type { Tables } from '@/lib/supabase/types'

export type Blast = Tables<'project_blasts'>

/** Only SENT blasts count toward spend (queued/scheduled are planned, not spent). */
export const isSent = (b: Pick<Blast, 'status'>) => b.status === 'sent'

/** Cost of one blast = delivered×$/bid + fixed fee + delivered×reward (incentive). */
export function blastTotal(b: Pick<Blast, 'delivered' | 'bid' | 'blast_cost'> & { reward?: number | null }): number {
  const d = b.delivered ?? 0
  return d * (b.bid ?? 0) + (b.blast_cost ?? 0) + d * (b.reward ?? 0)
}

const sent = (blasts: Blast[]) => blasts.filter(isSent)

/** Sum of every SENT blast's total — the project's actual spend ("Total bid $"). */
export function totalBidDollars(blasts: Blast[]): number {
  return sent(blasts).reduce((s, b) => s + blastTotal(b), 0)
}

/** Sum of # delivered across SENT blasts. */
export function totalDelivered(blasts: Blast[]): number {
  return sent(blasts).reduce((s, b) => s + (b.delivered ?? 0), 0)
}

/** Sum of the fixed blast fees across SENT blasts. */
export function totalBlastFees(blasts: Blast[]): number {
  return sent(blasts).reduce((s, b) => s + (b.blast_cost ?? 0), 0)
}

/** Sum of the per-respondent incentives (reward × delivered) across SENT blasts. */
export function totalIncentives(blasts: Blast[]): number {
  return sent(blasts).reduce((s, b) => s + (b.delivered ?? 0) * (b.reward ?? 0), 0)
}

/** Average $/bid weighted by # delivered across SENT blasts; null if nothing delivered. */
export function weightedAvgBid(blasts: Blast[]): number | null {
  const d = totalDelivered(blasts)
  if (d <= 0) return null
  return sent(blasts).reduce((s, b) => s + (b.bid ?? 0) * (b.delivered ?? 0), 0) / d
}

/** Simple mean of each SENT blast's $/bid; null if there are no sent blasts. */
export function avgBid(blasts: Blast[]): number | null {
  const s = sent(blasts)
  if (s.length === 0) return null
  return s.reduce((sum, b) => sum + (b.bid ?? 0), 0) / s.length
}

/** All-in cost per completed N = total bid $ ÷ N collected; null if no completes. */
export function costPerN(totalBid: number, nCollected: number): number | null {
  return nCollected > 0 ? totalBid / nCollected : null
}

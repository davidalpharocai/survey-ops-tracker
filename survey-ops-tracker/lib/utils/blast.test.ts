import { describe, it, expect } from 'vitest'
import {
  blastTotal,
  totalBidDollars,
  totalDelivered,
  totalBlastFees,
  totalIncentives,
  weightedAvgBid,
  avgBid,
  costPerN,
} from './blast'
import type { Blast } from './blast'

const b = (o: Partial<Blast>): Blast =>
  ({ delivered: 0, bid: 0, blast_cost: 0, reward: 0, status: 'sent', ...o }) as Blast

// 300 delivered @ $8 + $150 fee, 100 @ $12 + $100. Both sent, no incentive.
const blasts = [b({ delivered: 300, bid: 8, blast_cost: 150 }), b({ delivered: 100, bid: 12, blast_cost: 100 })]

describe('blastTotal', () => {
  it('is (# × bid) + fee + (# × reward)', () => {
    expect(blastTotal(blasts[0])).toBe(2550)
    expect(blastTotal(blasts[1])).toBe(1300)
    expect(blastTotal(b({ delivered: 100, bid: 5, blast_cost: 0, reward: 2 }))).toBe(700) // 500 + 200 incentive
  })
})

describe('aggregates (sent only)', () => {
  it('totalBidDollars sums sent blast totals', () => {
    expect(totalBidDollars(blasts)).toBe(3850)
  })
  it('totalDelivered sums delivered', () => {
    expect(totalDelivered(blasts)).toBe(400)
  })
  it('totalBlastFees sums fixed fees', () => {
    expect(totalBlastFees(blasts)).toBe(250)
  })
  it('totalIncentives = Σ delivered × reward', () => {
    expect(totalIncentives([b({ delivered: 100, reward: 2 }), b({ delivered: 50, reward: 3 })])).toBe(350)
  })
  it('ignores queued/scheduled blasts entirely', () => {
    const withQueued = [...blasts, b({ delivered: 999, bid: 99, blast_cost: 999, reward: 9, status: 'queued' })]
    expect(totalBidDollars(withQueued)).toBe(3850)
    expect(totalDelivered(withQueued)).toBe(400)
    expect(totalIncentives(withQueued)).toBe(0)
  })
})

describe('bid rates (sent only)', () => {
  it('weightedAvgBid weights by delivered', () => {
    expect(weightedAvgBid(blasts)).toBe(9) // (300*8 + 100*12) / 400
  })
  it('avgBid is the simple mean', () => {
    expect(avgBid(blasts)).toBe(10) // (8 + 12) / 2
  })
  it('returns null with no sent blasts / no delivery', () => {
    expect(weightedAvgBid([])).toBeNull()
    expect(avgBid([])).toBeNull()
    expect(weightedAvgBid([b({ delivered: 0, bid: 5 })])).toBeNull()
    expect(avgBid([b({ status: 'queued', bid: 5 })])).toBeNull() // queued excluded
  })
})

describe('costPerN', () => {
  it('is total bid ÷ N collected (all-in)', () => {
    expect(costPerN(3850, 350)).toBe(11)
  })
  it('is null when nothing collected', () => {
    expect(costPerN(3850, 0)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  blastTotal,
  totalBidDollars,
  totalDelivered,
  totalBlastFees,
  weightedAvgBid,
  avgBid,
  costPerN,
} from './blast'
import type { Blast } from './blast'

// The worked example from the design: 300 delivered @ $8 + $150 fee, 100 @ $12 + $100.
const blasts = [
  { delivered: 300, bid: 8, blast_cost: 150 },
  { delivered: 100, bid: 12, blast_cost: 100 },
] as Blast[]

describe('blastTotal', () => {
  it('is (# × bid) + fee', () => {
    expect(blastTotal(blasts[0])).toBe(2550)
    expect(blastTotal(blasts[1])).toBe(1300)
  })
})

describe('aggregates', () => {
  it('totalBidDollars sums the blast totals', () => {
    expect(totalBidDollars(blasts)).toBe(3850)
  })
  it('totalDelivered sums the delivered counts', () => {
    expect(totalDelivered(blasts)).toBe(400)
  })
  it('totalBlastFees sums the fixed fees', () => {
    expect(totalBlastFees(blasts)).toBe(250)
  })
})

describe('bid rates', () => {
  it('weightedAvgBid weights by delivered', () => {
    expect(weightedAvgBid(blasts)).toBe(9) // (300*8 + 100*12) / 400
  })
  it('avgBid is the simple mean', () => {
    expect(avgBid(blasts)).toBe(10) // (8 + 12) / 2
  })
  it('returns null with no blasts / no delivery', () => {
    expect(weightedAvgBid([])).toBeNull()
    expect(avgBid([])).toBeNull()
    expect(weightedAvgBid([{ delivered: 0, bid: 5, blast_cost: 0 } as Blast])).toBeNull()
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

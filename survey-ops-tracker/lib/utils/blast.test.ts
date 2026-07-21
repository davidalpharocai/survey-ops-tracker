import { describe, it, expect } from 'vitest'
import { blastTotal, totalBidDollars, totalPeople, totalCompletes, blendedBid, costPerN } from './blast'
import type { Blast } from './blast'

const b = (bid: number, people: number, completes: number): Blast =>
  ({ bid, people, completes }) as Blast

// $0.50/bid, sent to 300, 240 completed; and $1.20/bid, sent to 100, 80 completed.
const blasts = [b(0.5, 300, 240), b(1.2, 100, 80)]

describe('blastTotal', () => {
  it('is $/bid × # of completes (not people)', () => {
    expect(blastTotal(blasts[0])).toBe(120) // 0.5 × 240
    expect(blastTotal(blasts[1])).toBeCloseTo(96) // 1.2 × 80
  })
  it('treats missing values as 0', () => {
    expect(blastTotal({})).toBe(0)
    expect(blastTotal({ bid: 2 })).toBe(0) // no completes → $0
    expect(blastTotal({ bid: 2, completes: 0 })).toBe(0)
  })
})

describe('aggregates', () => {
  it('totalBidDollars sums each blast total', () => {
    expect(totalBidDollars(blasts)).toBeCloseTo(216) // 120 + 96
  })
  it('totalPeople sums people reached', () => {
    expect(totalPeople(blasts)).toBe(400)
  })
  it('totalCompletes sums completed responses', () => {
    expect(totalCompletes(blasts)).toBe(320)
  })
  it('blendedBid = total spend ÷ total completes', () => {
    expect(blendedBid(blasts)).toBeCloseTo(0.675) // 216 / 320
  })
  it('blendedBid is null with no completes', () => {
    expect(blendedBid([])).toBeNull()
    expect(blendedBid([b(5, 100, 0)])).toBeNull()
  })
})

describe('costPerN', () => {
  it('is total blast $ ÷ N collected', () => {
    expect(costPerN(216, 432)).toBe(0.5)
  })
  it('is null when nothing collected', () => {
    expect(costPerN(216, 0)).toBeNull()
  })
})

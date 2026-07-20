import { describe, it, expect } from 'vitest'
import { blastTotal, totalBidDollars, totalPeople, blendedBid, costPerN } from './blast'
import type { Blast } from './blast'

const b = (bid: number, people: number): Blast => ({ bid, people }) as Blast

// $0.50/bid × 300 people, and $1.20/bid × 100 people.
const blasts = [b(0.5, 300), b(1.2, 100)]

describe('blastTotal', () => {
  it('is $/bid × # of people', () => {
    expect(blastTotal(blasts[0])).toBe(150)
    expect(blastTotal(blasts[1])).toBeCloseTo(120)
  })
  it('treats missing values as 0', () => {
    expect(blastTotal({})).toBe(0)
    expect(blastTotal({ bid: 2 })).toBe(0)
  })
})

describe('aggregates', () => {
  it('totalBidDollars sums each blast total', () => {
    expect(totalBidDollars(blasts)).toBeCloseTo(270)
  })
  it('totalPeople sums people', () => {
    expect(totalPeople(blasts)).toBe(400)
  })
  it('blendedBid = total spend ÷ total people', () => {
    expect(blendedBid(blasts)).toBeCloseTo(0.675) // 270 / 400
  })
  it('blendedBid is null with no people', () => {
    expect(blendedBid([])).toBeNull()
    expect(blendedBid([b(5, 0)])).toBeNull()
  })
})

describe('costPerN', () => {
  it('is total blast $ ÷ N collected', () => {
    expect(costPerN(270, 540)).toBe(0.5)
  })
  it('is null when nothing collected', () => {
    expect(costPerN(270, 0)).toBeNull()
  })
})

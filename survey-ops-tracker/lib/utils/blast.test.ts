import { describe, it, expect } from 'vitest'
import {
  blastTotal, blastCost, isBlastCostUnknown, unknownCostBlasts,
  totalBidDollars, totalPeople, totalCompletes, blendedBid, costPerN,
} from './blast'
import type { Blast } from './blast'

const b = (bid: number | null, people: number | null, completes: number | null): Blast =>
  ({ bid, people, completes }) as Blast

// $0.50/bid, sent to 300, 240 completed; and $1.20/bid, sent to 100, 80 completed.
const blasts = [b(0.5, 300, 240), b(1.2, 100, 80)]

describe('blastTotal', () => {
  it('is $/bid × # of completes (not people)', () => {
    expect(blastTotal(blasts[0])).toBe(120) // 0.5 × 240
    expect(blastTotal(blasts[1])).toBeCloseTo(96) // 1.2 × 80
  })
  // blastTotal exists to MIRROR recompute_project_spend, where an unrecorded
  // figure contributes nothing (sum() skips a NULL row; migration 091 coalesces
  // it explicitly). Its callers reconcile against the stored actual_spend, so
  // this 0 is required, not sloppy — which is exactly why it must not be the
  // function anything renders. See the blastCost suite below.
  it('counts a missing value as 0, mirroring the SQL sum', () => {
    expect(blastTotal({})).toBe(0)
    expect(blastTotal({ bid: 2 })).toBe(0) // completes unrecorded → adds nothing
    expect(blastTotal({ bid: 2, completes: null })).toBe(0)
    expect(blastTotal({ bid: null, completes: 40 })).toBe(0)
    expect(blastTotal({ bid: 2, completes: 0 })).toBe(0)
  })
})

// The whole point of migration 091: "nobody has recorded this" and "the answer is
// zero" are different facts, and only the second one may be shown as a number.
describe('blastCost — the DISPLAY cost, which must not turn a null into 0', () => {
  it('is $/bid × completes when both are recorded', () => {
    expect(blastCost(blasts[0])).toBe(120)
    expect(blastCost({ bid: 25, completes: 4 })).toBe(100)
  })
  it('is null — not 0 — when completes are unrecorded', () => {
    expect(blastCost({ bid: 25, completes: null })).toBeNull()
    expect(blastCost({ bid: 25 })).toBeNull()
  })
  it('is null when the bid is unrecorded, even with completes in', () => {
    expect(blastCost({ bid: null, completes: 40 })).toBeNull()
  })
  it('is 0 for a RECORDED zero — a blast that genuinely produced nothing', () => {
    expect(blastCost({ bid: 25, completes: 0 })).toBe(0)
    expect(blastCost({ bid: 0, completes: 100 })).toBe(0) // unpaid send
  })
  it('disagrees with blastTotal exactly where it must: unknown vs $0', () => {
    const pending = { bid: 25, completes: null }
    expect(blastTotal(pending)).toBe(0) // what the SQL adds up
    expect(blastCost(pending)).toBeNull() // what a human is allowed to be shown
  })
})

describe('isBlastCostUnknown / unknownCostBlasts', () => {
  it('flags a blast whose cost cannot be computed', () => {
    expect(isBlastCostUnknown({ bid: 25, completes: 4 })).toBe(false)
    expect(isBlastCostUnknown({ bid: 25, completes: 0 })).toBe(false) // recorded zero
    expect(isBlastCostUnknown({ bid: 25, completes: null })).toBe(true)
    expect(isBlastCostUnknown({ bid: null, completes: 4 })).toBe(true)
    expect(isBlastCostUnknown({})).toBe(true)
  })
  it('counts how much of a spend total is missing rather than zero', () => {
    expect(unknownCostBlasts(blasts)).toBe(0)
    expect(unknownCostBlasts([b(25, 3000, null), b(25, 3000, 12), b(null, null, null)])).toBe(2)
    expect(unknownCostBlasts([])).toBe(0)
  })
})

describe('aggregates', () => {
  it('totalBidDollars sums each blast total', () => {
    expect(totalBidDollars(blasts)).toBeCloseTo(216) // 120 + 96
  })
  // The reported total is a FLOOR when any blast is unrecorded — it stays in
  // lockstep with the SQL, and unknownCostBlasts is what says so out loud.
  it('totalBidDollars skips unrecorded blasts, matching actual_spend', () => {
    const withPending = [...blasts, b(50, 14574, null)]
    expect(totalBidDollars(withPending)).toBeCloseTo(216)
    expect(unknownCostBlasts(withPending)).toBe(1)
  })
  it('totalPeople sums people reached', () => {
    expect(totalPeople(blasts)).toBe(400)
    expect(totalPeople([...blasts, b(1, null, 5)])).toBe(400) // unrecorded reach adds nothing
  })
  it('totalCompletes sums completed responses', () => {
    expect(totalCompletes(blasts)).toBe(320)
    expect(totalCompletes([...blasts, b(1, 100, null)])).toBe(320)
  })
  it('blendedBid = total spend ÷ total completes', () => {
    expect(blendedBid(blasts)).toBeCloseTo(0.675) // 216 / 320
  })
  it('blendedBid is null with no completes', () => {
    expect(blendedBid([])).toBeNull()
    expect(blendedBid([b(5, 100, 0)])).toBeNull()
    expect(blendedBid([b(5, 100, null)])).toBeNull()
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

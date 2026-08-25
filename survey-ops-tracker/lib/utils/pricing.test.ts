import { describe, it, expect } from 'vitest'
import {
  effectiveRate,
  isInherited,
  rollup,
  blendedRate,
  contractRange,
  invoicedAtCollected,
  hasRecordedCost,
  margin,
  marginPct,
  marginRange,
  ceilingOvershoot,
  type PriceLine,
} from './pricing'

describe('effectiveRate / isInherited', () => {
  it('a segment override wins over the project default', () => {
    expect(effectiveRate(4, 3.5)).toBe(4)
    expect(isInherited(4)).toBe(false)
  })
  it('null on the segment inherits the project default', () => {
    expect(effectiveRate(null, 3.5)).toBe(3.5)
    expect(isInherited(null)).toBe(true)
    expect(isInherited(undefined)).toBe(true)
  })
  it('$0 is a real override, not "unpriced"', () => {
    // A make-good / freebie segment is priced at zero on purpose; ?? (not ||)
    // is what keeps it from silently falling back to the project rate.
    expect(effectiveRate(0, 3.5)).toBe(0)
    expect(isInherited(0)).toBe(false)
  })
  it('unpriced at both levels stays null — never 0', () => {
    expect(effectiveRate(null, null)).toBeNull()
  })
})

describe('blended rate', () => {
  // Two segments priced differently, each with its own N range.
  const lines: PriceLine[] = [
    { rate: 3.5, nMin: 1000, nMax: 1200, nCollected: 900 },
    { rate: 5.0, nMin: 500, nMax: 800, nCollected: 400 },
  ]

  it('is Σ(rate × N) ÷ ΣN at the low end of the range', () => {
    // (3.5×1000 + 5×500) / 1500 = 6000 / 1500 = 4.00
    expect(blendedRate(lines, 'min')).toBeCloseTo(4)
  })
  it('is Σ(rate × N) ÷ ΣN at the high end of the range', () => {
    // (3.5×1200 + 5×800) / 2000 = 8200 / 2000 = 4.10
    expect(blendedRate(lines, 'max')).toBeCloseTo(4.1)
  })
  it('shifts with the segment mix — it is NOT the mean of the rates', () => {
    // The plain average of 3.5 and 5.0 is 4.25; weighting by N gives 4.00/4.10.
    expect(blendedRate(lines, 'min')).not.toBeCloseTo(4.25)
  })
  it('equals the single rate when nothing is overridden', () => {
    const flat: PriceLine[] = [
      { rate: 3.5, nMin: 1000, nMax: 2000 },
      { rate: 3.5, nMin: 500, nMax: 500 },
    ]
    expect(blendedRate(flat, 'min')).toBeCloseTo(3.5)
    expect(blendedRate(flat, 'max')).toBeCloseTo(3.5)
  })
  it('is null when nothing is priced', () => {
    expect(blendedRate([{ rate: null, nMin: 1000, nMax: 2000 }], 'min')).toBeNull()
    expect(blendedRate([], 'min')).toBeNull()
  })
  it('is null when priced but N is zero — no division by zero', () => {
    expect(blendedRate([{ rate: 3.5, nMin: 0, nMax: 0 }], 'min')).toBeNull()
  })
  it('excludes unpriced N from BOTH sides of the division', () => {
    // The unpriced 1,000 must not drag the blend down from 3.50 to 1.75.
    const mixed: PriceLine[] = [
      { rate: 3.5, nMin: 1000, nMax: 1000 },
      { rate: null, nMin: 1000, nMax: 1000 },
    ]
    const r = rollup(mixed, 'min')
    expect(r.blended).toBeCloseTo(3.5)
    expect(r.pricedN).toBe(1000)
    expect(r.unpricedN).toBe(1000)
    expect(r.revenue).toBe(3500)
  })
  it('a deliberate $0 segment DOES pull the blend down', () => {
    // Unlike an unpriced segment: $0 is a real price, so its N belongs in the
    // denominator. (3.5×1000 + 0×1000) / 2000 = 1.75.
    const freebie: PriceLine[] = [
      { rate: 3.5, nMin: 1000, nMax: 1000 },
      { rate: 0, nMin: 1000, nMax: 1000 },
    ]
    const r = rollup(freebie, 'min')
    expect(r.blended).toBeCloseTo(1.75)
    expect(r.unpricedN).toBe(0)
  })
})

describe('contract value', () => {
  const lines: PriceLine[] = [
    { rate: 3.5, nMin: 1000, nMax: 1200 },
    { rate: 5.0, nMin: 500, nMax: 800 },
  ]

  it('is Σ(rate × n_target) .. Σ(rate × n_target_max)', () => {
    expect(contractRange(lines)).toEqual({ low: 6000, high: 8200 })
  })
  it('collapses to a single value when max equals min (the 078 backfill)', () => {
    expect(contractRange([{ rate: 3.5, nMin: 2000, nMax: 2000 }])).toEqual({ low: 7000, high: 7000 })
  })
  it('falls back to n_target when n_target_max is missing', () => {
    // Pre-078 shape: no max recorded at all. The high end must not read $0.
    expect(contractRange([{ rate: 3.5, nMin: 2000, nMax: null }])).toEqual({ low: 7000, high: 7000 })
  })
  it('counts only priced segments, and says how much N was left out', () => {
    const partial: PriceLine[] = [
      { rate: 3.5, nMin: 1000, nMax: 1000 },
      { rate: null, nMin: 900, nMax: 1100 },
    ]
    expect(contractRange(partial)).toEqual({ low: 3500, high: 3500 })
    expect(rollup(partial, 'max').unpricedN).toBe(1100)
  })
  it('is null — not $0 — when the project is unpriced', () => {
    expect(contractRange([{ rate: null, nMin: 2000, nMax: 3000 }])).toBeNull()
    expect(contractRange([])).toBeNull()
  })
  it('is $0 when a real $0 rate is set', () => {
    // Distinct from unpriced: this contract exists and is worth nothing.
    expect(contractRange([{ rate: 0, nMin: 2000, nMax: 3000 }])).toEqual({ low: 0, high: 0 })
  })
})

describe('invoiced at N collected', () => {
  const lines: PriceLine[] = [
    { rate: 3.5, nMin: 1000, nMax: 1200, nCollected: 900 },
    { rate: 5.0, nMin: 500, nMax: 800, nCollected: 400 },
  ]
  it('prices what was actually banked', () => {
    // 3.5×900 + 5×400 = 3150 + 2000
    expect(invoicedAtCollected(lines)).toBeCloseTo(5150)
  })
  it('is null before anything has been collected', () => {
    expect(invoicedAtCollected([{ rate: 3.5, nMin: 1000, nMax: 1000, nCollected: 0 }])).toBeNull()
    expect(invoicedAtCollected([{ rate: 3.5, nMin: 1000, nMax: 1000 }])).toBeNull()
  })
})

describe('margin', () => {
  const lines: PriceLine[] = [
    { rate: 3.5, nMin: 1000, nMax: 1200 },
    { rate: 5.0, nMin: 500, nMax: 800 },
  ]
  it('is contract value minus actual spend, at both ends', () => {
    expect(marginRange(lines, 2000)).toEqual({ low: 4000, high: 6200 })
  })
  it('goes negative when spend passes the contract', () => {
    expect(margin(6000, 7500)).toBe(-1500)
    expect(marginPct(6000, 7500)).toBeCloseTo(-25)
  })
  it('has an undefined percentage with no revenue — not −100%', () => {
    expect(marginPct(0, 500)).toBeNull()
  })
  it('is null when the project is unpriced', () => {
    expect(marginRange([{ rate: null, nMin: 1000, nMax: 1000 }], 500)).toBeNull()
  })
})

describe('unknown cost vs zero cost', () => {
  it('keeps the arithmetic total-able, but flags a null spend as unknown', () => {
    // margin() stays pure — a null spends as 0 so both ends of the range still add
    // up — and the percentage that falls out reads 100%. hasRecordedCost is what
    // stops the widget rendering "we have no idea what this cost" as pure profit.
    expect(margin(6000, null)).toBe(6000)
    expect(marginPct(6000, null)).toBeCloseTo(100)
    expect(hasRecordedCost(null)).toBe(false)
    expect(hasRecordedCost(undefined)).toBe(false)
  })
  it('treats a spend still sitting at 0 as nothing recorded, not as a free study', () => {
    // recompute_project_spend writes 0 when there is no blast, supplier or cost
    // line, so 0 and "nothing logged yet" are the same value in the column.
    expect(hasRecordedCost(0)).toBe(false)
  })
  it('is recorded once real spend lands', () => {
    expect(hasRecordedCost(2000)).toBe(true)
    expect(margin(6000, 2000)).toBe(4000)
  })
})

describe('ceilingOvershoot', () => {
  it('flags a ceiling authorised above the contract floor', () => {
    // Budget $8k against a $6k floor: spending it all loses $2k.
    expect(ceilingOvershoot(8000, 6000)).toBe(2000)
  })
  it('is quiet when the ceiling sits under the floor', () => {
    expect(ceilingOvershoot(5000, 6000)).toBeNull()
    expect(ceilingOvershoot(6000, 6000)).toBeNull()
  })
  it('is quiet when either side is unset — it never guesses', () => {
    expect(ceilingOvershoot(null, 6000)).toBeNull()
    expect(ceilingOvershoot(0, 6000)).toBeNull()
    expect(ceilingOvershoot(8000, null)).toBeNull()
  })
  it('measures against the FLOOR, not the optimistic top of the range', () => {
    const lines: PriceLine[] = [{ rate: 3.5, nMin: 1000, nMax: 3000 }]
    const c = contractRange(lines)! // 3500 .. 10500
    // A $6k ceiling is under the $10.5k best case but over the $3.5k commitment.
    expect(ceilingOvershoot(6000, c.low)).toBe(2500)
    expect(ceilingOvershoot(6000, c.high)).toBeNull()
  })
})

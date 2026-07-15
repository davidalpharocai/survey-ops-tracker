import { describe, it, expect } from 'vitest'
import { estimatedCost, totalCappedCompletes, blendedCpi } from './suppliers'

describe('suppliers math', () => {
  const rows = [
    { cpi: 1.25, completes_cap: 1000 },
    { cpi: 0.85, completes_cap: 500 },
  ]
  it('estimatedCost = Σ(cap × CPI)', () => {
    expect(estimatedCost(rows)).toBeCloseTo(1250 + 425) // 1675
  })
  it('totalCappedCompletes = Σ cap', () => {
    expect(totalCappedCompletes(rows)).toBe(1500)
  })
  it('blendedCpi = estimatedCost / Σcap', () => {
    expect(blendedCpi(rows)).toBeCloseTo(1675 / 1500)
  })
  it('handles empty + zero caps', () => {
    expect(estimatedCost([])).toBe(0)
    expect(totalCappedCompletes([])).toBe(0)
    expect(blendedCpi([])).toBeNull()
    expect(blendedCpi([{ cpi: 2, completes_cap: 0 }])).toBeNull()
  })
})

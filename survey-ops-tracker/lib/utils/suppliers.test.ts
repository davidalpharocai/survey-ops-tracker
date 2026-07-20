import { describe, it, expect } from 'vitest'
import { actualCost, totalCollected, blendedActualCpi, estimateRange, totalCappedCompletes } from './suppliers'

describe('suppliers math', () => {
  const rows = [
    { cpi: 1.05, completes_cap: 2000, n_collected: 400 },
    { cpi: 0.85, completes_cap: 2000, n_collected: 700 },
    { cpi: 0.75, completes_cap: 2000, n_collected: 500 },
    { cpi: 0.65, completes_cap: 2000, n_collected: 400 },
  ]

  it('actualCost = Σ(CPI × N collected)', () => {
    expect(actualCost(rows)).toBeCloseTo(420 + 595 + 375 + 260) // 1650
  })
  it('totalCollected = Σ N collected', () => {
    expect(totalCollected(rows)).toBe(2000)
  })
  it('blendedActualCpi = actualCost ÷ collected', () => {
    expect(blendedActualCpi(rows)).toBeCloseTo(1650 / 2000) // 0.825
  })
  it('blendedActualCpi is null with nothing collected', () => {
    expect(blendedActualCpi([{ cpi: 1, completes_cap: 100, n_collected: 0 }])).toBeNull()
    expect(blendedActualCpi([])).toBeNull()
  })
  it('estimateRange = target × [min CPI, max CPI]', () => {
    expect(estimateRange(2000, rows)).toEqual({ low: 1300, high: 2100 })
  })
  it('estimateRange is null without a target or priced suppliers', () => {
    expect(estimateRange(null, rows)).toBeNull()
    expect(estimateRange(0, rows)).toBeNull()
    expect(estimateRange(2000, [])).toBeNull()
  })
  it('totalCappedCompletes = Σ cap', () => {
    expect(totalCappedCompletes(rows)).toBe(8000)
  })
})

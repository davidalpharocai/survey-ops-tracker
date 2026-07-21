import { describe, it, expect } from 'vitest'
import {
  actualCost, totalCollected, blendedActualCpi, estimateRange, totalCappedCompletes, modalCap,
  launchRange, projectEstimateRange, projectActualCost, projectCollected, projectTarget, projectBlendedCpi,
} from './suppliers'

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

describe('modalCap', () => {
  it('is the most common cap', () => {
    expect(modalCap([
      { cpi: 1, completes_cap: 450, n_collected: 0 },
      { cpi: 1, completes_cap: 450, n_collected: 0 },
      { cpi: 1, completes_cap: 1000, n_collected: 0 },
    ])).toBe(450)
  })
  it('breaks ties to the larger cap', () => {
    expect(modalCap([
      { cpi: 1, completes_cap: 500, n_collected: 0 },
      { cpi: 1, completes_cap: 1500, n_collected: 0 },
    ])).toBe(1500)
  })
  it('is null with no positive caps', () => {
    expect(modalCap([])).toBeNull()
    expect(modalCap([{ cpi: 1, completes_cap: 0, n_collected: 0 }])).toBeNull()
  })
})

describe('launch-level math', () => {
  // Launch 1: target 400, suppliers $4.50 & $5.20, 240 & 100 collected.
  // Launch 2: target 250, one supplier $4.50, 0 collected (pre-fielding).
  const launch1 = {
    target: 400,
    lines: [
      { cpi: 4.5, completes_cap: 500, n_collected: 240 },
      { cpi: 5.2, completes_cap: 300, n_collected: 100 },
    ],
  }
  const launch2 = {
    target: 250,
    lines: [{ cpi: 4.5, completes_cap: 300, n_collected: 0 }],
  }
  const launches = [launch1, launch2]

  it('launchRange = target × [min, max CPI]', () => {
    expect(launchRange(launch1)).toEqual({ low: 400 * 4.5, high: 400 * 5.2 }) // 1800..2080
    expect(launchRange(launch2)).toEqual({ low: 1125, high: 1125 }) // single CPI
  })
  it('projectEstimateRange = sum of each launch range', () => {
    expect(projectEstimateRange(launches)).toEqual({ low: 1800 + 1125, high: 2080 + 1125 }) // 2925..3205
  })
  it('projectEstimateRange is null when nothing is priced/targeted', () => {
    expect(projectEstimateRange([])).toBeNull()
    expect(projectEstimateRange([{ target: null, lines: [] }])).toBeNull()
    expect(projectEstimateRange([{ target: 100, lines: [{ cpi: 0, completes_cap: 10, n_collected: 0 }] }])).toBeNull()
  })
  it('projectActualCost = Σ(CPI × N collected) across launches', () => {
    expect(projectActualCost(launches)).toBeCloseTo(4.5 * 240 + 5.2 * 100) // 1080 + 520 = 1600
  })
  it('projectCollected + projectTarget sum across launches', () => {
    expect(projectCollected(launches)).toBe(340)
    expect(projectTarget(launches)).toBe(650)
  })
  it('projectBlendedCpi = project actual ÷ project collected', () => {
    expect(projectBlendedCpi(launches)).toBeCloseTo(1600 / 340)
    expect(projectBlendedCpi([launch2])).toBeNull() // nothing collected
  })
})

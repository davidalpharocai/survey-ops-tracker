import { describe, it, expect } from 'vitest'
import {
  pctOf, daysBetween, computePace, costPerComplete, projectedFinalCost,
  blastCompletionRate, cumulativeCompletes, supplierMix, bestValueSupplier,
} from './insights'

describe('kpi math', () => {
  it('pctOf guards zero/none', () => {
    expect(pctOf(50, 200)).toBe(25)
    expect(pctOf(5, 0)).toBeNull()
    expect(pctOf(5, null)).toBeNull()
  })
  it('costPerComplete + projectedFinalCost', () => {
    expect(costPerComplete(1600, 320)).toBe(5)
    expect(costPerComplete(100, 0)).toBeNull()
    expect(projectedFinalCost(5, 1000)).toBe(5000)
    expect(projectedFinalCost(null, 1000)).toBeNull()
  })
  it('daysBetween floors and never goes negative', () => {
    expect(daysBetween('2026-07-01', '2026-07-11')).toBe(10)
    expect(daysBetween('2026-07-11', '2026-07-01')).toBe(0)
  })
})

describe('computePace', () => {
  it('projects a finish date from the current rate', () => {
    // 300 collected over 10 days = 30/day; 300 remaining → 10 more days.
    const p = computePace({ collected: 300, target: 600, startISO: '2026-07-01', todayISO: '2026-07-11' })
    expect(p.daysElapsed).toBe(10)
    expect(p.perDay).toBeCloseTo(30)
    expect(p.remaining).toBe(300)
    expect(p.projectedDaysToTarget).toBe(10)
    expect(p.projectedFinishISO).toBe('2026-07-21')
  })
  it('target already met → finish today', () => {
    const p = computePace({ collected: 600, target: 600, startISO: '2026-07-01', todayISO: '2026-07-11' })
    expect(p.remaining).toBe(0)
    expect(p.projectedFinishISO).toBe('2026-07-11')
  })
  it('no start date → empty', () => {
    expect(computePace({ collected: 10, target: 100, startISO: null, todayISO: '2026-07-11' }).perDay).toBeNull()
  })
})

describe('B2B breakdown', () => {
  const blasts = [
    { people: 1000, completes: 300, bid: 25, blast_at: '2026-07-10T10:00:00Z' },
    { people: 500, completes: 200, bid: 25, blast_at: '2026-07-12T10:00:00Z' },
  ]
  it('completion rate = completes ÷ people', () => {
    expect(blastCompletionRate(blasts[0])).toBe(30)
    expect(blastCompletionRate({ people: 0, completes: 5, bid: 1, blast_at: null })).toBeNull()
  })
  it('cumulative completes are chronological', () => {
    const c = cumulativeCompletes(blasts)
    expect(c.map((x) => x.cumulative)).toEqual([300, 500])
  })
})

describe('PS supplier mix', () => {
  const rows = [
    { name: 'DISQO', cpi: 0.75, n_collected: 100 },
    { name: 'DISQO', cpi: 0.75, n_collected: 50 }, // same supplier, second launch
    { name: 'Fusion', cpi: 0.65, n_collected: 200 },
    { name: 'Prime', cpi: 0.55, n_collected: 0 }, // no completes
  ]
  it('aggregates by supplier, richest first', () => {
    const mix = supplierMix(rows)
    expect(mix[0]).toMatchObject({ name: 'Fusion', collected: 200 })
    expect(mix.find((m) => m.name === 'DISQO')?.collected).toBe(150)
  })
  it('best value = lowest effective CPI among collectors', () => {
    const best = bestValueSupplier(supplierMix(rows))
    expect(best?.name).toBe('Fusion') // 0.65 < 0.75; Prime excluded (0 collected)
    expect(best?.effectiveCpi).toBeCloseTo(0.65)
  })
})

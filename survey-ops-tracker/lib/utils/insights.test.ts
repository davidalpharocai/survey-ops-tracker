import { describe, it, expect } from 'vitest'
import {
  pctOf, daysBetween, computePace, costPerComplete, projectedFinalCost,
  blastCompletionRate, cumulativeCompletes, supplierMix, bestValueSupplier, segmentPaces,
} from './insights'

describe('segmentPaces', () => {
  const start = '2026-08-01', today = '2026-08-11', due = '2026-08-21' // 10d elapsed, 10d left
  it('flags a lagging segment even when the OTHER segment over-collects', () => {
    const rows = segmentPaces({
      segments: [
        { label: 'Buyers', n_target: 300, n_collected: 400 }, // already over its target
        { label: 'Sellers', n_target: 300, n_collected: 60 }, // 6/day → ~120 by due < 300
      ],
      startISO: start, dueISO: due, todayISO: today,
    })
    expect(rows[0].onTrack).toBe(true)
    expect(rows[1].onTrack).toBe(false)
    expect(rows[1].projectedFinal).toBe(120) // 60 + 6/day * 10d
  })
  it('a segment already at/over its target is on track', () => {
    const [r] = segmentPaces({
      segments: [{ label: 'A', n_target: 100, n_collected: 100 }],
      startISO: start, dueISO: due, todayISO: today,
    })
    expect(r.onTrack).toBe(true)
    expect(r.pct).toBe(100)
  })
  it("can't assess a segment with no target (onTrack null)", () => {
    const [r] = segmentPaces({
      segments: [{ label: 'A', n_target: null, n_collected: 50 }],
      startISO: start, dueISO: due, todayISO: today,
    })
    expect(r.onTrack).toBeNull()
    expect(r.label).toBe('A')
  })
  it('falls back to "Segment N" for a blank label', () => {
    const [r] = segmentPaces({
      segments: [{ label: '', n_target: 100, n_collected: 10 }],
      startISO: start, dueISO: due, todayISO: today,
    })
    expect(r.label).toBe('Segment 1')
  })
  it('delivered + under target = short (not a forward projection)', () => {
    const [r] = segmentPaces({
      // Historical pace would project a finish before due, but it's delivered + short.
      segments: [{ label: 'A', n_target: 500, n_collected: 400 }],
      startISO: start, dueISO: due, todayISO: today, delivered: true,
    })
    expect(r.onTrack).toBe(false)
    expect(r.pct).toBe(80)
  })
  it('under target + no due date → projectedPct null (no bogus 0%) and onTrack null', () => {
    const [r] = segmentPaces({
      segments: [{ label: 'A', n_target: 300, n_collected: 100 }], // under target, actively collecting
      startISO: start, dueISO: null, todayISO: today,
    })
    expect(r.projectedPct).toBeNull()
    expect(r.onTrack).toBeNull()
  })
  it("pre-launch (future start) can't be assessed → onTrack null", () => {
    const [r] = segmentPaces({
      segments: [{ label: 'A', n_target: 100, n_collected: 0 }],
      startISO: '2026-09-01', dueISO: '2026-09-30', todayISO: today, // start is after today
    })
    expect(r.perDay).toBeNull()
    expect(r.onTrack).toBeNull()
  })
})

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
  it('projectedFinalCost is floored at completes collected (over-quota)', () => {
    // blended $10, target 100 but 150 already collected → project ≥ spend, not 10×100.
    expect(projectedFinalCost(10, 100, 150)).toBe(1500)
    expect(projectedFinalCost(10, 100, 80)).toBe(1000) // under target → projects to target
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
  it('future start date (pre-launch) → empty, no inflated pace', () => {
    const p = computePace({ collected: 50, target: 1000, startISO: '2026-08-01', todayISO: '2026-07-11' })
    expect(p.perDay).toBeNull()
    expect(p.projectedFinishISO).toBeNull()
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

import { describe, it, expect } from 'vitest'
import {
  deliveredN, measureDeliveryStats, DELIVERY_STATS, MIN_STATS_N, type DeliveryInput,
} from './deliveredN'

/**
 * Guards the delivered-N estimate.
 *
 * The rule that matters: a survey which over-collects delivers roughly what it
 * SOLD, not everything it bought. Scaling collection by a QA keep rate is the
 * natural formula and is measurably the worst of the three candidates (10.0%
 * median error against 6.3% for "≈ target"), so these tests exist to stop it
 * being reintroduced as an obvious simplification.
 */

const P = (o: Partial<DeliveryInput> = {}): DeliveryInput => ({
  n_target: 1000, n_collected: null, n_actual: null, ...o,
})

describe('recorded beats projected', () => {
  it('uses n_actual when it exists, and says nothing', () => {
    // David had to ask for this twice: the row was showing n_collected even
    // where n_actual was filled in.
    const d = deliveredN(P({ n_collected: 2000, n_actual: 1100 }))!
    expect(d).toMatchObject({ value: 1100, estimated: false, basis: 'recorded', note: '' })
  })

  it('prefers a recorded actual even when it is lower than the target', () => {
    const d = deliveredN(P({ n_target: 1000, n_collected: 900, n_actual: 850 }))!
    expect(d.value).toBe(850)
    expect(d.estimated).toBe(false)
  })

  it('honours a recorded 0 rather than falling through to an estimate', () => {
    const d = deliveredN(P({ n_collected: 500, n_actual: 0 }))!
    expect(d).toMatchObject({ value: 0, estimated: false })
  })
})

describe("David's example: 2,000 collected against a 1,000 target", () => {
  const d = deliveredN(P({ n_target: 1000, n_collected: 2000 }))!

  it('estimates NEAR THE TARGET, not near the collection', () => {
    // "it shouldnt be 2000/1000; rather, it should be an estimated number
    // closer to the 1000". Median is 1.010x target on the 115 surveys whose
    // n_actual was not simply copied from n_collected.
    expect(d.value).toBe(1010)
    expect(d.estimated).toBe(true)
    expect(d.basis).toBe('at-or-over-target')
  })

  it('never returns the collected figure for an over-collected survey', () => {
    expect(d.value).toBeLessThan(2000)
  })

  it('carries a band, so it cannot read as a measurement', () => {
    expect(d.low).toBe(1000)
    expect(d.high).toBe(1148)
  })

  it('explains itself on the line item', () => {
    expect(d.note).toContain('Estimated')
    expect(d.note).toContain('2,000 collected')
    expect(d.note).toContain('1,000 target')
    // The reason, not just the label.
    expect(d.note).toContain('delivers roughly what it sold')
    expect(d.note).toContain('115 past surveys')
  })
})

describe('the mirror case behaves differently, so it has its own rule', () => {
  it('still takes a QA loss off a survey that is short of target', () => {
    // David, 2026-09-17: "theres usually no n lost to QA when under target -
    // thats not true". The raw median IS 1.000, but 28 of those 54 surveys have
    // n_actual copied verbatim from n_collected — 9 of them written in the same
    // MINUTE. On the 26 where a loss was actually recorded the median keep is
    // 0.898, and that is the figure the estimate uses.
    const d = deliveredN(P({ n_target: 1000, n_collected: 600 }))!
    expect(d.value).toBe(539)
    expect(d.basis).toBe('short-of-target')
    expect(d.value).toBeLessThan(600)
  })

  it('says the survey is short on BOTH counts', () => {
    const d = deliveredN(P({ n_target: 1000, n_collected: 600 }))!
    expect(d.note).toContain('QA will still')
    expect(d.note).toContain('short on BOTH counts')
  })

  it('treats exactly-on-target as the at-or-over case', () => {
    expect(deliveredN(P({ n_target: 1000, n_collected: 1000 }))!.basis).toBe('at-or-over-target')
  })
})

describe('what it refuses to do', () => {
  it('returns null when there is nothing to say', () => {
    expect(deliveredN(P({ n_collected: null, n_actual: null }))).toBeNull()
  })

  it('reports the collection as-is when no target exists, rather than inventing a ratio', () => {
    const d = deliveredN(P({ n_target: null, n_collected: 400 }))!
    expect(d.value).toBe(400)
    expect(d.estimated).toBe(true)
    expect(d.note).toContain('No target is set')
  })

  it('treats a target of 0 as no target', () => {
    expect(deliveredN(P({ n_target: 0, n_collected: 400 }))!.note).toContain('No target is set')
  })

  it('puts the delivery date in the NOTE and never in the number', () => {
    const withDate = deliveredN(P({ n_collected: 2000, deliver_date: '2026-10-01' }))!
    const without = deliveredN(P({ n_collected: 2000 }))!
    // Only 19 of 48 in-flight surveys carry a date, so a pacing term would be
    // unavailable on most rows that need the estimate.
    expect(withDate.value).toBe(without.value)
    expect(withDate.note).toContain('Due 2026-10-01')
  })
})

describe('measureDeliveryStats: the ratios sharpen from the live book', () => {
  const over = (n: number, ratio: number): DeliveryInput[] =>
    Array.from({ length: n }, () => ({ n_target: 100, n_collected: 200, n_actual: 100 * ratio }))

  it('EXCLUDES rows where n_actual was copied from n_collected', () => {
    // Half the real under-target sample is copies, and including them reported
    // a keep rate of 1.000 that David had to correct.
    const copies: DeliveryInput[] = Array.from({ length: 40 },
      () => ({ n_target: 100, n_collected: 60, n_actual: 60 }))
    const s = measureDeliveryStats(copies)
    expect(s.underTargetRatio).toEqual(DELIVERY_STATS.underTargetRatio)
  })

  it('recomputes from delivered surveys once there are enough of them', () => {
    const s = measureDeliveryStats(over(MIN_STATS_N, 1.5))
    expect(s.overTargetRatio.median).toBeCloseTo(1.5)
    expect(s.overTargetRatio.n).toBe(MIN_STATS_N)
  })

  it('keeps the shipped constant when a class is too thin to speak', () => {
    // A percentile over four surveys is noise wearing a number's clothes.
    const s = measureDeliveryStats(over(4, 1.5))
    expect(s.overTargetRatio).toEqual(DELIVERY_STATS.overTargetRatio)
  })

  it('sorts each survey into the half that describes it', () => {
    const rows: DeliveryInput[] = [
      ...over(MIN_STATS_N, 1.1),
      ...Array.from({ length: MIN_STATS_N }, () => ({ n_target: 100, n_collected: 50, n_actual: 45 })),
    ]
    const s = measureDeliveryStats(rows)
    expect(s.overTargetRatio.n).toBe(MIN_STATS_N)
    expect(s.underTargetRatio.n).toBe(MIN_STATS_N)
    expect(s.underTargetRatio.median).toBeCloseTo(0.9)
  })

  it('ignores a survey missing any of the three figures', () => {
    const s = measureDeliveryStats([{ n_target: 100, n_collected: 200, n_actual: null }])
    expect(s.overTargetRatio).toEqual(DELIVERY_STATS.overTargetRatio)
  })
})

import { describe, it, expect } from 'vitest'
import {
  overTargetCheck, estimateBlastCost, KEEP_RATE, KEEP_RATE_DEFAULT, OVER_TARGET_MARGIN,
  INTERNAL_TARGET_MARGIN,
} from './overTarget'

/**
 * Guards the over-delivery advisory. Its whole value is being believed, so the
 * tests that matter most are the ones asserting SILENCE — see nFloor for the
 * same posture. A warning that fires on a correctly-run study teaches the team
 * to click through every warning the app will ever show.
 */

describe('overTargetCheck: when it must stay quiet', () => {
  it('says nothing without a target — an unknown is not a problem', () => {
    expect(overTargetCheck({ n_target: null, n_collected: 9999 })).toEqual({ over: false, reason: 'no-target' })
    expect(overTargetCheck({ n_target: 0, n_collected: 9999 })).toEqual({ over: false, reason: 'no-target' })
  })

  it('says nothing before anything has been collected', () => {
    expect(overTargetCheck({ n_target: 50, n_collected: null })).toEqual({ over: false, reason: 'no-data' })
    expect(overTargetCheck({ n_target: 50, n_collected: 0 })).toEqual({ over: false, reason: 'no-data' })
  })

  it('does NOT fire the moment raw completes pass target — cleaning eats a fifth', () => {
    // 55 raw on a 50 target looks over, but at the B2B keep rate it projects to
    // 47 delivered: still short. Warning here would have hit 31 of 177 real
    // projects that were genuinely behind.
    const v = overTargetCheck({ n_target: 50, n_collected: 55, project_type: 'B2B' })
    expect(v.over).toBe(false)
    expect(v).toEqual({ over: false, reason: 'under' })
  })

  it('does not fire on landing squarely on target', () => {
    // Exactly enough raw to deliver 50 at the B2B rate.
    expect(overTargetCheck({ n_target: 50, n_collected: Math.ceil(50 / KEEP_RATE.B2B), project_type: 'B2B' }).over).toBe(false)
  })
})

describe('overTargetCheck: when it must speak up', () => {
  it('fires once projected delivery clears target by the margin', () => {
    // 80 raw x 0.855 = 68.4 projected against 50 = 1.37x. Past 1.1x.
    const v = overTargetCheck({ n_target: 50, n_collected: 80, project_type: 'B2B' })
    expect(v.over).toBe(true)
    if (!v.over) throw new Error('unreachable')
    expect(v.projected).toBe(68)
    expect(v.excess).toBe(18)
    expect(v.message).toContain('not chargeable')
  })

  it('prefers a known cleaned figure over projecting from a keep rate', () => {
    // Fielding is done: n_actual is a fact, so do not re-estimate it.
    const v = overTargetCheck({ n_target: 300, n_collected: 450, n_actual: 492, project_type: 'PS' })
    expect(v.over).toBe(true)
    if (!v.over) throw new Error('unreachable')
    expect(v.projected).toBe(492)   // not 450 x 0.78 = 351
    expect(v.excess).toBe(192)      // the real Coatue PR00289 overshoot
  })

  it('prices the next blast when the cost is known', () => {
    const v = overTargetCheck({ n_target: 50, n_collected: 90, project_type: 'B2B', nextBlastCost: 262.64 })
    if (!v.over) throw new Error('expected a warning')
    expect(v.message).toContain('$263')
    expect(v.message).toContain('cannot be invoiced')
  })

  it('omits the price when the next blast cost is unknown, rather than inventing one', () => {
    const v = overTargetCheck({ n_target: 50, n_collected: 90, project_type: 'B2B' })
    if (!v.over) throw new Error('expected a warning')
    expect(v.message).not.toContain('$')
  })
})

describe('overTargetCheck: the keep rate is route-specific and that matters', () => {
  it('is harder to trip on PS than on Rerun, because PS loses more to cleaning', () => {
    // The same raw count against the same target, different routes.
    const raw = 62, target = 50
    expect(overTargetCheck({ n_target: target, n_collected: raw, project_type: 'PS' }).over).toBe(false)     // 48 projected
    expect(overTargetCheck({ n_target: target, n_collected: raw, project_type: 'Rerun' }).over).toBe(true)   // 58 projected
  })

  it('falls back to the whole-book rate for an unknown or missing route', () => {
    expect(KEEP_RATE_DEFAULT).toBeGreaterThan(KEEP_RATE.PS)
    expect(KEEP_RATE_DEFAULT).toBeLessThan(KEEP_RATE.Rerun)
    const v = overTargetCheck({ n_target: 50, n_collected: 80, project_type: null })
    expect(v.over).toBe(true)
    if (!v.over) throw new Error('unreachable')
    expect(v.keepRate).toBe(KEEP_RATE_DEFAULT)
  })

  it('pins the margin, so a future edit has to be deliberate', () => {
    expect(OVER_TARGET_MARGIN).toBe(1.1)
  })
})

describe('estimateBlastCost', () => {
  it('is migration 095 arithmetic: reward on finishers, postage on everyone reached', () => {
    expect(estimateBlastCost({ bid: 50, people: 10_000, completes: 20, cost_per_send: 0.02 })).toBe(50 * 20 + 200)
  })

  it('states postage alone before a blast has any completes, rather than guessing a response rate', () => {
    expect(estimateBlastCost({ bid: 50, people: 10_000, completes: null, cost_per_send: 0.02 })).toBe(200)
  })

  it('returns null when there is nothing to price', () => {
    expect(estimateBlastCost({ bid: 50, people: 0, completes: null, cost_per_send: 0.02 })).toBeNull()
  })
})

/* THE PRIMARY SIGNAL. n_internal_target is the cushion the team sets itself, so
   it encodes THIS study's screen-out rate rather than a route average that runs
   from 6% to 100%. Backtested at 91% precision against 63% for a raw-count rule
   — these tests pin that it is actually the branch being taken. */
describe('overTargetCheck: n_internal_target outranks the keep rate', () => {
  it('stays quiet below the internal cushion even when raw is far past target', () => {
    // PR00101 shape: target 50, team wanted 400 raw, 442 banked -> delivered 50.
    // A raw-vs-target rule screams here. This must not.
    const v = overTargetCheck({ n_target: 50, n_internal_target: 400, n_collected: 442, project_type: 'B2B' })
    expect(v.over).toBe(false)
  })

  it('fires once raw clears the internal cushion by the margin', () => {
    const v = overTargetCheck({ n_target: 50, n_internal_target: 400, n_collected: 520, project_type: 'B2B' })
    expect(v.over).toBe(true)
  })

  it('uses the internal cushion INSTEAD of the keep-rate path, not as well as', () => {
    // keep-rate path would fire (80 x 0.855 = 68 vs 50 x 1.1 = 55).
    // internal cushion says no (80 < 200 x 1.25).
    const v = overTargetCheck({ n_target: 50, n_internal_target: 200, n_collected: 80, project_type: 'B2B' })
    expect(v.over).toBe(false)
  })

  it('falls back to the keep rate only when no internal target is set', () => {
    expect(overTargetCheck({ n_target: 50, n_collected: 80, project_type: 'B2B' }).over).toBe(true)
    expect(overTargetCheck({ n_target: 50, n_internal_target: 0, n_collected: 80, project_type: 'B2B' }).over).toBe(true)
  })

  it('a known n_actual beats both — no prediction once the truth is in', () => {
    // Under the internal cushion, but delivery is a fact and it is over target.
    const v = overTargetCheck({ n_target: 50, n_internal_target: 400, n_collected: 90, n_actual: 61 })
    expect(v.over).toBe(true)
    if (!v.over) throw new Error('unreachable')
    expect(v.excess).toBe(11)
  })

  it('pins the margin so a future edit has to be deliberate', () => {
    expect(INTERNAL_TARGET_MARGIN).toBe(1.25)
  })
})

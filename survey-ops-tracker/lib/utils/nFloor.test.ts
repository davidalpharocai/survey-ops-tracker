import { describe, it, expect } from 'vitest'
import { nFloorCheck, nFloorDeliveryGate, NATIONAL_FLOOR, STATE_FLOOR } from './nFloor'

const JENNA = { salesperson: 'Jenna Shrove' }

describe('nFloorCheck', () => {
  it('flags a national gen-pop study under 1,350 for Jenna', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'US adults 18+', n_target: 800 })
    expect(r.applies).toBe(true)
    expect(r.scope).toBe('national')
    expect(r.floor).toBe(NATIONAL_FLOOR)
    expect(r.shortfallTarget).toBe(true)
  })

  it('does not flag when N target meets the national floor', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'general population', n_target: 1350 })
    expect(r.applies).toBe(true)
    expect(r.shortfallTarget).toBe(false)
  })

  it('uses the 500 state floor when the audience names a state', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'California adults', n_target: 400 })
    expect(r.scope).toBe('state')
    expect(r.floor).toBe(STATE_FLOOR)
    expect(r.shortfallTarget).toBe(true)
  })

  it('does not apply for a non-Jenna salesperson', () => {
    const r = nFloorCheck({ salesperson: 'Alex Pinsky', audience: 'gen pop', n_target: 200 })
    expect(r.applies).toBe(false)
    expect(r.shortfallTarget).toBe(false)
  })

  it('does not apply when the audience is not gen pop', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'hospital CFOs', n_target: 40 })
    expect(r.applies).toBe(false)
  })

  it('stays silent when N target is unknown (null)', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'gen pop', n_target: null })
    expect(r.applies).toBe(true)
    expect(r.band).toBe('ok')
    expect(r.shortfallTarget).toBe(false)
  })

  it('flags a light N actual once it is set', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'nationally representative', n_target: 1400, n_actual: 900 })
    expect(r.shortfallTarget).toBe(false)
    expect(r.shortfallActual).toBe(true)
  })
})

// The three bands are the whole point of grading: a range whose top end clears
// the floor is fieldable, so it must not demand a typed override.
describe('nFloorCheck — grading the N target RANGE', () => {
  it('WARNING when even the max is under the floor (override required)', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'US adults 18+', n_target: 800, n_target_max: 1000 })
    expect(r.band).toBe('warning')
    expect(r.requiresOverride).toBe(true)
    expect(r.shortfallTarget).toBe(true)
    expect(r.targetMin).toBe(800)
    expect(r.targetMax).toBe(1000)
  })

  it('NOTICE when the min dips below but the max clears it (no override)', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'US adults 18+', n_target: 1000, n_target_max: 1600 })
    expect(r.band).toBe('notice')
    expect(r.requiresOverride).toBe(false)
    expect(r.shortfallTarget).toBe(true)
  })

  it('OK when even the min is at or above the floor', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'US adults 18+', n_target: 1350, n_target_max: 2000 })
    expect(r.band).toBe('ok')
    expect(r.requiresOverride).toBe(false)
    expect(r.shortfallTarget).toBe(false)
  })

  it('treats a max sitting exactly ON the floor as a notice, not a warning', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'gen pop', n_target: 900, n_target_max: NATIONAL_FLOOR })
    expect(r.band).toBe('notice')
    expect(r.requiresOverride).toBe(false)
  })

  it('reads a pre-078 single number (null max) as a degenerate range', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'gen pop', n_target: 800, n_target_max: null })
    expect(r.band).toBe('warning')
    expect(r.targetMin).toBe(800)
    expect(r.targetMax).toBe(800)
  })

  it('grades against the 500 state floor across all three bands', () => {
    const state = { ...JENNA, audience: 'statewide adults, Ohio' }
    const warn = nFloorCheck({ ...state, n_target: 300, n_target_max: 400 })
    expect(warn.floor).toBe(STATE_FLOOR)
    expect(warn.band).toBe('warning')

    const notice = nFloorCheck({ ...state, n_target: 300, n_target_max: 600 })
    expect(notice.floor).toBe(STATE_FLOOR)
    expect(notice.band).toBe('notice')
    expect(notice.requiresOverride).toBe(false)

    const ok = nFloorCheck({ ...state, n_target: 500, n_target_max: 800 })
    expect(ok.band).toBe('ok')
  })

  it('still requires an override for a light N actual, whatever the range said', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'US adults 18+',
      n_target: 1350,
      n_target_max: 1600,
      n_actual: 1200,
    })
    expect(r.band).toBe('ok')
    expect(r.shortfallActual).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('never demands anything when it does not apply at all', () => {
    const r = nFloorCheck({ salesperson: 'Steven', audience: 'gen pop', n_target: 10, n_target_max: 20 })
    expect(r.applies).toBe(false)
    expect(r.band).toBe('ok')
    expect(r.requiresOverride).toBe(false)
    expect(r.targetMin).toBeNull()
  })
})

// The delivery-time re-check: the locked spec's last clause. n_collected is a
// running tally during fielding, so it is only judged once fielding is done —
// otherwise every gen-pop study would demand a sign-off on its first afternoon.
describe('nFloorCheck — the N COLLECTED re-check before delivery', () => {
  it('ignores a light n_collected while fielding is still running', () => {
    const r = nFloorCheck({ ...JENNA, audience: 'US adults 18+', n_target: 1400, n_collected: 120 })
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })

  it('requires an override once fielding is done and n_collected is under the floor', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'US adults 18+',
      n_target: 1400,
      n_target_max: 1600,
      n_collected: 900,
      collectionFinal: true,
    })
    expect(r.band).toBe('ok')
    expect(r.shortfallCollected).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('stays silent when the collected N clears the floor', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'gen pop',
      n_target: 1350,
      n_collected: 1400,
      collectionFinal: true,
    })
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })

  it('treats a collected N exactly ON the floor as clearing it', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'gen pop',
      n_target: 1350,
      n_collected: NATIONAL_FLOOR,
      collectionFinal: true,
    })
    expect(r.shortfallCollected).toBe(false)
  })

  it('never flags a zero-collected placeholder wave (migration 075) as short', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'US adults 18+',
      n_target: 1400,
      n_collected: 0,
      collectionFinal: true,
    })
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })

  it('uses the 500 state floor for the collected re-check too', () => {
    const base = { ...JENNA, audience: 'Ohio adults', n_target: 600, collectionFinal: true }
    expect(nFloorCheck({ ...base, n_collected: 420 }).shortfallCollected).toBe(true)
    expect(nFloorCheck({ ...base, n_collected: 520 }).shortfallCollected).toBe(false)
  })

  it('reports the range, the collected N and the delivered N independently', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'US adults 18+',
      n_target: 800,
      n_target_max: 1000,
      n_collected: 700,
      n_actual: 650,
      collectionFinal: true,
    })
    expect(r.band).toBe('warning')
    expect(r.shortfallTarget).toBe(true)
    expect(r.shortfallCollected).toBe(true)
    expect(r.shortfallActual).toBe(true)
    expect(r.requiresOverride).toBe(true)
  })

  it('does not apply the collected re-check to a non-gen-pop project at all', () => {
    const r = nFloorCheck({
      ...JENNA,
      audience: 'hospital CFOs',
      n_target: 40,
      n_collected: 12,
      collectionFinal: true,
    })
    expect(r.applies).toBe(false)
    expect(r.shortfallCollected).toBe(false)
    expect(r.requiresOverride).toBe(false)
  })
})

// The gate the pipeline calls on the Delivered transition. Pure, like
// occamOnboardingGate / complianceGate, so the app hook and the connector share
// one definition.
describe('nFloorDeliveryGate', () => {
  const SHORT = { ...JENNA, audience: 'US adults 18+', n_target: 1400, n_collected: 900 }

  it('blocks a delivery whose collected N is under the floor', () => {
    const g = nFloorDeliveryGate({ ...SHORT, willMarkDelivered: true })
    expect(g.blocked).toBe(true)
    expect(g.message).toContain('900')
    expect(g.message).toContain('1,350')
  })

  it('does nothing on any transition that is not the delivery one', () => {
    expect(nFloorDeliveryGate({ ...SHORT, willMarkDelivered: false }).blocked).toBe(false)
  })

  it('never re-asks once the override has been signed off', () => {
    const g = nFloorDeliveryGate({ ...SHORT, willMarkDelivered: true, n_floor_override: true })
    expect(g.blocked).toBe(false)
  })

  it('lets a delivery through when the collected N cleared the floor', () => {
    const g = nFloorDeliveryGate({ ...SHORT, n_collected: 1400, willMarkDelivered: true })
    expect(g.blocked).toBe(false)
  })

  it('does not block on the target range alone — a plan is not a fact', () => {
    const g = nFloorDeliveryGate({
      ...JENNA,
      audience: 'US adults 18+',
      n_target: 800,
      n_target_max: 1000,
      n_collected: 1400,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(false)
  })

  it('blocks on a light delivered N even when collection looked fine', () => {
    const g = nFloorDeliveryGate({
      ...JENNA,
      audience: 'gen pop',
      n_target: 1400,
      n_collected: 1500,
      n_actual: 1100,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(true)
    expect(g.message).toContain('N actual 1,100')
  })

  it('lets a zero-collected placeholder wave deliver untouched', () => {
    const g = nFloorDeliveryGate({ ...SHORT, n_collected: 0, willMarkDelivered: true })
    expect(g.blocked).toBe(false)
  })

  it('does not gate a project the floor never applied to', () => {
    const g = nFloorDeliveryGate({
      salesperson: 'Alex Pinsky',
      audience: 'gen pop',
      n_target: 1400,
      n_collected: 200,
      willMarkDelivered: true,
    })
    expect(g.blocked).toBe(false)
  })
})

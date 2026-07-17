import { describe, it, expect } from 'vitest'
import { nFloorCheck, NATIONAL_FLOOR, STATE_FLOOR } from './nFloor'

describe('nFloorCheck', () => {
  it('flags a national gen-pop study under 1,350 for Jenna', () => {
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'US adults 18+', n_target: 800 })
    expect(r.applies).toBe(true)
    expect(r.scope).toBe('national')
    expect(r.floor).toBe(NATIONAL_FLOOR)
    expect(r.shortfallTarget).toBe(true)
  })

  it('does not flag when N target meets the national floor', () => {
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'general population', n_target: 1350 })
    expect(r.applies).toBe(true)
    expect(r.shortfallTarget).toBe(false)
  })

  it('uses the 500 state floor when the audience names a state', () => {
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'California adults', n_target: 400 })
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
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'hospital CFOs', n_target: 40 })
    expect(r.applies).toBe(false)
  })

  it('stays silent when N target is unknown (null)', () => {
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'gen pop', n_target: null })
    expect(r.applies).toBe(true)
    expect(r.shortfallTarget).toBe(false)
  })

  it('flags a light N actual once it is set', () => {
    const r = nFloorCheck({ salesperson: 'Jenna Shrove', audience: 'nationally representative', n_target: 1400, n_actual: 900 })
    expect(r.shortfallTarget).toBe(false)
    expect(r.shortfallActual).toBe(true)
  })
})

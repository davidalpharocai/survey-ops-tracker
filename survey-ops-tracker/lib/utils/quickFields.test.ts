import { describe, it, expect } from 'vitest'
import { fieldsToUpdates, nRangeComplaint, withNTargetPair } from './quickFields'

// Migration 078's enforce_n_target_range trigger sees only the columns a PATCH
// carries, so a one-ended N target write raises purely on ordering. These cover
// the exact case Quick Edit used to hit: "bump N to 2,500" on a 1,000–1,200
// project, sent as n_target alone, compared against the STORED max of 1,200.
describe('withNTargetPair', () => {
  const current = { n_target: 1000, n_target_max: 1200 }

  it('sends both ends when only the min was parsed, collapsing a now-invalid max', () => {
    expect(withNTargetPair({ n_target: 2500 }, current)).toEqual({
      n_target: 2500,
      n_target_max: 2500,
    })
  })

  it('keeps the stored max when the new min still fits under it', () => {
    expect(withNTargetPair({ n_target: 1100 }, current)).toEqual({
      n_target: 1100,
      n_target_max: 1200,
    })
  })

  it('keeps a null stored max null — nothing agreed at the top end', () => {
    expect(withNTargetPair({ n_target: 2500 }, { n_target: 1000, n_target_max: null })).toEqual({
      n_target: 2500,
      n_target_max: null,
    })
  })

  it('sends both ends when only the max was parsed', () => {
    expect(withNTargetPair({ n_target_max: 1600 }, current)).toEqual({
      n_target: 1000,
      n_target_max: 1600,
    })
  })

  it('does NOT drag the min down to meet a lower new max — that would give away committed N', () => {
    // Left inverted on purpose so nRangeComplaint can say so out loud.
    expect(withNTargetPair({ n_target_max: 800 }, current)).toEqual({
      n_target: 1000,
      n_target_max: 800,
    })
  })

  it('passes a fully-specified range straight through', () => {
    expect(withNTargetPair({ n_target: 2000, n_target_max: 2400 }, current)).toEqual({
      n_target: 2000,
      n_target_max: 2400,
    })
  })

  it('leaves updates that touch neither end alone', () => {
    expect(withNTargetPair({ n_collected: 180 }, current)).toEqual({ n_collected: 180 })
  })

  it('leaves a lone end lone on a create — there is no stored end to collide with', () => {
    expect(withNTargetPair({ n_target: 2500 })).toEqual({ n_target: 2500 })
  })

  it('does not coerce a non-numeric value — the DB is a better judge than a silent null', () => {
    expect(withNTargetPair({ n_target: '2,500' }, current)).toEqual({ n_target: '2,500' })
  })
})

describe('fieldsToUpdates', () => {
  it('emits the N target pair for a one-ended parse', () => {
    const updates = fieldsToUpdates({ n_target: 2500 }, [], { n_target: 1000, n_target_max: 1200 })
    expect(updates).toEqual({ n_target: 2500, n_target_max: 2500 })
  })

  it('still maps captain_name and drops the note, pair or no pair', () => {
    const updates = fieldsToUpdates(
      { captain_name: 'Sree', note: 'called the client', n_collected: 40 },
      [{ id: 'tm-1', name: 'Sree' }],
      { n_target: 1000, n_target_max: 1200 }
    )
    expect(updates).toEqual({ captain_id: 'tm-1', n_collected: 40 })
  })
})

describe('nRangeComplaint', () => {
  it('names both ends, comma-grouped, and shows the right order', () => {
    expect(nRangeComplaint({ n_target: 2500, n_target_max: 2000 })).toBe(
      'N Target max (2,000) cannot be below N Target min (2,500)' +
        ' — give the low end first, e.g. "N target 2,000 to 2,500".'
    )
  })

  it('is silent on a valid pair, an equal pair, and a half-set one', () => {
    expect(nRangeComplaint({ n_target: 1000, n_target_max: 1200 })).toBeNull()
    expect(nRangeComplaint({ n_target: 1000, n_target_max: 1000 })).toBeNull()
    expect(nRangeComplaint({ n_target: 1000, n_target_max: null })).toBeNull()
    expect(nRangeComplaint({ n_collected: 180 })).toBeNull()
  })
})

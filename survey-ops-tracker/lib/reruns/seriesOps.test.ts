import { describe, it, expect } from 'vitest'
import { cadenceToMonths, pickSeriesUpdatePatch, SeriesOpError } from './seriesOps'

// The DB-touching operations in seriesOps.ts are exercised end-to-end through
// the series route + MCP tools; here we cover the PURE decision pieces (the
// non-trivial logic), since renumber/inherit already have coverage in
// series.test.ts.

describe('cadenceToMonths', () => {
  it('maps the cadence keywords to month counts', () => {
    expect(cadenceToMonths('monthly')).toBe(1)
    expect(cadenceToMonths('quarterly')).toBe(3)
    expect(cadenceToMonths('semiannual')).toBe(6)
    expect(cadenceToMonths('yearly')).toBe(12)
  })
  it('maps adhoc to null (no fixed cadence)', () => {
    expect(cadenceToMonths('adhoc')).toBeNull()
  })
})

describe('pickSeriesUpdatePatch', () => {
  it('keeps only whitelisted fields and drops the rest', () => {
    const res = pickSeriesUpdatePatch({
      cadence_months: 3,
      owner_email: 'sree@alpharoc.ai',
      // not on the whitelist — must be dropped:
      in_service: false,
      next_wave_no: 99,
      id: 'hax',
    })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch).toEqual({ cadence_months: 3, owner_email: 'sree@alpharoc.ai' })
    expect('in_service' in res.patch).toBe(false)
    expect('next_wave_no' in res.patch).toBe(false)
    expect('id' in res.patch).toBe(false)
  })

  it('accepts a valid base_type', () => {
    const res = pickSeriesUpdatePatch({ base_type: 'PS' })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(res.patch.base_type).toBe('PS')
  })

  it('rejects an invalid base_type', () => {
    const res = pickSeriesUpdatePatch({ base_type: 'Rerun' })
    expect('error' in res).toBe(true)
  })

  it('returns an empty patch when nothing whitelisted was passed', () => {
    const res = pickSeriesUpdatePatch({ foo: 1, bar: 2 })
    expect('error' in res).toBe(false)
    if ('error' in res) return
    expect(Object.keys(res.patch)).toHaveLength(0)
  })
})

describe('SeriesOpError', () => {
  it('carries an HTTP status (defaults to 400)', () => {
    expect(new SeriesOpError('bad').status).toBe(400)
    expect(new SeriesOpError('missing', 404).status).toBe(404)
    expect(new SeriesOpError('x') instanceof Error).toBe(true)
  })
})

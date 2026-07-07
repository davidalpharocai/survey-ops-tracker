import { describe, it, expect } from 'vitest'
import { sanitizeQuery, decodeSurveyId, isActiveOperational } from './data'

describe('sanitizeQuery', () => {
  it('strips PostgREST-reserved and escapes LIKE wildcards', () => {
    expect(sanitizeQuery('acme, (test) 50%_x')).toBe('acme test 50\\%\\_x')
  })
  it('caps length at 100', () => {
    expect(sanitizeQuery('a'.repeat(500)).length).toBeLessThanOrEqual(100)
  })
})

describe('decodeSurveyId', () => {
  const initials = ['AL', 'SR', 'JC']
  it('parses owner + abbreviation + date + region', () => {
    expect(decodeSurveyId('ALBNFOF20260529UK', initials)).toEqual({
      owner: 'AL', abbreviation: 'BNFOF', date: '2026-05-29', region: 'UK', note: null,
    })
  })
  it('handles no region and unknown owner', () => {
    expect(decodeSurveyId('SRACME20260601', initials)).toEqual({
      owner: 'SR', abbreviation: 'ACME', date: '2026-06-01', region: null, note: null,
    })
    const r = decodeSurveyId('ZZACME20260601', initials)
    expect(r?.owner).toBeNull()
    expect(r?.abbreviation).toBe('ZZACME')
    expect(r?.note).toBe('owner initials not recognized')
  })
  it('parses abbreviations containing digits', () => {
    expect(decodeSurveyId('ALB2B20260529US', ['AL'])).toEqual({
      owner: 'AL', abbreviation: 'B2B', date: '2026-05-29', region: 'US', note: null,
    })
  })
  it('returns null when no date anchor', () => {
    expect(decodeSurveyId('NODATEHERE', initials)).toBeNull()
  })
})

describe('isActiveOperational', () => {
  it('accepts an in-flight Open/Active project', () => {
    expect(isActiveOperational({ status: 'Open', phase: 'Active', board_column: 'Fielding' })).toBe(true)
  })
  it('rejects Closed, On-Hold (Hold), and pre-sale Scoping', () => {
    expect(isActiveOperational({ status: 'Closed', phase: 'Active', board_column: 'Fielding' })).toBe(false)
    expect(isActiveOperational({ status: 'Hold', phase: 'Active', board_column: 'Fielding' })).toBe(false)
    expect(isActiveOperational({ status: 'Open', phase: 'Scoping', board_column: 'Submitted' })).toBe(false)
  })
  it('rejects a delivered project even while status is still Open', () => {
    expect(isActiveOperational({ status: 'Open', phase: 'Active', board_column: 'Delivery' })).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { sanitizeQuery, decodeSurveyId } from './data'

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
      owner: 'AL', abbreviation: 'BNFOF', date: '2026-05-29', region: 'UK',
    })
  })
  it('handles no region and unknown owner', () => {
    expect(decodeSurveyId('SRACME20260601', initials)).toEqual({
      owner: 'SR', abbreviation: 'ACME', date: '2026-06-01', region: null,
    })
    const r = decodeSurveyId('ZZACME20260601', initials)
    expect(r?.owner).toBeNull()
    expect(r?.abbreviation).toBe('ZZACME')
  })
  it('returns null when no date anchor', () => {
    expect(decodeSurveyId('NODATEHERE', initials)).toBeNull()
  })
})

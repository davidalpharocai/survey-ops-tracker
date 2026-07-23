import { describe, it, expect } from 'vitest'
import { evalSum, commitNumber } from './formula'

describe('evalSum', () => {
  it('sums a simple = expression', () => {
    expect(evalSum('=4200+800')).toBe(5000)
  })
  it('handles mixed +/-', () => {
    expect(evalSum('=1000+1000-250')).toBe(1750)
  })
  it('strips commas', () => {
    expect(evalSum('=4,200+800')).toBe(5000)
  })
  it('returns null when there is no leading =', () => {
    expect(evalSum('4200')).toBeNull()
  })
  it('returns null on garbage input', () => {
    expect(evalSum('=4200+abc')).toBeNull()
  })
})

describe('commitNumber', () => {
  it('formats a plain number with thousands separators', () => {
    expect(commitNumber('4200')).toBe('4,200')
  })
  it('evaluates a formula and formats the result', () => {
    expect(commitNumber('=4200+800')).toBe('5,000')
  })
  it('passes through the placeholder dash', () => {
    expect(commitNumber('—')).toBe('—')
  })
  it('treats empty string as the placeholder dash', () => {
    expect(commitNumber('')).toBe('—')
  })
})

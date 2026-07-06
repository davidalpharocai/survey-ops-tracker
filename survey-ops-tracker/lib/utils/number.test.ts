import { describe, it, expect } from 'vitest'
import { fmtNum } from './number'

describe('fmtNum', () => {
  it('adds thousands separators', () => {
    expect(fmtNum(3000)).toBe('3,000')
    expect(fmtNum(1234567)).toBe('1,234,567')
    expect(fmtNum(999)).toBe('999')
  })
  it('handles empties', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(undefined)).toBe('—')
  })
})

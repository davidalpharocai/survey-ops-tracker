import { describe, it, expect } from 'vitest'
import { money } from '@/lib/finance/format'
import { fmtCount, fmtCountCompact, fmtMoney, fmtMoneyCompact, fmtPct, MINUS, withMinus } from './format'

// Invented figures only — nothing here is a real book amount.

describe('fmtMoney', () => {
  it('prints whole dollars from $10 with thousands separators', () => {
    expect(fmtMoney(123456)).toBe('$123,456')
    expect(fmtMoney(10)).toBe('$10')
  })

  it('keeps cents under $10, where they carry the decision', () => {
    expect(fmtMoney(1.214)).toBe('$1.21')
    expect(fmtMoney(0.5)).toBe('$0.50')
    expect(fmtMoney(9.99)).toBe('$9.99')
  })

  it('prints a negative with the real minus sign, never a hyphen', () => {
    expect(fmtMoney(-1234)).toBe(`${MINUS}$1,234`)
    expect(fmtMoney(-1234)).toBe('−$1,234')
    expect(fmtMoney(-1234)).not.toContain('-')
    expect(fmtMoney(-1.5)).toBe('−$1.50')
  })

  it('prints $0 plainly and a missing value as a dash, not $0', () => {
    expect(fmtMoney(0)).toBe('$0')
    expect(fmtMoney(null)).toBe('—')
    expect(fmtMoney(undefined)).toBe('—')
    expect(fmtMoney(Number.NaN)).toBe('—')
    // A division by zero is not a figure either.
    expect(fmtMoney(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('is the finance money helper exactly, so a chart and the table beside it agree to the cent', () => {
    for (const v of [9.995, 9.996, 1.214, -0.004, -1e-11, -1234, 0, 12345.5, -9.999, 999.5, 0.005]) {
      expect(fmtMoney(v)).toBe(money(v))
    }
  })

  it('never puts a minus sign on a value that rounds to zero', () => {
    expect(fmtMoney(-0.004)).not.toContain(MINUS)
    expect(fmtMoney(1234.56 - 1234.5600000001)).not.toContain(MINUS)
  })
})

describe('fmtMoneyCompact', () => {
  it('compacts thousands and millions', () => {
    expect(fmtMoneyCompact(12345)).toBe('$12.3k')
    expect(fmtMoneyCompact(120000)).toBe('$120k')
    expect(fmtMoneyCompact(1234567)).toBe('$1.2M')
    expect(fmtMoneyCompact(950)).toBe('$950')
    expect(fmtMoneyCompact(2000)).toBe('$2k')
  })

  it('promotes a value that would round to the next unit', () => {
    expect(fmtMoneyCompact(999960)).toBe('$1M')
    expect(fmtMoneyCompact(999.6)).toBe('$1k')
  })

  it('keeps cents under $10 exactly as fmtMoney does, and the minus sign on negatives', () => {
    expect(fmtMoneyCompact(2.5)).toBe('$2.50')
    expect(fmtMoneyCompact(9.996)).toBe(fmtMoney(9.996))
    expect(fmtMoneyCompact(-1234)).toBe('−$1.2k')
    expect(fmtMoneyCompact(0)).toBe('$0')
    expect(fmtMoneyCompact(null)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('prints a fraction as a whole percentage by default', () => {
    expect(fmtPct(0.429)).toBe('43%')
    expect(fmtPct(1)).toBe('100%')
    expect(fmtPct(0.4555, 1)).toBe('45.6%')
  })

  it('uses the real minus sign and never prints −0%', () => {
    expect(fmtPct(-0.6)).toBe('−60%')
    expect(fmtPct(-0.001)).toBe('0%')
    expect(fmtPct(null)).toBe('—')
  })
})

describe('fmtCount', () => {
  it('uses fmtNum thousands separators, with the real minus sign', () => {
    expect(fmtCount(1350)).toBe('1,350')
    expect(fmtCount(-42)).toBe('−42')
    expect(fmtCount(null)).toBe('—')
  })

  it('never prints "−0" for a value that rounds to zero', () => {
    expect(fmtCount(-0.0001)).toBe('0')
  })

  it('compacts large counts for axes', () => {
    expect(fmtCountCompact(950)).toBe('950')
    expect(fmtCountCompact(1234)).toBe('1.2k')
    expect(fmtCountCompact(12000)).toBe('12k')
    expect(fmtCountCompact(1234567)).toBe('1.2M')
  })

  it('withMinus swaps only a leading hyphen', () => {
    expect(withMinus('-3')).toBe('−3')
    expect(withMinus('3-4')).toBe('3-4')
  })
})

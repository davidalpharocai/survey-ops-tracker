import { describe, it, expect } from 'vitest'
import {
  SALESPEOPLE,
  FORMER_SALESPEOPLE,
  ALL_SALESPERSON_VALUES,
  EMAIL_BY_SALESPERSON,
  salespersonForEmail,
  isKnownSalesperson,
  salespersonOptions,
} from './salespeople'

// This file is the link between a signed-in account and "their" projects. If it
// is wrong, a salesperson opens a scoped view and sees the wrong work — or none
// of their own — with nothing on screen to explain it. Hence the exactness.

describe('salespersonForEmail', () => {
  it('resolves each salesperson account to their canonical name', () => {
    expect(salespersonForEmail('alex@alpharoc.ai')).toBe('Alex Pinsky')
    expect(salespersonForEmail('jenna@alpharoc.ai')).toBe('Jenna Shrove')
    expect(salespersonForEmail('vineet@alpharoc.ai')).toBe('Vineet Kapur')
    expect(salespersonForEmail('shanu@alpharoc.ai')).toBe('Shanu Aggarwal')
  })

  it('still resolves a former salesperson, so their history stays reachable', () => {
    expect(salespersonForEmail('steven@alpharoc.ai')).toBe('Steven Stubbs')
  })

  it('is case- and whitespace-insensitive, because an email is not', () => {
    expect(salespersonForEmail('  ALEX@AlphaROC.ai  ')).toBe('Alex Pinsky')
  })

  it('returns null for an analyst — meaning "do not scope", not "show nothing"', () => {
    // The distinction that matters most in this file. A null here must never be
    // read as an empty filter, or every analyst sees a blank board.
    expect(salespersonForEmail('bryan@alpharoc.ai')).toBeNull()
    expect(salespersonForEmail('david@alpharoc.ai')).toBeNull()
    expect(salespersonForEmail(null)).toBeNull()
    expect(salespersonForEmail(undefined)).toBeNull()
    expect(salespersonForEmail('')).toBeNull()
  })

  it('has no account mapped to "Internal" — it is a category, not a person', () => {
    expect(EMAIL_BY_SALESPERSON['Internal']).toBeUndefined()
    expect(Object.values(EMAIL_BY_SALESPERSON)).not.toContain('internal@alpharoc.ai')
  })
})

describe('the canonical list', () => {
  it('covers every value present in production as of 2026-08-27', () => {
    // The live set after normalising the five strays. A new value appearing here
    // without being added to the list is exactly what check 6 in lib/mcp/health.ts
    // reports.
    for (const live of [
      'Alex Pinsky', 'Jenna Shrove', 'Vineet Kapur', 'Internal',
      'Shanu Aggarwal', 'Steven Stubbs',
    ]) {
      expect(isKnownSalesperson(live), `${live} must be recognised`).toBe(true)
    }
  })

  it('rejects the drifted spellings that were normalised away', () => {
    for (const stray of ['Jenna', 'Vineet', 'Shanu', 'alex pinsky', '']) {
      expect(isKnownSalesperson(stray), `${stray} must NOT be recognised`).toBe(false)
    }
    expect(isKnownSalesperson(null)).toBe(false)
  })

  it('maps every real person to an account, and only them', () => {
    for (const name of ALL_SALESPERSON_VALUES) {
      if (name === 'Internal') continue
      expect(EMAIL_BY_SALESPERSON[name], `${name} needs an email`).toMatch(/@alpharoc\.ai$/)
    }
    // No mapping may point at somebody who is not on the list — that would be a
    // name nothing can ever match.
    for (const name of Object.keys(EMAIL_BY_SALESPERSON)) {
      expect(ALL_SALESPERSON_VALUES).toContain(name)
    }
  })

  it('keeps former salespeople out of the current list but inside the known set', () => {
    for (const gone of FORMER_SALESPEOPLE) {
      expect(SALESPEOPLE as readonly string[]).not.toContain(gone)
      expect(ALL_SALESPERSON_VALUES).toContain(gone)
    }
  })
})

describe('salespersonOptions', () => {
  it('offers the current people and not the departed ones', () => {
    const opts = salespersonOptions(null)
    expect(opts).toContain('Alex Pinsky')
    expect(opts).toContain('Internal')
    expect(opts).not.toContain('Steven Stubbs')
  })

  it('keeps a departed or legacy value when it is the one already set', () => {
    // Otherwise opening the picker on an old project silently reassigns it.
    expect(salespersonOptions('Steven Stubbs')[0]).toBe('Steven Stubbs')
    expect(salespersonOptions('Some Legacy Name')[0]).toBe('Some Legacy Name')
  })

  it('does not duplicate a current value', () => {
    const opts = salespersonOptions('Alex Pinsky')
    expect(opts.filter((o) => o === 'Alex Pinsky')).toHaveLength(1)
  })
})

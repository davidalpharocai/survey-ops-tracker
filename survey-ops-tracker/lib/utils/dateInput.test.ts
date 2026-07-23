import { describe, it, expect } from 'vitest'
import {
  parseDateInput, parseDateTimeInput, formatDate, formatDateTime,
  toISODate, fromISODate,
  toInstantISO, instantToLocalYMDT, instantToLocalWallClock, localWallClockToInstantISO,
} from './dateInput'

describe('parseDateInput', () => {
  it('parses M/D/YYYY', () => {
    expect(parseDateInput('7/23/2026')).toEqual({ y: 2026, m: 7, d: 23 })
  })
  it('rejects out-of-range year', () => {
    expect(parseDateInput('7/23/0202')).toBeNull()
  })
  it('rejects impossible day (Feb 30)', () => {
    expect(parseDateInput('2/30/2026')).toBeNull()
  })
  it('parses "Mon D, YYYY"', () => {
    expect(parseDateInput('Jul 6, 2026')).toEqual({ y: 2026, m: 7, d: 6 })
  })
  it('parses "Mon D" defaulting to 2026', () => {
    expect(parseDateInput('Jul 6')).toEqual({ y: 2026, m: 7, d: 6 })
  })
  it('rejects blank / em-dash placeholder', () => {
    expect(parseDateInput('—')).toBeNull()
    expect(parseDateInput('')).toBeNull()
  })
  it('respects leap years', () => {
    expect(parseDateInput('2/29/2024')).toEqual({ y: 2024, m: 2, d: 29 })
    expect(parseDateInput('2/29/2026')).toBeNull()
  })
  it('rejects bad month', () => {
    expect(parseDateInput('13/1/2026')).toBeNull()
  })
  it('rejects garbage', () => {
    expect(parseDateInput('not a date')).toBeNull()
  })
})

describe('formatDate', () => {
  it('formats as "Mon D, YYYY"', () => {
    expect(formatDate({ y: 2026, m: 7, d: 6 })).toBe('Jul 6, 2026')
  })
})

describe('toISODate / fromISODate', () => {
  it('toISODate converts a valid typed date', () => {
    expect(toISODate('7/6/2026')).toBe('2026-07-06')
  })
  it('toISODate returns empty string for invalid input', () => {
    expect(toISODate('nope')).toBe('')
    expect(toISODate('')).toBe('')
  })
  it('fromISODate parses an ISO date', () => {
    expect(fromISODate('2026-07-06')).toEqual({ y: 2026, m: 7, d: 6 })
  })
  it('round-trips toISODate -> fromISODate', () => {
    const iso = toISODate('Jul 6, 2026')
    expect(fromISODate(iso)).toEqual({ y: 2026, m: 7, d: 6 })
  })
})

describe('parseDateTimeInput', () => {
  it('parses date + 12h time with pm', () => {
    const p = parseDateTimeInput('7/14/2026 2:00pm')
    expect(p?.hh).toBe(14)
    expect(p?.mm).toBe(0)
    expect(p?.hasTime).toBe(true)
    expect(p?.y).toBe(2026)
    expect(p?.m).toBe(7)
    expect(p?.d).toBe(14)
  })
  it('rejects invalid minutes', () => {
    expect(parseDateTimeInput('7/14/2026 13:99')).toBeNull()
  })
  it('round-trips a formatted "Mon D, YYYY · h:mm AM/PM" string', () => {
    const formatted = formatDateTime({ y: 2026, m: 7, d: 16, hh: 10, mm: 0, hasTime: true })
    expect(formatted).toBe('Jul 16, 2026 · 10:00 AM')
    const p = parseDateTimeInput(formatted)
    expect(p?.hh).toBe(10)
    expect(p?.mm).toBe(0)
  })
  it('handles date-only input (no time) with hasTime false', () => {
    const p = parseDateTimeInput('7/14/2026')
    expect(p).toEqual({ y: 2026, m: 7, d: 14, hh: 0, mm: 0, hasTime: false })
  })
  it('rejects invalid date part even with valid time', () => {
    expect(parseDateTimeInput('2/30/2026 2:00pm')).toBeNull()
  })
  it('rejects blank input', () => {
    expect(parseDateTimeInput('')).toBeNull()
    expect(parseDateTimeInput('—')).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('formats a date+time', () => {
    expect(formatDateTime({ y: 2026, m: 7, d: 14, hh: 14, mm: 0, hasTime: true })).toBe('Jul 14, 2026 · 2:00 PM')
  })
  it('formats midnight as 12 AM', () => {
    expect(formatDateTime({ y: 2026, m: 7, d: 14, hh: 0, mm: 0, hasTime: true })).toBe('Jul 14, 2026 · 12:00 AM')
  })
  it('formats noon as 12 PM', () => {
    expect(formatDateTime({ y: 2026, m: 7, d: 14, hh: 12, mm: 0, hasTime: true })).toBe('Jul 14, 2026 · 12:00 PM')
  })
  it('date-only when hasTime is false', () => {
    expect(formatDateTime({ y: 2026, m: 7, d: 14, hh: 0, mm: 0, hasTime: false })).toBe('Jul 14, 2026')
  })
})

// The timestamptz bridge converts through the JS Date object, so absolute-hour
// assertions would depend on the test runner's timezone (a UTC runner makes the
// conversion a no-op). These assertions are instead timezone-agnostic: they
// verify the round-trip is lossless and that the local wall-clock a user types
// is the local wall-clock they read back — true in every timezone.
describe('timestamptz bridge (datetime)', () => {
  it('toInstantISO produces a parseable UTC instant', () => {
    const iso = toInstantISO('7/14/2026 2:00pm')
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isNaN(new Date(iso).getTime())).toBe(false)
  })
  it('toInstantISO returns empty string for invalid/empty input', () => {
    expect(toInstantISO('nope')).toBe('')
    expect(toInstantISO('')).toBe('')
  })
  it('round-trips typed local time -> instant -> local wall-clock (tz-agnostic)', () => {
    // Type 2:00 PM; after the UTC round-trip it must still read back as 2:00 PM.
    const p = instantToLocalYMDT(toInstantISO('7/14/2026 2:00pm'))
    expect(p).toEqual({ y: 2026, m: 7, d: 14, hh: 14, mm: 0, hasTime: true })
  })
  it('round-trips a stored UTC instant -> local wall-clock -> instant', () => {
    const iso = '2026-07-14T18:00:00.000Z'
    const back = localWallClockToInstantISO(instantToLocalWallClock(iso))
    expect(back).toBe(iso)
  })
  it('parses a naive offset-less legacy string as local wall-clock', () => {
    // Interim rows stored "2026-07-14T14:00" with no zone; JS reads it as local,
    // so it must still surface as 2:00 PM (not shifted by the UTC offset).
    const p = instantToLocalYMDT('2026-07-14T14:00')
    expect(p).toEqual({ y: 2026, m: 7, d: 14, hh: 14, mm: 0, hasTime: true })
  })
  it('instantToLocalYMDT / instantToLocalWallClock handle null and blanks', () => {
    expect(instantToLocalYMDT(null)).toBeNull()
    expect(instantToLocalYMDT('')).toBeNull()
    expect(instantToLocalYMDT('not-a-date')).toBeNull()
    expect(instantToLocalWallClock(null)).toBe('')
  })
  it('localWallClockToInstantISO rejects malformed input', () => {
    expect(localWallClockToInstantISO('garbage')).toBe('')
    expect(localWallClockToInstantISO('')).toBe('')
  })
})

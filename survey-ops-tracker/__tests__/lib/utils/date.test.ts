import { describe, it, expect } from 'vitest'
import { getDueDateStatus, getDueUrgency, formatDate, autoStamp, matchesDuePreset } from '@/lib/utils/date'

// Format in *local* time — toISOString() shifts to UTC, which is a different
// calendar day in the evening/morning depending on the machine's timezone,
// while the code under test does local-day math.
function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

describe('getDueUrgency', () => {
  it('returns null for null input', () => {
    expect(getDueUrgency(null)).toBe(null)
  })
  it('returns overdue for past date', () => {
    expect(getDueUrgency('2020-01-01')).toBe('overdue')
  })
  it('returns overdue for today', () => {
    expect(getDueUrgency(daysFromNow(0))).toBe('overdue')
  })
  it('returns tomorrow for 1 day out', () => {
    expect(getDueUrgency(daysFromNow(1))).toBe('tomorrow')
  })
  it('returns twodays for 2 days out', () => {
    expect(getDueUrgency(daysFromNow(2))).toBe('twodays')
  })
  it('returns normal for 3 days out', () => {
    expect(getDueUrgency(daysFromNow(3))).toBe('normal')
  })
})

describe('getDueDateStatus', () => {
  it('returns null for null input', () => {
    expect(getDueDateStatus(null)).toBe(null)
  })
  it('returns overdue for past date', () => {
    expect(getDueDateStatus('2020-01-01')).toBe('overdue')
  })
  it('returns soon for date 2 days from now', () => {
    expect(getDueDateStatus(daysFromNow(2))).toBe('soon')
  })
  it('returns normal for date 10 days from now', () => {
    expect(getDueDateStatus(daysFromNow(10))).toBe('normal')
  })
})

describe('matchesDuePreset', () => {
  it('returns true for every date when preset is null (All)', () => {
    expect(matchesDuePreset(null, null)).toBe(true)
    expect(matchesDuePreset(daysFromNow(0), null)).toBe(true)
    expect(matchesDuePreset('2020-01-01', null)).toBe(true)
  })
  it('none matches only null due dates', () => {
    expect(matchesDuePreset(null, 'none')).toBe(true)
    expect(matchesDuePreset(daysFromNow(0), 'none')).toBe(false)
  })
  it('excludes null due dates from every other preset', () => {
    for (const preset of ['overdue', 'today', 'tomorrow', 'twodays', 'week', 'month', 'custom']) {
      expect(matchesDuePreset(null, preset)).toBe(false)
    }
  })
  it('overdue matches strictly before today, not today itself', () => {
    expect(matchesDuePreset('2020-01-01', 'overdue')).toBe(true)
    expect(matchesDuePreset(daysFromNow(-1), 'overdue')).toBe(true)
    expect(matchesDuePreset(daysFromNow(0), 'overdue')).toBe(false)
  })
  it('today matches only the current day', () => {
    expect(matchesDuePreset(daysFromNow(0), 'today')).toBe(true)
    expect(matchesDuePreset(daysFromNow(-1), 'today')).toBe(false)
    expect(matchesDuePreset(daysFromNow(1), 'today')).toBe(false)
  })
  it('tomorrow matches exactly 1 day out', () => {
    expect(matchesDuePreset(daysFromNow(1), 'tomorrow')).toBe(true)
    expect(matchesDuePreset(daysFromNow(0), 'tomorrow')).toBe(false)
    expect(matchesDuePreset(daysFromNow(2), 'tomorrow')).toBe(false)
  })
  it('twodays matches exactly 2 days out', () => {
    expect(matchesDuePreset(daysFromNow(2), 'twodays')).toBe(true)
    expect(matchesDuePreset(daysFromNow(1), 'twodays')).toBe(false)
    expect(matchesDuePreset(daysFromNow(3), 'twodays')).toBe(false)
  })
  it('week matches today through 6 days out, inclusive', () => {
    expect(matchesDuePreset(daysFromNow(0), 'week')).toBe(true)
    expect(matchesDuePreset(daysFromNow(6), 'week')).toBe(true)
    expect(matchesDuePreset(daysFromNow(7), 'week')).toBe(false)
    expect(matchesDuePreset(daysFromNow(-1), 'week')).toBe(false)
  })
  it('month matches today through the end of the current calendar month', () => {
    expect(matchesDuePreset(daysFromNow(0), 'month')).toBe(true)
    const endOfMonthStr = (() => {
      const d = new Date()
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      const pad = (x: number) => String(x).padStart(2, '0')
      return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`
    })()
    expect(matchesDuePreset(endOfMonthStr, 'month')).toBe(true)
    expect(matchesDuePreset(daysFromNow(-1), 'month')).toBe(false)
  })
  it('custom range respects both bounds, inclusive', () => {
    expect(matchesDuePreset(daysFromNow(5), 'custom', daysFromNow(3), daysFromNow(7))).toBe(true)
    expect(matchesDuePreset(daysFromNow(3), 'custom', daysFromNow(3), daysFromNow(7))).toBe(true)
    expect(matchesDuePreset(daysFromNow(7), 'custom', daysFromNow(3), daysFromNow(7))).toBe(true)
    expect(matchesDuePreset(daysFromNow(2), 'custom', daysFromNow(3), daysFromNow(7))).toBe(false)
    expect(matchesDuePreset(daysFromNow(8), 'custom', daysFromNow(3), daysFromNow(7))).toBe(false)
  })
  it('custom range handles a from-only bound (on/after)', () => {
    expect(matchesDuePreset(daysFromNow(10), 'custom', daysFromNow(3), null)).toBe(true)
    expect(matchesDuePreset(daysFromNow(1), 'custom', daysFromNow(3), null)).toBe(false)
  })
  it('custom range handles a to-only bound (on/before)', () => {
    expect(matchesDuePreset(daysFromNow(1), 'custom', null, daysFromNow(3))).toBe(true)
    expect(matchesDuePreset(daysFromNow(10), 'custom', null, daysFromNow(3))).toBe(false)
  })
  it('custom range with neither bound imposes no constraint', () => {
    expect(matchesDuePreset(daysFromNow(0), 'custom', null, null)).toBe(true)
    expect(matchesDuePreset('2020-01-01', 'custom', null, null)).toBe(true)
  })
})

describe('formatDate', () => {
  it('returns em dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })
  it('formats a date as Mon DD', () => {
    const result = formatDate('2026-06-15')
    expect(result).toMatch(/Jun 15/)
  })
})

describe('autoStamp', () => {
  it('creates new entry when no existing notes', () => {
    const result = autoStamp('David', null, 'Waiting on client')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(result).toContain('David')
    expect(result).toContain('Waiting on client')
  })
  it('appends to existing notes', () => {
    const result = autoStamp('David', 'Old note', 'New note')
    expect(result).toContain('Old note')
    expect(result).toContain('New note')
  })
})

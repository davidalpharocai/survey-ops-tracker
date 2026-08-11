import { describe, it, expect } from 'vitest'
import { placeholderWaveDates } from './placeholders'

describe('placeholderWaveDates', () => {
  it('emits one date per missed monthly wave (~4-month gap → 4 dates)', () => {
    // base 2026-01-01, monthly, today 2026-05-01 → Feb/Mar/Apr/May
    expect(placeholderWaveDates('2026-01-01', 1, '2026-05-01')).toEqual([
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ])
  })

  it('steps by the cadence for a quarterly series', () => {
    // base 2025-06-01, quarterly, today 2026-06-01 → Sep/Dec/Mar/Jun
    expect(placeholderWaveDates('2025-06-01', 3, '2026-06-01')).toEqual([
      '2025-09-01',
      '2025-12-01',
      '2026-03-01',
      '2026-06-01',
    ])
  })

  it('includes a wave landing exactly on today (inclusive of <= today)', () => {
    const dates = placeholderWaveDates('2026-01-01', 1, '2026-05-01')
    expect(dates[dates.length - 1]).toBe('2026-05-01')
  })

  it('returns [] when base is already today or later (no gap)', () => {
    expect(placeholderWaveDates('2026-05-01', 1, '2026-05-01')).toEqual([])
    expect(placeholderWaveDates('2026-06-01', 1, '2026-05-01')).toEqual([])
  })

  it('returns [] when cadence is null or zero', () => {
    expect(placeholderWaveDates('2026-01-01', null, '2026-05-01')).toEqual([])
    expect(placeholderWaveDates('2026-01-01', 0, '2026-05-01')).toEqual([])
  })

  it('returns [] when base is null', () => {
    expect(placeholderWaveDates(null, 1, '2026-05-01')).toEqual([])
  })

  it('handles month/year rollover across the year boundary', () => {
    // base 2025-11-15, monthly, today 2026-02-01: Dec 15 + Jan 15 qualify;
    // Feb 15 (> today) is excluded. Confirms Nov→Dec→Jan crosses the year.
    expect(placeholderWaveDates('2025-11-15', 1, '2026-02-01')).toEqual([
      '2025-12-15',
      '2026-01-15',
    ])
  })

  it('leaves next-due in the future: last date + cadence is strictly after today', () => {
    const today = '2026-05-01'
    const cadence = 1
    const dates = placeholderWaveDates('2026-01-01', cadence, today)
    const last = dates[dates.length - 1]
    // Step the last placeholder forward by the cadence — this is the new next-due.
    const d = new Date(last + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + cadence)
    const nextDue = d.toISOString().slice(0, 10)
    expect(nextDue > today).toBe(true)
  })

  it('handles a quarterly year+ rollover keeping day-of-month', () => {
    // base 2024-10-10, quarterly, today 2026-01-15
    expect(placeholderWaveDates('2024-10-10', 3, '2026-01-15')).toEqual([
      '2025-01-10',
      '2025-04-10',
      '2025-07-10',
      '2025-10-10',
      '2026-01-10',
    ])
  })
})

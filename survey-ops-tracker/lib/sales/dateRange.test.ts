import { describe, it, expect } from 'vitest'
import { rangeFor, dateOf, filterByRange, describeRange } from './dateRange'

/** Fixed "today" — a Wednesday in Q3, chosen so quarter and year boundaries are
 *  a known distance away rather than whatever the clock happens to say. */
const TODAY = '2026-09-09'

describe('rangeFor', () => {
  it('all time is unbounded at both ends', () => {
    expect(rangeFor('all', TODAY)).toEqual({ from: null, to: null })
  })

  it('last 30 days INCLUDES today, so it spans 30 dates not 31', () => {
    // The off-by-one that makes a "30 day" export quietly contain 31 days.
    const r = rangeFor('last30', TODAY)
    expect(r).toEqual({ from: '2026-08-11', to: '2026-09-09' })
    const days = (Date.parse(r.to!) - Date.parse(r.from!)) / 86_400_000 + 1
    expect(days).toBe(30)
  })

  it('last 90 days likewise spans exactly 90', () => {
    const r = rangeFor('last90', TODAY)
    const days = (Date.parse(r.to!) - Date.parse(r.from!)) / 86_400_000 + 1
    expect(days).toBe(90)
  })

  it('this quarter starts on the quarter boundary', () => {
    expect(rangeFor('qtd', '2026-09-09')).toEqual({ from: '2026-07-01', to: '2026-09-09' })
    expect(rangeFor('qtd', '2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-01-15' })
    expect(rangeFor('qtd', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-04-01' })
    expect(rangeFor('qtd', '2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-31' })
  })

  it('this year starts on 1 January', () => {
    expect(rangeFor('ytd', TODAY)).toEqual({ from: '2026-01-01', to: '2026-09-09' })
  })

  it('last year is the whole of the previous calendar year', () => {
    expect(rangeFor('lastyear', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it('does not roll a date back across a timezone offset', () => {
    // Parsing at midnight rather than midday is how "1 Jan" becomes "31 Dec"
    // for anyone west of UTC.
    expect(rangeFor('ytd', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-01' })
    expect(rangeFor('qtd', '2026-07-01').from).toBe('2026-07-01')
  })

  it('passes a custom range through untouched', () => {
    expect(rangeFor('custom', TODAY, { from: '2026-03-01', to: '2026-03-31' }))
      .toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(rangeFor('custom', TODAY)).toEqual({ from: null, to: null })
  })
})

describe('dateOf', () => {
  const row = {
    delivered_at: '2026-08-20T14:00:00Z',
    deliver_date: '2026-08-15',
    submitted_date: '2026-06-01',
    launch_date: '2026-07-04',
  }

  it('reads each basis from its own field', () => {
    expect(dateOf(row, 'submitted')).toBe('2026-06-01')
    expect(dateOf(row, 'launched')).toBe('2026-07-04')
  })

  it('prefers the ACTUAL delivery date over the promised one', () => {
    expect(dateOf(row, 'delivered')).toBe('2026-08-20')
  })

  it('falls back to the promised date for a survey still in flight', () => {
    expect(dateOf({ ...row, delivered_at: null }, 'delivered')).toBe('2026-08-15')
  })

  it('is null when the row has no date on that basis', () => {
    expect(dateOf({}, 'delivered')).toBeNull()
    expect(dateOf({ delivered_at: null, deliver_date: null }, 'delivered')).toBeNull()
    expect(dateOf({ submitted_date: null }, 'submitted')).toBeNull()
  })
})

describe('filterByRange', () => {
  const rows = [
    { id: 'a', deliver_date: '2026-08-01', submitted_date: '2026-01-01' },
    { id: 'b', deliver_date: '2026-09-05', submitted_date: '2026-02-01' },
    { id: 'c', deliver_date: null, submitted_date: '2026-03-01' },   // in flight
    { id: 'd', deliver_date: '2025-12-01', submitted_date: '2025-11-01' },
  ]

  it('keeps every row, undated included, when the range is unbounded', () => {
    const r = filterByRange(rows, 'delivered', { from: null, to: null })
    expect(r.rows).toHaveLength(4)
    expect(r.undated).toBe(0)
  })

  it('excludes a row with no date on the chosen basis, and counts it', () => {
    // The in-flight survey has not been delivered, so it is not part of "what
    // you received this quarter" — but the caller is told it was dropped.
    const r = filterByRange(rows, 'delivered', { from: '2026-07-01', to: '2026-09-30' })
    expect(r.rows.map(x => x.id)).toEqual(['a', 'b'])
    expect(r.undated).toBe(1)
  })

  it('is inclusive at both ends', () => {
    const r = filterByRange(rows, 'delivered', { from: '2026-08-01', to: '2026-09-05' })
    expect(r.rows.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('gives a different answer per basis, which is the reason basis is a choice', () => {
    const range = { from: '2026-01-01', to: '2026-06-30' }
    expect(filterByRange(rows, 'delivered', range).rows.map(x => x.id)).toEqual([])
    expect(filterByRange(rows, 'submitted', range).rows.map(x => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('handles an open-ended range at either side', () => {
    expect(filterByRange(rows, 'delivered', { from: '2026-01-01', to: null }).rows.map(x => x.id)).toEqual(['a', 'b'])
    expect(filterByRange(rows, 'delivered', { from: null, to: '2026-01-01' }).rows.map(x => x.id)).toEqual(['d'])
  })
})

describe('describeRange', () => {
  it('states the basis as well as the dates, so an export can be checked', () => {
    expect(describeRange('delivered', { from: '2026-07-01', to: '2026-09-30' }))
      .toBe('Delivered Jul 1, 2026 – Sep 30, 2026')
  })

  it('says all time rather than leaving it blank', () => {
    expect(describeRange('submitted', { from: null, to: null })).toBe('Submitted · all time')
  })

  it('handles a one-sided range', () => {
    expect(describeRange('launched', { from: '2026-01-01', to: null })).toBe('Launched from Jan 1, 2026')
    expect(describeRange('launched', { from: null, to: '2026-01-01' })).toBe('Launched up to Jan 1, 2026')
  })
})

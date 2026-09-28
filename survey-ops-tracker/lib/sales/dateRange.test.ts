import { describe, it, expect } from 'vitest'
import { rangeFor, dateOf, filterByRange, describeRange, todayET, etDate, etTime } from './dateRange'

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
    board_column: 'Delivery', status: 'Closed', phase: 'Active',
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

  it('reads the delivery timestamp in EASTERN time, not UTC', () => {
    // PR00358: delivered 9:53pm ET on 24 August, which is already the 25th in
    // UTC. The slice(0, 10) this replaced printed the 25th.
    expect(dateOf({ ...row, delivered_at: '2026-08-25T01:53:27.453012+00:00' }, 'delivered')).toBe('2026-08-24')
  })

  it('uses the promised date for a DELIVERED card that has no timestamp', () => {
    expect(dateOf({ ...row, delivered_at: null }, 'delivered')).toBe('2026-08-15')
  })

  it('gives a survey that is NOT delivered no delivered date, whatever it was promised for', () => {
    // PR00257: in field and past due. The old fallback put it in "delivered
    // this quarter" through its due date.
    const inField = { ...row, board_column: 'Fielding', status: 'Open', delivered_at: null, deliver_date: '2026-09-23' }
    expect(dateOf(inField, 'delivered')).toBeNull()
    // and a row with no stage at all is not taken as delivered
    expect(dateOf({ deliver_date: '2026-09-23' }, 'delivered')).toBeNull()
  })

  it('is null when the row has no date on that basis', () => {
    expect(dateOf({}, 'delivered')).toBeNull()
    expect(dateOf({ board_column: 'Delivery', delivered_at: null, deliver_date: null }, 'delivered')).toBeNull()
    expect(dateOf({ submitted_date: null }, 'submitted')).toBeNull()
  })
})

describe('filterByRange', () => {
  const D = { board_column: 'Delivery', status: 'Closed', phase: 'Active' }
  const rows = [
    { id: 'a', ...D, deliver_date: '2026-08-01', submitted_date: '2026-01-01' },
    { id: 'b', ...D, deliver_date: '2026-09-05', submitted_date: '2026-02-01' },
    { id: 'c', board_column: 'Fielding', status: 'Open', phase: 'Active', deliver_date: '2026-08-10', submitted_date: '2026-03-01' },   // in flight
    { id: 'd', ...D, deliver_date: '2025-12-01', submitted_date: '2025-11-01' },
    { id: 'e', ...D, deliver_date: null, delivered_at: null, submitted_date: null },   // delivered, no date on record
  ]

  it('keeps every row, undated included, when the range is unbounded', () => {
    const r = filterByRange(rows, 'delivered', { from: null, to: null })
    expect(r.rows).toHaveLength(5)
    expect(r.undated).toBe(0)
    expect(r.notDelivered).toBe(0)
  })

  it('counts NOT DELIVERED apart from delivered-with-no-date', () => {
    // The in-flight survey is not part of "what you received this quarter",
    // even though its due date falls inside it; the delivered one with no date
    // is a missing record. Different fixes, so different counts.
    const r = filterByRange(rows, 'delivered', { from: '2026-07-01', to: '2026-09-30' })
    expect(r.rows.map(x => x.id)).toEqual(['a', 'b'])
    expect(r.notDelivered).toBe(1)
    expect(r.undated).toBe(1)
  })

  it('never counts notDelivered on the other bases', () => {
    const r = filterByRange(rows, 'submitted', { from: '2026-01-01', to: '2026-12-31' })
    expect(r.rows.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(r.notDelivered).toBe(0)
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

describe('todayET / etDate', () => {
  it('is still today in New York after 8pm, when UTC has moved on', () => {
    // 9:30pm EDT on 24 September is 01:30 UTC on the 25th.
    expect(todayET(new Date('2026-09-25T01:30:00Z'))).toBe('2026-09-24')
    expect(new Date('2026-09-25T01:30:00Z').toISOString().slice(0, 10)).toBe('2026-09-25')
  })

  it('turns over at midnight Eastern', () => {
    expect(todayET(new Date('2026-09-25T03:59:00Z'))).toBe('2026-09-24')
    expect(todayET(new Date('2026-09-25T04:00:00Z'))).toBe('2026-09-25')
  })

  it('follows the clocks in winter (EST, five hours behind)', () => {
    expect(todayET(new Date('2026-12-01T04:30:00Z'))).toBe('2026-11-30')
    expect(todayET(new Date('2026-12-01T05:00:00Z'))).toBe('2026-12-01')
  })

  it('moves the quarter on the ET date, not the UTC one', () => {
    // The evening of 30 September ET is already 1 October UTC.
    expect(rangeFor('qtd', todayET(new Date('2026-10-01T02:00:00Z')))).toEqual({ from: '2026-07-01', to: '2026-09-30' })
  })

  it('passes a bare date through, and refuses nonsense rather than printing Invalid Date', () => {
    expect(etDate('2026-08-15')).toBe('2026-08-15')
    expect(etDate(null)).toBeNull()
    expect(etDate('')).toBeNull()
    expect(etDate('not a date')).toBeNull()
  })
})

describe('etTime: the clock time sales sees next to "N updated"', () => {
  it('reads the wall clock in New York, not on the server', () => {
    // 12:24 UTC is 8:24 in the morning in New York during daylight time, which
    // is when four of Alex's studies were last touched on 28 Sep. Rendered in
    // the server's own zone it would say lunchtime.
    expect(etTime('2026-09-28T12:24:30.000Z')).toBe('8:24 AM')
  })

  it('does not roll an evening edit into the next day', () => {
    // The bug this page has had twice: 01:23 UTC is still 9:23 PM yesterday in
    // New York. The date and the time have to come from the same conversion.
    expect(etDate('2026-09-24T01:23:44.000Z')).toBe('2026-09-23')
    expect(etTime('2026-09-24T01:23:44.000Z')).toBe('9:23 PM')
  })

  it('says nothing rather than inventing midnight for a bare date', () => {
    // A date with no time carries no time. Showing "12:00 AM" would be a
    // measurement we never made.
    expect(etTime('2026-08-15')).toBeNull()
    expect(etTime(null)).toBeNull()
    expect(etTime('')).toBeNull()
    expect(etTime('not a date')).toBeNull()
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

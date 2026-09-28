import { describe, it, expect } from 'vitest'
import {
  addMonths, daysBetween, formatRange, inRange, isoOrNull, isWholeMonths, monthCoverage, monthsBetween, previousRange,
  rangeWords, resolveRange, shiftMonths, todayET, trendMonths, MAX_TREND_MONTHS, RANGE_PRESETS, type RangeChoice, type RangePreset,
} from './range'

const TODAY = '2026-09-27'
const C = (preset: RangePreset, from: string | null = null, to: string | null = null): RangeChoice => ({ preset, from, to })

describe('resolveRange', () => {
  it('this month runs from the 1st to today', () => {
    expect(resolveRange(C('this-month'), TODAY)).toEqual({ from: '2026-09-01', to: TODAY })
  })
  it('last month is the whole calendar month, across a year end too', () => {
    expect(resolveRange(C('last-month'), TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveRange(C('last-month'), '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolveRange(C('last-month'), '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('this quarter starts on the quarter', () => {
    expect(resolveRange(C('this-quarter'), TODAY)).toEqual({ from: '2026-07-01', to: TODAY })
    expect(resolveRange(C('this-quarter'), '2026-02-03')).toEqual({ from: '2026-01-01', to: '2026-02-03' })
  })
  it('since 1 Jun and last 12 months', () => {
    expect(resolveRange(C('since-jun-1'), TODAY)).toEqual({ from: '2026-06-01', to: TODAY })
    // This month so far plus the 11 whole months before it: month-aligned, so
    // the monthly chart has no half-month at its left edge.
    expect(resolveRange(C('last-12-months'), TODAY)).toEqual({ from: '2025-10-01', to: TODAY })
  })
  it('custom reads its bounds, swaps a back-to-front pair and ignores a non-date', () => {
    expect(resolveRange(C('custom', '2026-08-03', '2026-09-10'), TODAY)).toEqual({ from: '2026-08-03', to: '2026-09-10' })
    expect(resolveRange(C('custom', '2026-09-10', '2026-08-03'), TODAY)).toEqual({ from: '2026-08-03', to: '2026-09-10' })
    expect(resolveRange(C('custom', '2026-02-30', null), TODAY)).toEqual({ from: null, to: null })
  })
  it('all time is unbounded', () => {
    expect(resolveRange(C('all'), TODAY)).toEqual({ from: null, to: null })
  })
})

describe('previousRange — the same span, immediately before', () => {
  it('this month so far is compared with the same days of last month', () => {
    expect(previousRange(C('this-month'), TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-27' })
  })
  it('clamps to a shorter month instead of spilling into the next', () => {
    expect(previousRange(C('this-month'), '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('last month is compared with the whole month before it', () => {
    expect(previousRange(C('last-month'), TODAY)).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(previousRange(C('last-month'), '2026-08-05')).toEqual({ from: '2026-06-01', to: '2026-06-30' })
  })
  it('this quarter so far against the same days of last quarter', () => {
    expect(previousRange(C('this-quarter'), TODAY)).toEqual({ from: '2026-04-01', to: '2026-06-27' })
  })
  it('last 12 months against the 12 before', () => {
    expect(previousRange(C('last-12-months'), TODAY)).toEqual({ from: '2024-10-01', to: '2025-09-27' })
  })
  it('since 1 Jun and custom shift back by an equal number of days', () => {
    const cur = resolveRange(C('since-jun-1'), TODAY)
    const prev = previousRange(C('since-jun-1'), TODAY)!
    expect(daysBetween(prev.from!, prev.to!)).toBe(daysBetween(cur.from!, cur.to!))
    expect(prev.to).toBe('2026-05-31')
    expect(previousRange(C('custom', '2026-09-01', '2026-09-10'), TODAY)).toEqual({ from: '2026-08-22', to: '2026-08-31' })
  })
  it('a custom range of whole months is compared with the whole months before it, like the chart', () => {
    // The month column's "Filter the page to 1–31 May 2026" link makes this
    // range; the April it is compared with must be the April column.
    expect(previousRange(C('custom', '2026-05-01', '2026-05-31'), TODAY)).toEqual({ from: '2026-04-01', to: '2026-04-30' })
    expect(previousRange(C('custom', '2026-03-01', '2026-03-31'), TODAY)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    // Several whole months, across a year end.
    expect(previousRange(C('custom', '2026-01-01', '2026-02-28'), TODAY)).toEqual({ from: '2025-11-01', to: '2025-12-31' })
    // Not whole months: still the same number of days.
    expect(previousRange(C('custom', '2026-05-02', '2026-05-31'), TODAY)).toEqual({ from: '2026-04-02', to: '2026-05-01' })
  })
  it('a running preset that has reached its month end is compared with whole months too', () => {
    // On 30 Sep "this month" is all of September: compared with all of August.
    expect(previousRange(C('this-month'), '2026-09-30')).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(previousRange(C('this-quarter'), '2026-09-30')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(previousRange(C('since-jun-1'), '2026-09-30')).toEqual({ from: '2026-02-01', to: '2026-05-31' })
  })
  it('isWholeMonths', () => {
    expect(isWholeMonths({ from: '2026-05-01', to: '2026-05-31' })).toBe(true)
    expect(isWholeMonths({ from: '2026-02-01', to: '2026-02-28' })).toBe(true)
    expect(isWholeMonths({ from: '2026-05-02', to: '2026-05-31' })).toBe(false)
    expect(isWholeMonths({ from: '2026-05-01', to: '2026-05-30' })).toBe(false)
    expect(isWholeMonths({ from: '2026-05-01', to: null })).toBe(false)
  })
  it('all time and a one-sided custom range have no previous period', () => {
    expect(previousRange(C('all'), TODAY)).toBeNull()
    expect(previousRange(C('custom', '2026-09-01', null), TODAY)).toBeNull()
  })
})

describe('inRange', () => {
  it('a bounded range never admits a missing date; an unbounded one does', () => {
    expect(inRange(null, { from: '2026-09-01', to: null })).toBe(false)
    expect(inRange(null, { from: null, to: null })).toBe(true)
    expect(inRange('2026-09-01', { from: '2026-09-01', to: '2026-09-30' })).toBe(true)
    expect(inRange('2026-08-31', { from: '2026-09-01', to: '2026-09-30' })).toBe(false)
    expect(inRange('2026-09-30', { from: '2026-09-01', to: '2026-09-30' })).toBe(true)
  })
})

describe('months', () => {
  it('shiftMonths and addMonths cross year ends and clamp days', () => {
    expect(shiftMonths('2026-01-31', -2)).toBe('2025-11-30')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
  it('a one-month range still draws six months of context', () => {
    expect(trendMonths(resolveRange(C('this-month'), TODAY), TODAY, null)).toEqual(
      ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
  })
  it('a long range draws all of it, capped', () => {
    expect(trendMonths(resolveRange(C('last-12-months'), TODAY), TODAY, null)).toHaveLength(12)
    expect(trendMonths({ from: '2010-01-01', to: TODAY }, TODAY, null)).toHaveLength(MAX_TREND_MONTHS)
  })
  it('all time starts at the first month with a delivery', () => {
    expect(trendMonths({ from: null, to: null }, TODAY, '2026-02')[0]).toBe('2026-02')
  })
  it('knows which months are wholly, partly or not in the range', () => {
    const r = { from: '2026-08-15', to: '2026-09-27' }
    expect(monthCoverage('2026-07', r)).toBe('out')
    expect(monthCoverage('2026-08', r)).toBe('partial')
    expect(monthCoverage('2026-09', r)).toBe('partial')
    expect(monthCoverage('2026-08', { from: '2026-08-01', to: '2026-08-31' })).toBe('in')
  })
})

describe('words', () => {
  it('formats ranges compactly', () => {
    expect(formatRange({ from: '2026-09-01', to: '2026-09-27' })).toBe('1–27 Sep 2026')
    expect(formatRange({ from: '2026-08-01', to: '2026-09-27' })).toBe('1 Aug–27 Sep 2026')
    expect(formatRange({ from: '2025-10-01', to: '2026-09-27' })).toBe('1 Oct 2025–27 Sep 2026')
    expect(formatRange({ from: null, to: null })).toBe('All time')
    expect(formatRange({ from: '2026-06-01', to: null })).toBe('From 1 Jun 2026')
  })
  it('ends a sentence', () => {
    expect(rangeWords(C('this-month'), TODAY)).toBe('so far in September')
    expect(rangeWords(C('last-month'), TODAY)).toBe('in August')
    expect(rangeWords(C('since-jun-1'), TODAY)).toBe('since 1 June')
    expect(rangeWords(C('all'), TODAY)).toBe('to date')
    expect(rangeWords(C('custom', '2026-08-03', '2026-09-10'), TODAY)).toBe('between 3 Aug and 10 Sep 2026')
  })
  it('offers the seven presets, the Since label written from its start date', () => {
    expect(RANGE_PRESETS.map(p => p.label)).toEqual(
      ['This month', 'Last month', 'This quarter', 'Since 1 Jun 2026', 'Last 12 months', 'Custom', 'All time'])
  })
  it('isoOrNull only accepts real calendar dates', () => {
    expect(isoOrNull('2026-02-28')).toBe('2026-02-28')
    expect(isoOrNull('2026-02-30')).toBeNull()
    expect(isoOrNull('27/09/2026')).toBeNull()
  })
  it('todayET uses the New York calendar', () => {
    // 02:00 UTC on 1 Oct is still 30 Sep in New York.
    expect(todayET(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30')
  })
})

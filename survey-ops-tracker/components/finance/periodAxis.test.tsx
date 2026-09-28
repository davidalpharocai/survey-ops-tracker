import { describe, it, expect } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import { dayLong, dayShort, monthLong, monthShort, spansYears } from './periodAxis'
import { MonthChart } from './results/MonthChart'
import { monthLabel } from '@/lib/finance/coverage'
import type { MonthBar } from '@/lib/finance/results'

/**
 * David, 2026-09-28: a chart over "the last 12 months" has to say WHICH month
 * each mark is. These pin the two halves of that: the rule that decides when a
 * drawn label needs its year, and the month chart actually printing it.
 */

const bar = (key: string, i: number): MonthBar => ({
  key,
  label: monthLabel(key),
  short: monthLabel(key).slice(0, 3),
  price: 1000 + i * 10, cost: 600 + i * 10, kept: 400, keptPct: 0.4, paidKeptPct: 0.4,
  surveys: 4, paidSurveys: 4, freeSurveys: 0, freeCost: 0,
  spendNoPrice: 0, surveysNoPrice: 0, delivered: 4, priced: 4, spend: 600 + i * 10,
  pricedShare: 1, beforeReliable: false, thin: false, note: null,
  recoveriesPending: false, rewardedSurveys: 0, creditedSurveys: 0,
  ids: [], from: `${key}-01`, to: `${key}-28`,
})
/** `n` months ending at 'YYYY-MM'. */
const monthsTo = (end: string, n: number): MonthBar[] => {
  const [y, m] = end.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const t = y * 12 + (m - 1) - (n - 1 - i)
    return bar(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`, i)
  })
}

describe('period axis labels', () => {
  it('asks for the year only when the axis crosses one', () => {
    expect(spansYears(['2026-01', '2026-12'])).toBe(false)
    expect(spansYears(['2025-12', '2026-01'])).toBe(true)
    expect(spansYears(['2026-09-07', '2026-12-28'])).toBe(false)
    expect(spansYears(['2025-12-29', '2026-01-05'])).toBe(true)
    // The Undated bucket carries no year, so it neither makes nor breaks the case.
    expect(spansYears(['2026-03', 'undated'])).toBe(false)
    expect(spansYears([])).toBe(false)
  })

  it('names a month long for the tooltip and short for the axis', () => {
    expect(monthLong('2026-09')).toBe('Sep 2026')
    expect(monthShort('2026-09', false)).toBe('Sep')
    expect(monthShort('2026-09', true)).toBe('Sep 26')
    expect(monthShort('2025-09', true)).toBe('Sep 25')
    expect(monthShort('undated', true)).toBe('Und.')
  })

  it('names a week by its Monday, with the year when the axis crosses one', () => {
    expect(dayLong('2026-09-07')).toBe('7 Sep 2026')
    expect(dayShort('2026-09-07', false)).toBe('7 Sep')
    expect(dayShort('2026-09-07', true)).toBe('7 Sep 26')
    expect(dayShort('2025-12-29', true)).toBe('29 Dec 25')
  })
})

describe('MonthChart axis', () => {
  const chartOf = (container: HTMLElement) =>
    container.querySelector('figure[aria-label^="Client price against our cost"]') as HTMLElement
  /** What a label PRINTS — a FitText carries its long form as a <title>
   *  child, which textContent would silently fold into the drawn words. */
  const drawn = (t: Element) =>
    [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent ?? '').join('')
  const axisTexts = (container: HTMLElement) =>
    [...chartOf(container).querySelectorAll('svg text')].map(drawn)

  it('prints the month and the year on a window that crosses a year', () => {
    // The "last 12 months" preset always crosses one.
    const { container } = render(<MonthChart months={monthsTo('2026-09', 12)} costReliableFrom={null} onSelect={() => {}} />)
    const texts = axisTexts(container)
    expect(texts).toContain('Sep 26')
    expect(texts).toContain('Oct 25')
    // Never the bare month: "Sep" here would be one of two different months.
    expect(texts).not.toContain('Sep')
  })

  it('keeps the full month on the drawn label, the mark and the table', () => {
    const { container } = render(<MonthChart months={monthsTo('2026-09', 12)} costReliableFrom={null} onSelect={() => {}} />)
    const newest = [...chartOf(container).querySelectorAll('svg text')].find(t => drawn(t) === 'Sep 26')!
    // The axis is terse, not lossy: the long form rides along as its title.
    expect(newest.querySelector('title')?.textContent).toBe('Sep 2026')
    // The mark a reader hovers or tabs to names the month in full.
    expect(chartOf(container).querySelector('[aria-label^="Sep 2026,"]')).toBeTruthy()
    // And so does the table twin, which is where a thinned month is read.
    fireEvent.click(within(chartOf(container)).getByRole('button', { name: 'View as table' }))
    expect(within(chartOf(container)).getByRole('table')).toHaveTextContent('Sep 2026')
  })

  it('drops the year when every month is in the same one', () => {
    const { container } = render(<MonthChart months={monthsTo('2026-09', 5)} costReliableFrom={null} onSelect={() => {}} />)
    const texts = axisTexts(container)
    expect(texts).toContain('Sep')
    expect(texts).not.toContain('Sep 26')
  })

  it('names every month, which the full label could not', () => {
    const months = monthsTo('2026-09', 12)
    const { container } = render(<MonthChart months={months} costReliableFrom={null} onSelect={() => {}} />)
    const labels = axisTexts(container).filter(t => /^[A-Z][a-z]{2} \d\d$/.test(t))
    // At the 640px width jsdom renders at, "Sep 2026" thins to about half the
    // months. The point of the short form is that it does not.
    expect(labels).toHaveLength(months.length)
  })
})

describe('logging strip axis', () => {
  it('is the same rule, on weeks', () => {
    const weeks = ['2025-12-29', '2026-01-05', '2026-01-12']
    const cross = spansYears(weeks)
    expect(cross).toBe(true)
    expect(weeks.map(w => dayShort(w, cross))).toEqual(['29 Dec 25', '5 Jan 26', '12 Jan 26'])
  })
})

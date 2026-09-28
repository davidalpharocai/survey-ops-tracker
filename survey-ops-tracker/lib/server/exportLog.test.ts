import { describe, it, expect } from 'vitest'
import { compactFilters } from './exportLog'

/**
 * The filters object is written by the browser, so the log bounds it before it
 * reaches the table — and keeps `false`, which is what the finance export's
 * audit row exists to say ("scoping included: false", "date applied: false").
 */

describe('compactFilters', () => {
  it('keeps false and zero, and drops only null and empty', () => {
    expect(compactFilters({ scoping_included: false, date_applied: false, rows: 0, account: null, route: '' }))
      .toEqual({ scoping_included: false, date_applied: false, rows: 0 })
  })

  it('records nothing for nothing', () => {
    expect(compactFilters(null)).toBeNull()
    expect(compactFilters([1, 2])).toBeNull()
    expect(compactFilters('tab=results')).toBeNull()
    expect(compactFilters({ a: null, b: '' })).toBeNull()
  })

  it('bounds what a patched browser could park in the log', () => {
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'x'.repeat(5000)]))
    const out = compactFilters({ ...big, list: Array.from({ length: 500 }, () => 'y') }) as Record<string, unknown>
    expect(Object.keys(out)).toHaveLength(40)
    expect(String(out.k0)).toHaveLength(300)
    expect(compactFilters({ list: Array.from({ length: 500 }, (_, i) => i) })).toEqual({
      list: Array.from({ length: 50 }, (_, i) => String(i)),
    })
  })

  it('never writes a non-finite number as a number', () => {
    expect(compactFilters({ n: Number.POSITIVE_INFINITY })).toEqual({ n: 'Infinity' })
  })
})

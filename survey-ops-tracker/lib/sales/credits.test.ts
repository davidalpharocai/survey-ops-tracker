import { describe, it, expect } from 'vitest'
import { rollUp, consumptionFor, describeConsumption } from './credits'

const s = (id: string, credits: number | null, term_id: string | null = 't1') => ({ id, credits, term_id })

describe('rollUp', () => {
  it('sums the recorded credits', () => {
    const c = rollUp([s('a', 100), s('b', 250)], 1000)
    expect(c.used).toBe(350)
    expect(c.priced).toBe(2)
    expect(c.remaining).toBe(650)
    expect(c.pct).toBe(35)
    expect(c.isFloor).toBe(false)
  })

  it('does NOT count an unpriced survey as zero', () => {
    // The whole point. survey_projects.credits is null on every row in
    // production today; treating null as 0 would report "0 used" as a fact to a
    // client who has had work delivered.
    const c = rollUp([s('a', 100), s('b', null), s('c', null)], 1000)
    expect(c.used).toBe(100)
    expect(c.priced).toBe(1)
    expect(c.unpriced).toBe(2)
    expect(c.isFloor).toBe(true)
  })

  it('counts a genuine zero as priced, because 0 is an answer', () => {
    const c = rollUp([s('a', 0)], 1000)
    expect(c.priced).toBe(1)
    expect(c.unpriced).toBe(0)
    expect(c.isFloor).toBe(false)
    expect(c.used).toBe(0)
  })

  it('reports going over the allowance rather than clamping it', () => {
    const c = rollUp([s('a', 1200)], 1000)
    expect(c.remaining).toBe(-200)
    expect(c.pct).toBe(120)
  })

  it('has no percentage when there is no allowance', () => {
    const c = rollUp([s('a', 100)], null)
    expect(c.total).toBeNull()
    expect(c.remaining).toBeNull()
    expect(c.pct).toBeNull()
  })

  it('does not divide by a zero allowance', () => {
    // A term that bought nothing would otherwise give Infinity, which renders
    // as a progress bar of unbounded width.
    const c = rollUp([s('a', 10)], 0)
    expect(c.pct).toBeNull()
    expect(Number.isFinite(c.used)).toBe(true)
  })

  it('handles an empty set', () => {
    const c = rollUp([], 1000)
    expect(c).toMatchObject({ used: 0, priced: 0, unpriced: 0, remaining: 1000, pct: 0, isFloor: false })
  })
})

describe('consumptionFor', () => {
  const term = { id: 't1', name: '2026', credits_total: 1000 }

  it('counts only the surveys attached to that term', () => {
    const c = consumptionFor(term, [s('a', 100, 't1'), s('b', 500, 't2'), s('c', 50, null)])
    expect(c.used).toBe(100)
    expect(c.priced).toBe(1)
  })

  it('is empty, not wrong, when nothing is attached yet', () => {
    // client_terms has 0 rows and no survey carries a term_id, so this is the
    // live case today.
    const c = consumptionFor(term, [s('a', 100, null)])
    expect(c.used).toBe(0)
    expect(c.priced).toBe(0)
    expect(c.remaining).toBe(1000)
  })
})

describe('describeConsumption', () => {
  it('states the position plainly when everything is known', () => {
    expect(describeConsumption(rollUp([s('a', 350)], 1000)))
      .toBe('350 of 1,000 credits used (35%), 650 remaining.')
  })

  it('says the figure is a floor when something is unpriced', () => {
    const t = describeConsumption(rollUp([s('a', 350), s('b', null)], 1000))
    expect(t).toContain('floor')
    expect(t).toContain('1 survey is not priced yet')
  })

  it('distinguishes "nothing used" from "nothing recorded"', () => {
    const t = describeConsumption(rollUp([s('a', null), s('b', null)], 1000))
    expect(t).toContain('not recorded')
    expect(t).not.toMatch(/\b0 of 1,000\b/)
  })

  it('says OVER rather than a negative remaining', () => {
    const t = describeConsumption(rollUp([s('a', 1200)], 1000))
    expect(t).toContain('OVER')
    expect(t).not.toContain('-200')
  })

  it('says so when there is no allowance to measure against', () => {
    expect(describeConsumption(rollUp([s('a', 100)], null)))
      .toContain('No term allowance recorded')
  })

  it('handles the completely empty case without asserting anything false', () => {
    const t = describeConsumption(rollUp([], null))
    expect(t).toBe('No term recorded, and none of these surveys is priced in credits yet.')
  })
})

import { describe, it, expect } from 'vitest'
import {
  rollUp, consumptionFor, describeConsumption, hasDrawn, currentTerm, creditPosition,
} from './credits'

/**
 * A survey that has FIELDED, which is what draws credits (migration 100). The
 * default here is deliberately drawn: every one of these cases is about the
 * arithmetic, and a helper that silently produced un-drawn rows would make them
 * all pass for the wrong reason.
 */
const s = (id: string, credits: number | null, term_id: string | null = 't1') =>
  ({ id, credits, term_id, board_column: 'Delivery', n_collected: 100, n_actual: null })

/** Priced, but never fielded — committed, not drawn. */
const unfielded = (id: string, credits: number | null, term_id: string | null = 't1') =>
  ({ id, credits, term_id, board_column: 'Doc Programming', n_collected: 0, n_actual: null })

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
    expect(c).toMatchObject({ used: 0, priced: 0, unpriced: 0, committed: 0, remaining: 1000, pct: 0, isFloor: false })
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

describe('hasDrawn — migration 100 says consumption IS the stage', () => {
  const at = (board_column: string, n_collected = 0) =>
    ({ id: 'x', credits: 10, board_column, n_collected, n_actual: null })

  it.each([
    ['Submitted', false],
    ['Doc Programming', false],
    ['Survey Programming', false],
    ['EdWin QA', false],
    ['Fielding', true],
    ['Data QA', true],
    ['Delivery', true],
  ])('%s -> drawn=%s', (col, drawn) => {
    expect(hasDrawn(at(col))).toBe(drawn)
  })

  it('takes collection as evidence even when the card says otherwise', () => {
    // The board column is a proxy for "has it fielded"; respondents in the door
    // are the thing itself.
    expect(hasDrawn(at('Doc Programming', 40))).toBe(true)
  })

  it('treats a cancelled survey that fielded as drawn', () => {
    // The panel and the incentives were spent whatever happened afterwards.
    expect(hasDrawn({ id: 'x', credits: 10, board_column: 'Data QA', n_collected: 300 })).toBe(true)
  })

  it('does not treat a missing board column as fielded', () => {
    expect(hasDrawn({ id: 'x', credits: 10 })).toBe(false)
  })
})

describe('the BofA case, which is what this change is for', () => {
  it('counts 58 drawn, not 158, and says where the other 100 went', () => {
    // Measured in production 2026-09-22: the cell read 158 because PR00438's
    // 100 credits sit at Doc Programming — never launched, never fielded.
    const c = rollUp([
      { id: 'PR00311', credits: 39, board_column: 'Delivery', n_collected: 500 },
      { id: 'PR00310', credits: 19, board_column: 'Delivery', n_collected: 400 },
      { id: 'PR00438', credits: 100, board_column: 'Doc Programming', n_collected: 0 },
    ], null)
    expect(c.used).toBe(58)
    expect(c.committed).toBe(100)
    expect(c.committedCount).toBe(1)
    expect(describeConsumption(c)).toContain('committed but not drawn')
  })
})

describe('currentTerm', () => {
  const t = (id: string, starts_on: string | null, renews_on: string | null) =>
    ({ id, name: id, credits_total: 100, starts_on, renews_on })

  it('picks the term whose period contains today', () => {
    expect(currentTerm([t('a', '2025-01-01', '2026-01-01'), t('b', '2026-03-30', '2027-03-29')], '2026-09-22')!.id)
      .toBe('b')
  })

  it('treats a term with no renewal date as still running', () => {
    // An unrenewed contract has not ended; it is undated.
    expect(currentTerm([t('a', '2026-01-01', null)], '2026-09-22')!.id).toBe('a')
  })

  it('excludes a term that has not started', () => {
    expect(currentTerm([t('a', '2027-01-01', '2028-01-01')], '2026-09-22')).toBeNull()
  })

  it('excludes one that ended, on the renewal day itself', () => {
    // The period is [starts, renews) — the renewal day belongs to the new term.
    expect(currentTerm([t('a', '2025-01-01', '2026-09-22')], '2026-09-22')).toBeNull()
  })

  it('takes the latest-starting of overlapping terms rather than row order', () => {
    expect(currentTerm([t('old', '2026-01-01', '2027-01-01'), t('new', '2026-06-01', '2027-06-01')], '2026-09-22')!.id)
      .toBe('new')
  })

  it('is null rather than throwing when there are no terms at all', () => {
    expect(currentTerm([], '2026-09-22')).toBeNull()
  })
})

describe('creditPosition — the three columns David asked for', () => {
  const TERM = { id: 't1', name: '2026 Contract', credits_total: 375, starts_on: '2026-03-30', renews_on: '2027-03-29' }

  it('separates this term from all time, and counts untermed work', () => {
    const p = creditPosition([
      { id: 'a', credits: 100, term_id: 't1', board_column: 'Delivery', n_collected: 5 },
      { id: 'b', credits: 25, term_id: null, board_column: 'Delivery', n_collected: 5 },   // outside the term
      { id: 'c', credits: 50, term_id: 't1', board_column: 'Doc Programming', n_collected: 0 }, // not drawn
      { id: 'd', credits: null, term_id: 't1', board_column: 'Delivery', n_collected: 5 },      // unpriced
    ], [TERM], '2026-09-22')

    expect(p.usedThisTerm).toBe(100)
    expect(p.allowance).toBe(375)
    expect(p.remaining).toBe(275)
    expect(p.usedAllTime).toBe(125)   // includes the untermed 25
    expect(p.committed).toBe(50)
    expect(p.untermed).toBe(1)
    expect(p.unpriced).toBe(1)
  })

  it('leaves remaining NULL with no term, rather than calling it zero', () => {
    // "Remaining against no allowance" is unanswerable, not 0 — and 0 would read
    // to a client as "you have nothing left".
    const p = creditPosition([{ id: 'a', credits: 10, term_id: null, board_column: 'Delivery', n_collected: 1 }], [], '2026-09-22')
    expect(p.remaining).toBeNull()
    expect(p.allowance).toBeNull()
    expect(p.term).toBeNull()
    expect(p.usedAllTime).toBe(10)
  })

  it('reports all-time usage even when the current term has none', () => {
    const p = creditPosition([
      { id: 'old', credits: 90, term_id: 'expired', board_column: 'Delivery', n_collected: 5 },
    ], [TERM], '2026-09-22')
    expect(p.usedThisTerm).toBe(0)
    expect(p.usedAllTime).toBe(90)
  })
})

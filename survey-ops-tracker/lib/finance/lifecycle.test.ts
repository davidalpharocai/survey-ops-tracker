import { describe, it, expect } from 'vitest'
import { classify, classOf, rowCountsOf, isLive, CLASSES, CLASS_LABEL, NO_ROWS, type ClassifySubject } from './lifecycle'
import { buildIndex } from './hub'

/**
 * Guards the ONE classifier. Every finance fixture before this used phase
 * 'Active', so nothing ever tested Scoping, Hold or a placeholder — which is
 * how 9 held surveys counted as in-flight, a survey being fielded under a stale
 * Scoping phase vanished from every total, and 20 empty rerun shells counted as
 * delivered work.
 */

const P = (o: Partial<ClassifySubject> = {}): ClassifySubject => ({
  board_column: 'Fielding', status: 'Open', phase: 'Active',
  cancelled_at: null, is_placeholder: false, n_collected: 0, n_actual: null, ...o,
})
const ROWS = { blasts: 1, suppliers: 0, costs: 0 }

describe('classify, in order', () => {
  it('1. an EMPTY placeholder is excluded everywhere', () => {
    expect(classify(P({ is_placeholder: true }), NO_ROWS)).toBe('placeholder')
    // Even on the Delivery column: an empty shell is not delivered work.
    expect(classify(P({ is_placeholder: true, board_column: 'Delivery' }), NO_ROWS)).toBe('placeholder')
  })

  it('a placeholder that HOLDS data is real work (PR00352 / PR00344)', () => {
    // Real cost under a placeholder flag must never be hidden.
    expect(classify(P({ is_placeholder: true, board_column: 'Delivery' }), { blasts: 0, suppliers: 0, costs: 1 })).toBe('delivered')
    expect(classify(P({ is_placeholder: true }), ROWS)).toBe('active')
    // N alone is data too.
    expect(classify(P({ is_placeholder: true, n_actual: 40 }), NO_ROWS)).toBe('active')
    expect(classify(P({ is_placeholder: true, n_collected: 12 }), NO_ROWS)).toBe('active')
  })

  it('2. delivered beats everything after it', () => {
    expect(classify(P({ board_column: 'Delivery', status: 'Closed' }))).toBe('delivered')
    expect(classify(P({ board_column: 'Delivery', status: 'Cancelled' }))).toBe('delivered')
    expect(classify(P({ board_column: 'Delivery', status: 'Hold', phase: 'Scoping' }))).toBe('delivered')
  })

  it('3. cancelled, read from EITHER status or the stamp', () => {
    expect(classify(P({ status: 'Cancelled' }))).toBe('cancelled')
    expect(classify(P({ status: 'Open', cancelled_at: '2026-09-01' }))).toBe('cancelled')
    // Cancelled beats Hold and Scoping: a dead deal is not a paused or live one.
    expect(classify(P({ status: 'Cancelled', phase: 'Scoping' }))).toBe('cancelled')
  })

  it('4. hold is its own class — never live', () => {
    expect(classify(P({ status: 'Hold' }))).toBe('hold')
    // 9 of the held rows are phase Scoping; they are still holds.
    expect(classify(P({ status: 'Hold', phase: 'Scoping' }))).toBe('hold')
    expect(isLive('hold')).toBe(false)
    expect(isLive('active')).toBe(true)
  })

  it('5. archived: closed without delivery', () => {
    expect(classify(P({ status: 'Closed', board_column: 'Data QA' }))).toBe('archived')
  })

  it('6. scoping needs phase Scoping AND status Open AND no field rows', () => {
    expect(classify(P({ phase: 'Scoping', board_column: 'Submitted' }), NO_ROWS)).toBe('scoping')
    // PR00443: still marked Scoping while its SMS blasts went out — it is being
    // fielded, so it is live, and its spend counts.
    expect(classify(P({ phase: 'Scoping' }), ROWS)).toBe('active')
    expect(classify(P({ phase: 'Scoping' }), { blasts: 0, suppliers: 3 })).toBe('active')
    // A flat cost line alone does not make it fielded.
    expect(classify(P({ phase: 'Scoping' }), { blasts: 0, suppliers: 0, costs: 1 })).toBe('scoping')
  })

  it('7. everything else is active', () => {
    expect(classify(P())).toBe('active')
    expect(classify(P({ status: null, phase: null, board_column: null }))).toBe('active')
  })

  it('names every class in plain English', () => {
    for (const c of CLASSES) expect(CLASS_LABEL[c].length).toBeGreaterThan(0)
  })
})

describe('classOf: with the finance index', () => {
  it('reads the child-row counts off the index', () => {
    const ix = buildIndex(
      [{ project_id: 'a', bid: 1, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }],
      [], [{ project_id: 'b', amount: 5 }],
    )
    expect(rowCountsOf('a', ix)).toEqual({ blasts: 1, suppliers: 0, costs: 0 })
    expect(classOf({ id: 'a', ...P({ phase: 'Scoping' }) }, ix)).toBe('active')
    expect(classOf({ id: 'b', ...P({ is_placeholder: true, board_column: 'Delivery' }) }, ix)).toBe('delivered')
    expect(classOf({ id: 'c', ...P({ is_placeholder: true }) }, ix)).toBe('placeholder')
  })
})

import { describe, it, expect } from 'vitest'
import { finalCell, type FinalCellInput } from './finalCell'

/**
 * The one rule for reading a response figure under the heading "Final".
 *
 * Extracted because it was inline in the surveys list and ABSENT from the sales
 * contacts page, which printed `n_actual ?? n_collected` under "N Collected" —
 * a running field total shown as a delivered count (the PR00481 pattern).
 */
const R = (o: Partial<FinalCellInput> = {}): FinalCellInput => ({
  board_column: 'Fielding', status: 'Open',
  n_target: null, n_target_max: null, n_collected: 0, n_actual: null,
  n_collected_updated_at: '2026-09-01',
  ...o,
})

describe('a recorded post-QA count is the answer', () => {
  it('reads n_actual plainly, with no mark', () => {
    const f = finalCell(R({ board_column: 'Delivery', status: 'Closed', n_target: 250, n_collected: 404, n_actual: 260 }))
    expect(f.reading).toBe('recorded')
    expect(f.value).toBe(260)     // not the 404 collected
    expect(f.mark).toBe('')
  })

  it('beats the collection even on a survey still in field', () => {
    // A count typed in mid-field: n_actual is still the recorded answer.
    const f = finalCell(R({ n_target: 1000, n_collected: 1350, n_actual: 1171 }))
    expect(f.reading).toBe('recorded')
    expect(f.value).toBe(1171)
  })
})

describe('a survey still gathering says so', () => {
  it('marks it "so far" and does not project', () => {
    const f = finalCell(R({ board_column: 'Fielding', status: 'Open', n_target: 75, n_collected: 7 }))
    expect(f.reading).toBe('so-far')
    expect(f.value).toBe(7)
    expect(f.mark).toBe('so far')
    // deliveredN's end-of-life keep rate would print 6 under a 7.
    expect(f.value).not.toBe(6)
  })

  it('is decided by the stage, not by how far off target it is', () => {
    // 9% of target: might be nearly finished and badly short, or might have
    // started yesterday. Only the board column distinguishes them.
    const fielding = finalCell(R({ board_column: 'Fielding', status: 'Open', n_target: 1000, n_collected: 90 }))
    const qa = finalCell(R({ board_column: 'Data QA', status: 'Open', n_target: 1000, n_collected: 90 }))
    expect(fielding.reading).toBe('so-far')
    expect(qa.reading).toBe('estimate')
  })
})

describe('a finished survey is never "so far"', () => {
  // 60 of 433 live surveys, measured 2026-09-28.
  it('marks a delivered survey sold as a RANGE "not final", not "so far"', () => {
    // PR00393: Delivery, Closed, 1,418 collected against a 200–300 range.
    const f = finalCell(R({
      board_column: 'Delivery', status: 'Closed', n_target: 200, n_target_max: 300, n_collected: 1418,
    }))
    expect(f.reading).toBe('not-final')
    expect(f.mark).toBe('not final')
    expect(f.value).toBe(1418)
    expect(f.note).toMatch(/range/i)
  })

  it('marks a delivered survey with NO target "not final"', () => {
    const f = finalCell(R({ board_column: 'Delivery', status: 'Closed', n_collected: 100 }))
    expect(f.reading).toBe('not-final')
    // deliveredN's own sentence, not a second copy of it.
    expect(f.note).toMatch(/no target is set/i)
  })

  it('still marks a survey sold as a range and STILL in field "so far"', () => {
    const f = finalCell(R({ board_column: 'Fielding', status: 'Open', n_target: 200, n_target_max: 300, n_collected: 90 }))
    expect(f.reading).toBe('so-far')
  })

  it('treats a cancelled or held survey as finished, wherever it is parked', () => {
    for (const status of ['Cancelled', 'Hold', 'Closed']) {
      const f = finalCell(R({ board_column: 'Fielding', status, n_collected: 40 }))
      expect(f.reading, status).toBe('not-final')
    }
  })
})

describe('an estimate is marked as one, and only when it is a measurement', () => {
  it('projects an over-collected survey down to roughly what it sold', () => {
    const f = finalCell(R({ board_column: 'Data QA', status: 'Open', n_target: 250, n_collected: 404 }))
    expect(f.reading).toBe('estimate')
    // The over-collection is not the answer.
    expect(f.value).not.toBe(404)
    expect(f.value).toBeGreaterThan(200)
    expect(f.value).toBeLessThan(330)
  })

  it('refuses to mark the no-target collection as an estimate', () => {
    // deliveredN hands back the raw collection with estimated=true there. A "~"
    // on a number nothing was done to is a guess wearing a measurement's
    // clothes.
    const f = finalCell(R({ board_column: 'Data QA', status: 'Open', n_collected: 481 }))
    expect(f.reading).not.toBe('estimate')
    expect(f.value).toBe(481)
  })
})

describe('a count that was never recorded is not a zero', () => {
  // Migration 111. Alex's list 2026-09-23, PR00482: Submitted, target 1,000,
  // shown as "0 · 0%" in amber, which calls a column default a result.
  it('says there is no figure at all', () => {
    const f = finalCell(R({ board_column: 'Submitted', status: 'Open', n_target: 1000, n_collected: 0, n_collected_updated_at: null }))
    expect(f.reading).toBe('none')
    expect(f.value).toBeNull()
    expect(f.note).toMatch(/no count has been recorded/i)
  })

  it('says nothing when the freshness read did not happen', () => {
    // undefined is "we could not tell", which must not render as "never".
    const f = finalCell(R({ board_column: 'Submitted', status: 'Open', n_target: 1000, n_collected: 0, n_collected_updated_at: undefined }))
    expect(f.reading).not.toBe('none')
    expect(f.value).toBe(0)
    // And the 0 it does show is marked, never bare.
    expect(f.mark).not.toBe('')
  })

  it('does not swallow a real zero that WAS recorded', () => {
    const f = finalCell(R({ board_column: 'Fielding', status: 'Open', n_target: 500, n_collected: 0, n_collected_updated_at: '2026-09-20' }))
    expect(f.reading).toBe('so-far')
    expect(f.value).toBe(0)
  })
})

describe('every reading carries a sentence', () => {
  it('never returns an empty note', () => {
    const cases: FinalCellInput[] = [
      R({ n_actual: 260 }),
      R({ board_column: 'Fielding', status: 'Open', n_target: 75, n_collected: 7 }),
      R({ board_column: 'Data QA', status: 'Open', n_target: 250, n_collected: 404 }),
      R({ board_column: 'Delivery', status: 'Closed', n_target: 200, n_target_max: 300, n_collected: 1418 }),
      R({ n_collected: 0, n_collected_updated_at: null }),
    ]
    for (const c of cases) expect(finalCell(c).note.length, JSON.stringify(c)).toBeGreaterThan(10)
  })
})

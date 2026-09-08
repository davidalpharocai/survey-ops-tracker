import { describe, it, expect } from 'vitest'
import { bucketOf, countBuckets, BUCKETS } from './buckets'

const P = (o: Partial<Parameters<typeof bucketOf>[0]> = {}) => ({
  status: 'Open', phase: 'Active', board_column: 'Fielding', ...o,
})

describe('bucketOf', () => {
  it('puts a running study in Active', () => {
    expect(bucketOf(P())).toBe('active')
  })

  it('puts a study still being priced in Scoping', () => {
    expect(bucketOf(P({ phase: 'Scoping', board_column: null }))).toBe('scoping')
  })

  // THE ONE THAT MATTERS MOST. The app leaves a delivered project's status as
  // 'Open' until it is closed, so a status-first rule would count 250 delivered
  // studies as active work — which is what a salesperson would be showing a
  // client.
  it('counts a delivered study as Delivered even while its status is still Open', () => {
    expect(bucketOf(P({ status: 'Open', phase: 'Active', board_column: 'Delivery' }))).toBe('completed')
  })

  it('counts a delivered study as Delivered even once it is Closed', () => {
    expect(bucketOf(P({ status: 'Closed', board_column: 'Delivery' }))).toBe('completed')
  })

  it('never counts a paused study as active', () => {
    expect(bucketOf(P({ status: 'Hold' }))).toBe('hold')
    expect(bucketOf(P({ status: 'Hold', phase: 'Scoping' }))).toBe('hold')
  })

  it('separates closed-without-delivering from delivered', () => {
    expect(bucketOf(P({ status: 'Cancelled', board_column: 'Fielding' }))).toBe('closed')
    expect(bucketOf(P({ status: 'Closed', board_column: 'Data QA' }))).toBe('closed')
  })

  it('falls back to Active rather than dropping a row with odd values', () => {
    // Every survey must land somewhere: a bucket set that silently omits rows
    // makes the tiles stop summing to the list beneath them.
    expect(bucketOf({ status: null, phase: null, board_column: null })).toBe('active')
  })
})

describe('countBuckets', () => {
  it('assigns every row to exactly one bucket, so the parts sum to the whole', () => {
    const rows = [
      P(),                                                  // active
      P({ phase: 'Scoping' }),                              // scoping
      P({ board_column: 'Delivery' }),                      // completed
      P({ status: 'Hold' }),                                // hold
      P({ status: 'Cancelled', board_column: 'EdWin QA' }),  // closed
      P({ status: 'Open', board_column: 'Delivery' }),      // completed
    ]
    const c = countBuckets(rows)
    expect(c).toEqual({ active: 1, scoping: 1, completed: 2, hold: 1, closed: 1 })
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(rows.length)
  })

  it('returns zeros rather than an empty object for no rows', () => {
    expect(countBuckets([])).toEqual({ active: 0, scoping: 0, completed: 0, hold: 0, closed: 0 })
  })

  it('every declared bucket is reachable by bucketOf', () => {
    // Guards against a tile that can never light up — a promise of a filter
    // that returns nothing.
    const reachable = new Set([
      bucketOf(P()),
      bucketOf(P({ phase: 'Scoping' })),
      bucketOf(P({ board_column: 'Delivery' })),
      bucketOf(P({ status: 'Hold' })),
      bucketOf(P({ status: 'Closed', board_column: 'Fielding' })),
    ])
    for (const b of BUCKETS) expect(reachable.has(b.id)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { bucketOf, countBuckets, migrateBucketId, BUCKETS } from './buckets'

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
    expect(bucketOf(P({ status: 'Open', phase: 'Active', board_column: 'Delivery' }))).toBe('delivered')
  })

  it('counts a delivered study as Delivered even once it is Closed', () => {
    expect(bucketOf(P({ status: 'Closed', board_column: 'Delivery' }))).toBe('delivered')
  })

  it('never counts a paused study as active', () => {
    expect(bucketOf(P({ status: 'Hold' }))).toBe('hold')
    expect(bucketOf(P({ status: 'Hold', phase: 'Scoping' }))).toBe('hold')
  })

  it('separates cancelled from archived — they are different endings', () => {
    // David, 2026-09-17: the old single "Closed" tile folded both together.
    // Cancelled means somebody stopped it; archived means it was closed
    // without ever reaching delivery, and all 24 live ones are legacy imports.
    expect(bucketOf(P({ status: 'Cancelled', board_column: 'Fielding' }))).toBe('cancelled')
    expect(bucketOf(P({ status: 'Closed', board_column: 'Data QA' }))).toBe('archived')
  })

  it('does not let the 327 delivered rows read as Archived', () => {
    // Every delivered survey in production is ALSO status='Closed' — the two
    // tiles described the same set. Delivered wins, which is the whole reason
    // the order is load-bearing.
    expect(bucketOf(P({ status: 'Closed', board_column: 'Delivery' }))).toBe('delivered')
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
      P({ status: 'Cancelled', board_column: 'EdWin QA' }), // cancelled
      P({ status: 'Closed', board_column: 'Fielding' }),    // archived
      P({ status: 'Open', board_column: 'Delivery' }),      // delivered
    ]
    const c = countBuckets(rows)
    expect(c).toEqual({ active: 1, scoping: 1, delivered: 2, hold: 1, cancelled: 1, archived: 1 })
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(rows.length)
  })

  it('returns zeros rather than an empty object for no rows', () => {
    expect(countBuckets([])).toEqual({
      active: 0, scoping: 0, delivered: 0, hold: 0, cancelled: 0, archived: 0,
    })
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
      bucketOf(P({ status: 'Cancelled', board_column: 'Fielding' })),
    ])
    for (const b of BUCKETS) expect(reachable.has(b.id)).toBe(true)
  })
})

describe('migrateBucketId: links written before the rename still work', () => {
  it('translates the two ids that changed', () => {
    // ?g=completed and ?g=closed exist in bookmarks and pasted links.
    expect(migrateBucketId('completed')).toBe('delivered')
    expect(migrateBucketId('closed')).toBe('archived')
  })

  it('passes through anything still valid', () => {
    expect(migrateBucketId('active')).toBe('active')
    expect(migrateBucketId('all')).toBe('all')
  })

  it('returns null for an unknown id rather than guessing', () => {
    // A caller falls back to its default group; guessing would filter to an
    // empty list and look like "you have no surveys".
    expect(migrateBucketId('banana')).toBeNull()
  })
})

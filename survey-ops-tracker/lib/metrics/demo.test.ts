import { describe, it, expect } from 'vitest'
import { withoutDemo } from './demo'

/**
 * Guards the demo exclusion.
 *
 * The test that matters is the NULL one. The obvious PostgREST implementation
 * of this filter — .not('client_id','in','(…)') — silently drops every project
 * with no client_id, because `NULL not in (…)` is NULL rather than true. That
 * is the same class of quiet, in-our-favour error as every other number this
 * strand of work has had to correct, so it gets a test rather than a comment.
 */
describe('withoutDemo', () => {
  const demo = new Set(['demo-1', 'demo-2'])

  it('drops rows belonging to a demo account', () => {
    const rows = [{ client_id: 'real' }, { client_id: 'demo-1' }, { client_id: 'demo-2' }]
    expect(withoutDemo(rows, demo)).toEqual([{ client_id: 'real' }])
  })

  it('KEEPS a row with no client_id — "no account recorded" is not "demo"', () => {
    const rows = [{ client_id: null }, { client_id: undefined }, {}, { client_id: 'demo-1' }]
    expect(withoutDemo(rows, demo)).toHaveLength(3)
  })

  it('is a no-op when nothing is flagged, rather than filtering everything', () => {
    // demoClientIds() returns an EMPTY set when it cannot read the flag. That
    // must over-report by one known survey, never under-report by all of them.
    const rows = [{ client_id: 'a' }, { client_id: null }]
    expect(withoutDemo(rows, new Set())).toBe(rows)
  })

  it('does not mutate the input', () => {
    const rows = [{ client_id: 'demo-1' }, { client_id: 'real' }]
    withoutDemo(rows, demo)
    expect(rows).toHaveLength(2)
  })
})

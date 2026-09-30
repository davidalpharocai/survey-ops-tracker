import { describe, it, expect } from 'vitest'
import { summariseValue, describeValue, EMPTY_VALUE, type ValueRow } from './deliveredValue'

const row = (o: Partial<ValueRow> & { id: string }): ValueRow =>
  ({ delivered: true, n_actual: 100, ...o })

describe('summariseValue', () => {
  it('sums the delivered rows that have a figure', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })]
    const s = summariseValue(rows, new Map([['a', 1200], ['b', 800]]))
    expect(s).toEqual({ total: 2000, priced: 2, unpriced: 0, noN: 0, blocked: false })
  })

  it('ignores a row that was never delivered, even if it somehow carries a figure', () => {
    // Revenue needs a post-QA count, so an in-flight survey should not have
    // one — but the tile is "value of DELIVERED work" and must not depend on
    // that invariant holding.
    const rows = [row({ id: 'a' }), row({ id: 'live', delivered: false })]
    const s = summariseValue(rows, new Map([['a', 500], ['live', 9999]]))
    expect(s.total).toBe(500)
    expect(s.priced).toBe(1)
  })

  it('separates "not priced" from "no final count", because they need different fixes', () => {
    const rows = [
      row({ id: 'priced' }),
      row({ id: 'unpriced' }),                       // has an N, no figure
      row({ id: 'counting', n_actual: null }),       // no N yet
    ]
    const s = summariseValue(rows, new Map([['priced', 300], ['unpriced', null]]))
    expect(s).toEqual({ total: 300, priced: 1, unpriced: 1, noN: 1, blocked: false })
  })

  it('treats a fully counted set of segments as having a final count', () => {
    const rows = [row({ id: 'seg', n_actual: null, segmentsCounted: true })]
    const s = summariseValue(rows, new Map())
    expect(s.unpriced).toBe(1)
    expect(s.noN).toBe(0)
  })

  it('a blocked read reports nothing, not zero', () => {
    const s = summariseValue([row({ id: 'a' })], new Map([['a', 4000]]), true)
    expect(s).toEqual({ ...EMPTY_VALUE, blocked: true })
  })
})

describe('describeValue', () => {
  it('says a failed read is not $0', () => {
    const t = describeValue({ ...EMPTY_VALUE, blocked: true })
    expect(t).toMatch(/did not load/)
    expect(t).toMatch(/not \$0/)
  })

  it('says so plainly when the range holds no delivered work', () => {
    expect(describeValue(EMPTY_VALUE)).toBe('No delivered work in this range.')
  })

  // The whole reason this module exists: 52 of 63 owned accounts have no
  // priced delivered study, and "$0" on those would read as "this client has
  // paid us nothing".
  it('never prints a dollar figure when nothing is priced', () => {
    const all = [
      { ...EMPTY_VALUE, unpriced: 4 },
      { ...EMPTY_VALUE, noN: 3 },
      { ...EMPTY_VALUE, unpriced: 2, noN: 1 },
    ]
    for (const s of all) {
      const t = describeValue(s)
      // "$0" is allowed — it appears only in "that is not the same as $0",
      // which is the disclaimer. A dollar AMOUNT is what must never appear.
      expect(t).not.toMatch(/\$[\d,]*[1-9]/)
      expect(t).toMatch(/^Not known yet — /)
      expect(t).toMatch(/not the same as \$0\.$/)
    }
  })

  it('names both reasons when a range has each', () => {
    const t = describeValue({ ...EMPTY_VALUE, unpriced: 2, noN: 1 })
    expect(t).toMatch(/2 studies are not priced yet/)
    expect(t).toMatch(/1 study has no final count yet/)
  })

  it('states the coverage and the direction of the gap when it is partial', () => {
    const t = describeValue({ total: 12000, priced: 3, unpriced: 2, noN: 0, blocked: false })
    expect(t).toMatch(/\$12,000 across 3 studies of 5 delivered/)
    expect(t).toMatch(/2 not priced yet/)
    expect(t).toMatch(/understates/)
  })

  it('says it is complete when every delivered study is priced', () => {
    const t = describeValue({ total: 900, priced: 2, unpriced: 0, noN: 0, blocked: false })
    expect(t).toMatch(/\$900 across 2 studies — every delivered study in this range\./)
    expect(t).not.toMatch(/understates/)
  })

  it('reads as one study, not 1 studies', () => {
    const t = describeValue({ total: 400, priced: 1, unpriced: 0, noN: 0, blocked: false })
    expect(t).toMatch(/across 1 study —/)
  })
})

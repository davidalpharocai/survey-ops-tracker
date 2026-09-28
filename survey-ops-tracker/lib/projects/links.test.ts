import { describe, it, expect } from 'vitest'
import { orderPair, LinkOpError } from './links'

describe('orderPair', () => {
  // Migration 126 stores one row per pair with a check constraint requiring
  // a_id < b_id. If a caller writes the pair in the order the user happened to
  // click, the insert is rejected outright — or worse, on a table without the
  // constraint, (A,B) and (B,A) both insert and the survey shows the same link
  // twice. Every write goes through this function for that reason.
  it('puts the pair in the same order whichever way round it is given', () => {
    const a = '11111111-1111-1111-1111-111111111111'
    const b = '22222222-2222-2222-2222-222222222222'
    expect(orderPair(a, b)).toEqual([a, b])
    expect(orderPair(b, a)).toEqual([a, b])
  })

  it('agrees with the constraint the database enforces (a < b)', () => {
    const ids = ['d', 'a', 'c', 'b']
    for (const x of ids) {
      for (const y of ids) {
        if (x === y) continue
        const [first, second] = orderPair(x, y)
        expect(first < second).toBe(true)
      }
    }
  })

  it('is stable — ordering an already-ordered pair changes nothing', () => {
    const [a, b] = orderPair('zeta', 'alpha')
    expect(orderPair(a, b)).toEqual([a, b])
  })
})

describe('LinkOpError', () => {
  it('carries a status so the route can pass a person-readable refusal through', () => {
    expect(new LinkOpError('nope').status).toBe(400)
    expect(new LinkOpError('gone', 404).status).toBe(404)
    expect(new LinkOpError('gone', 404)).toBeInstanceOf(Error)
  })
})

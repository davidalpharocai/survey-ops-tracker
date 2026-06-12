import { describe, it, expect } from 'vitest'
import { boardOrder, sortOrderBetween } from '@/lib/utils/ordering'

describe('sortOrderBetween', () => {
  it('lands midway between two neighbors', () => {
    expect(sortOrderBetween(1000, 2000)).toBe(1500)
  })
  it('goes after the last card', () => {
    expect(sortOrderBetween(5000, null)).toBe(6000)
  })
  it('goes before the first card', () => {
    expect(sortOrderBetween(null, 1000)).toBe(0)
  })
  it('handles an empty column', () => {
    expect(sortOrderBetween(null, null)).toBe(1000)
  })
  it('tolerates null neighbors mixed with values', () => {
    expect(sortOrderBetween(undefined, 400)).toBe(-600)
  })
})

describe('boardOrder', () => {
  it('sorts by sort_order ascending', () => {
    const list = [{ sort_order: 3000 }, { sort_order: 1000 }, { sort_order: 2000 }]
    expect(list.sort(boardOrder).map(x => x.sort_order)).toEqual([1000, 2000, 3000])
  })
  it('puts unset (new) cards first, newest first', () => {
    const list = [
      { sort_order: 1000, created_at: '2026-06-01' },
      { sort_order: null, created_at: '2026-06-10' },
      { sort_order: null, created_at: '2026-06-11' },
    ]
    expect(list.sort(boardOrder).map(x => x.created_at)).toEqual([
      '2026-06-11',
      '2026-06-10',
      '2026-06-01',
    ])
  })
})

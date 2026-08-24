import { describe, it, expect } from 'vitest'
import { boardOrder, cardOrder, columnSortRank, dropSortOrder, sortOrderBetween } from '@/lib/utils/ordering'

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

describe('dropSortOrder', () => {
  // A hand-arranged column, and what a filter leaves of it on screen.
  const at = (id: string, sort_order: number | null) => ({ id, sort_order })
  const column = [at('a', 1000), at('b', 2000), at('c', 3000), at('d', 4000)]
  // "My projects" is on: b and d are mine, a and c are a teammate's.
  const mine = [column[1], column[3]]

  it('lands between two neighbors when nothing is hidden', () => {
    expect(dropSortOrder(column, column, 1)).toBe(1500)
  })

  it('handles an empty column', () => {
    expect(dropSortOrder([], [], 0)).toBe(1000)
  })

  it('goes after the last card', () => {
    expect(dropSortOrder(mine, column, 2)).toBe(5000)
  })

  it('reads the neighbors the user SAW, not the same index of the full column', () => {
    // Dropped at visible position 1 — between b and d. Indexing the unfiltered
    // column with that 1 would read a/b instead and land the card above b.
    expect(dropSortOrder(mine, column, 1)).toBe(2500)
  })

  it('lands between the true adjacent pair, so a hidden card keeps its place', () => {
    // 2500 sits between b (2000) and the hidden c (3000): visibly after b, and
    // it doesn't collide with c the way a b/d midpoint (3000) would.
    expect(dropSortOrder(mine, column, 1)).toBeGreaterThan(2000)
    expect(dropSortOrder(mine, column, 1)).toBeLessThan(3000)
  })

  it('drops onto the top of a filtered column above the first visible card', () => {
    // Above b (2000) but below the hidden a (1000) — visibly first either way.
    expect(dropSortOrder(mine, column, 0)).toBe(1500)
  })

  it('lands after a never-arranged neighbor (unset sort_order)', () => {
    const withNew = [at('new', null), at('b', 2000)]
    expect(dropSortOrder(withNew, withNew, 1)).toBe(1000)
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

describe('columnSortRank', () => {
  it('floats urgent, then high, then everything else — and sinks Hold', () => {
    expect(columnSortRank({ priority: 'urgent' })).toBe(0)
    expect(columnSortRank({ priority: 'high' })).toBe(1)
    expect(columnSortRank({ priority: 'normal' })).toBe(2)
    expect(columnSortRank({})).toBe(2)
    expect(columnSortRank({ status: 'Hold', priority: 'urgent' })).toBe(100)
  })
})

describe('cardOrder', () => {
  // Cards carry a sort_order so the manual-mode cases have something to fall
  // back on, mirroring a column that's been hand-arranged at some point.
  const card = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    status: 'Open',
    priority: 'normal',
    sort_order: 1000,
    created_at: '2026-08-01',
    ...extra,
  })

  describe("mode 'due'", () => {
    const order = cardOrder('pipeline', 'due')

    it('puts the soonest delivery date on top', () => {
      const list = [
        card('later', { deliver_date: '2026-09-10' }),
        card('soonest', { deliver_date: '2026-09-01' }),
        card('middle', { deliver_date: '2026-09-05' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['soonest', 'middle', 'later'])
    })

    it('falls back to due_date when deliver_date is missing', () => {
      const list = [
        card('delivers-later', { deliver_date: '2026-09-10' }),
        // No deliver_date yet — it's due first, so it belongs first (it would
        // otherwise sink as if it had no deadline at all).
        card('due-first', { deliver_date: null, due_date: '2026-09-02' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['due-first', 'delivers-later'])
    })

    it('prefers deliver_date over due_date when both are set', () => {
      const list = [
        card('b', { deliver_date: '2026-09-04', due_date: '2026-09-01' }),
        card('a', { deliver_date: '2026-09-02', due_date: '2026-09-30' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['a', 'b'])
    })

    it('sorts a dateless card that HAS been hand-arranged last', () => {
      const list = [
        // No deadline, but a sort_order says someone has already positioned it
        // (dragged it, or dropped it into this column) — so it has been seen and
        // parked, and it sorts behind everything with a real deadline.
        card('undated', { deliver_date: null, due_date: null }),
        card('dated', { deliver_date: '2026-12-31' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['dated', 'undated'])
    })

    it('floats a just-created card — no dates, never dragged — to the top', () => {
      // What NewProjectModal actually writes: a client, a type, a column, and
      // nothing else. Sorting it by its (absent) deadline would bury every new
      // inquiry at the bottom of the longest column, "new for me" badge and all.
      const list = [
        card('dated', { deliver_date: '2026-08-25' }),
        card('brand-new', { deliver_date: null, due_date: null, sort_order: null }),
        card('dated-later', { deliver_date: '2026-09-30' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['brand-new', 'dated', 'dated-later'])
    })

    it('keeps two brand-new cards newest-first (the manual-order rule)', () => {
      const list = [
        card('older', { deliver_date: null, due_date: null, sort_order: null, created_at: '2026-08-20' }),
        card('newest', { deliver_date: null, due_date: null, sort_order: null, created_at: '2026-08-24' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['newest', 'older'])
    })

    it('still ranks priority above the date, and still sinks Hold', () => {
      const list = [
        card('normal-soonest', { deliver_date: '2026-09-01' }),
        card('hold-soonest', { deliver_date: '2026-08-25', status: 'Hold' }),
        card('urgent-latest', { deliver_date: '2026-12-01', priority: 'urgent' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual([
        'urgent-latest',
        'normal-soonest',
        'hold-soonest',
      ])
    })

    it('breaks a date tie with the hand-arranged order', () => {
      const list = [
        card('dragged-second', { deliver_date: '2026-09-01', sort_order: 2000 }),
        card('dragged-first', { deliver_date: '2026-09-01', sort_order: 1000 }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['dragged-first', 'dragged-second'])
    })

    it('ignores priority in the scoping lane (it renders flat)', () => {
      const scoping = cardOrder('scoping', 'due')
      const list = [
        card('soonest-normal', { deliver_date: '2026-09-01' }),
        card('later-urgent', { deliver_date: '2026-09-20', priority: 'urgent' }),
      ]
      expect(list.sort(scoping).map(c => c.name)).toEqual(['soonest-normal', 'later-urgent'])
    })
  })

  describe("mode 'manual'", () => {
    it('leaves the hand-arranged order exactly as it was — dates ignored', () => {
      const order = cardOrder('pipeline', 'manual')
      const list = [
        card('dragged-first', { sort_order: 1000, deliver_date: '2026-12-31' }),
        card('dragged-second', { sort_order: 2000, deliver_date: '2026-09-01' }),
        card('dragged-third', { sort_order: 3000, deliver_date: '2026-10-01' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual([
        'dragged-first',
        'dragged-second',
        'dragged-third',
      ])
    })

    it('matches the pre-sort-mode comparator exactly (rank, then boardOrder)', () => {
      const order = cardOrder('pipeline', 'manual')
      const list = [
        card('hold', { status: 'Hold', sort_order: 100 }),
        card('new', { sort_order: null, created_at: '2026-08-20' }),
        card('urgent', { priority: 'urgent', sort_order: 9000 }),
        card('normal', { sort_order: 500 }),
      ]
      const legacy = [...list].sort(
        (a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b)
      )
      expect([...list].sort(order).map(c => c.name)).toEqual(legacy.map(c => c.name))
    })

    it('is boardOrder alone in the scoping lane', () => {
      const scoping = cardOrder('scoping', 'manual')
      const list = [
        card('third', { sort_order: 3000, priority: 'urgent' }),
        card('first', { sort_order: 1000 }),
        card('second', { sort_order: 2000 }),
      ]
      expect(list.sort(scoping).map(c => c.name)).toEqual(['first', 'second', 'third'])
    })
  })

  describe("lane 'delivered'", () => {
    it('puts the most recently delivered first', () => {
      const order = cardOrder('delivered', 'due')
      const list = [
        card('oldest', { deliver_date: '2026-06-01' }),
        card('newest', { deliver_date: '2026-08-15' }),
        card('middle', { deliver_date: '2026-07-04' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['newest', 'middle', 'oldest'])
    })

    it('prefers the delivered_at stamp when the row carries one', () => {
      const order = cardOrder('delivered', 'due')
      const list = [
        // Same delivery day, but the stamps say which actually went out last.
        card('am', { deliver_date: '2026-08-15', delivered_at: '2026-08-15T09:00:00+00:00' }),
        card('pm', { deliver_date: '2026-08-15', delivered_at: '2026-08-15T17:30:00+00:00' }),
        card('day-before', { deliver_date: '2026-08-14', delivered_at: '2026-08-14T23:00:00+00:00' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['pm', 'am', 'day-before'])
    })

    it('sorts an undated (e.g. cancelled) card last', () => {
      const order = cardOrder('delivered', 'due')
      const list = [
        card('cancelled', { deliver_date: null, due_date: null }),
        card('delivered', { deliver_date: '2026-06-01' }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['delivered', 'cancelled'])
    })

    it('stays newest-first in manual mode — archived cards have no drag order', () => {
      const order = cardOrder('delivered', 'manual')
      const list = [
        card('oldest', { deliver_date: '2026-06-01', sort_order: 1000 }),
        card('newest', { deliver_date: '2026-08-15', sort_order: 9000 }),
      ]
      expect(list.sort(order).map(c => c.name)).toEqual(['newest', 'oldest'])
    })
  })
})

import { describe, it, expect } from 'vitest'
import { orderLineageByDate, type LineageWave } from './renumberLineage'

const w = (id: string, dates: Partial<LineageWave> = {}): LineageWave => ({
  id,
  submitted_date: null,
  launch_date: null,
  deliver_date: null,
  created_at: null,
  ...dates,
})

describe('orderLineageByDate', () => {
  it('makes the root Wave 1 and numbers the rest by submitted date', () => {
    const root = 'root'
    const waves = [
      w('root', { submitted_date: '2026-05-01' }),
      w('later', { submitted_date: '2026-07-01' }),
      w('earlier', { submitted_date: '2026-06-01' }),
    ]
    expect(orderLineageByDate(waves, root)).toEqual([
      { id: 'root', num: 1 },
      { id: 'earlier', num: 2 },
      { id: 'later', num: 3 },
    ])
  })

  it('heals gaps — numbering comes from POSITION, ignoring stale rerun_number', () => {
    // The Mattress Firm bug: legacy naive max+1 left waves numbered 1,3,4.
    // Regardless of any stored number, a recompute must yield contiguous 1,2,3,4.
    const root = 'root'
    const waves = [
      w('root', { submitted_date: '2026-01-01' }),
      w('b', { submitted_date: '2026-02-01' }),
      w('c', { submitted_date: '2026-03-01' }),
      w('d', { submitted_date: '2026-04-01' }),
    ]
    expect(orderLineageByDate(waves, root).map((t) => t.num)).toEqual([1, 2, 3, 4])
  })

  it('falls back submitted → launch → deliver → created when earlier dates are null', () => {
    const root = 'root'
    const waves = [
      w('root', { created_at: '2026-01-01T00:00:00Z' }),
      w('by-launch', { launch_date: '2026-03-01' }),
      w('by-deliver', { deliver_date: '2026-02-01' }),
      w('by-created', { created_at: '2026-05-01T00:00:00Z' }),
    ]
    expect(orderLineageByDate(waves, root)).toEqual([
      { id: 'root', num: 1 },
      { id: 'by-deliver', num: 2 },
      { id: 'by-launch', num: 3 },
      { id: 'by-created', num: 4 },
    ])
  })

  it('returns just the root as Wave 1 when there are no other waves', () => {
    expect(orderLineageByDate([w('root', { submitted_date: '2026-01-01' })], 'root')).toEqual([
      { id: 'root', num: 1 },
    ])
  })
})

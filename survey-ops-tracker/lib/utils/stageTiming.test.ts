import { describe, it, expect } from 'vitest'
import { stageDurations } from './stageTiming'

describe('stageDurations', () => {
  it('computes whole-day durations, current stage ongoing to now', () => {
    const rows = [
      { stage: 'Doc Programming', entered_at: '2026-07-07T00:00:00Z' },
      { stage: 'Survey Programming', entered_at: '2026-07-09T00:00:00Z' },
      { stage: 'Fielding', entered_at: '2026-07-13T00:00:00Z' },
    ]
    expect(stageDurations(rows, '2026-07-15T00:00:00Z')).toEqual([
      { stage: 'Doc Programming', days: 2, ongoing: false },
      { stage: 'Survey Programming', days: 4, ongoing: false },
      { stage: 'Fielding', days: 2, ongoing: true },
    ])
  })

  it('sorts unordered input before computing', () => {
    const rows = [
      { stage: 'Fielding', entered_at: '2026-07-13T00:00:00Z' },
      { stage: 'Doc Programming', entered_at: '2026-07-07T00:00:00Z' },
      { stage: 'Survey Programming', entered_at: '2026-07-09T00:00:00Z' },
    ]
    expect(stageDurations(rows, '2026-07-15T00:00:00Z')).toEqual([
      { stage: 'Doc Programming', days: 2, ongoing: false },
      { stage: 'Survey Programming', days: 4, ongoing: false },
      { stage: 'Fielding', days: 2, ongoing: true },
    ])
  })

  it('drops a leading Submitted row (clock starts at Doc Programming)', () => {
    const rows = [
      { stage: 'Submitted', entered_at: '2026-07-01T00:00:00Z' },
      { stage: 'Doc Programming', entered_at: '2026-07-07T00:00:00Z' },
      { stage: 'Survey Programming', entered_at: '2026-07-09T00:00:00Z' },
    ]
    expect(stageDurations(rows, '2026-07-10T00:00:00Z')).toEqual([
      { stage: 'Doc Programming', days: 2, ongoing: false },
      { stage: 'Survey Programming', days: 1, ongoing: true },
    ])
  })

  it('empty input returns empty array', () => {
    expect(stageDurations([], '2026-07-15T00:00:00Z')).toEqual([])
  })

  it('single row is ongoing, measured to now', () => {
    const rows = [{ stage: 'Doc Programming', entered_at: '2026-07-07T00:00:00Z' }]
    expect(stageDurations(rows, '2026-07-10T00:00:00Z')).toEqual([
      { stage: 'Doc Programming', days: 3, ongoing: true },
    ])
  })

  it('accepts a Date for now, not just an ISO string', () => {
    const rows = [{ stage: 'Doc Programming', entered_at: '2026-07-07T00:00:00Z' }]
    expect(stageDurations(rows, new Date('2026-07-10T00:00:00Z'))).toEqual([
      { stage: 'Doc Programming', days: 3, ongoing: true },
    ])
  })

  it('clamps negative day diffs at 0', () => {
    const rows = [
      { stage: 'Doc Programming', entered_at: '2026-07-07T12:00:00Z' },
      { stage: 'Survey Programming', entered_at: '2026-07-07T18:00:00Z' },
    ]
    expect(stageDurations(rows, '2026-07-07T20:00:00Z')).toEqual([
      { stage: 'Doc Programming', days: 0, ongoing: false },
      { stage: 'Survey Programming', days: 0, ongoing: true },
    ])
  })
})

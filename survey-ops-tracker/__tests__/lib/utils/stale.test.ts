import { describe, it, expect } from 'vitest'
import { isStale, type StaleInput } from '@/lib/utils/stale'

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

const base: StaleInput = {
  status: 'Open',
  phase: 'Active',
  due_date: null,
  launch_date: null,
  updated_at: daysAgo(45),
}

describe('isStale', () => {
  it('flags an open active project with no dates and no updates in 30+ days', () => {
    expect(isStale(base)).toBe(true)
  })

  it('does not flag a recently updated project', () => {
    expect(isStale({ ...base, updated_at: daysAgo(5) })).toBe(false)
  })

  it('treats the 30-day mark as the cutoff', () => {
    expect(isStale({ ...base, updated_at: daysAgo(29) })).toBe(false)
    expect(isStale({ ...base, updated_at: daysAgo(31) })).toBe(true)
  })

  it('does not flag an old project that has a due date', () => {
    expect(isStale({ ...base, due_date: '2099-12-31' })).toBe(false)
  })

  it('does not flag an old project that has a launch date', () => {
    expect(isStale({ ...base, launch_date: '2026-01-15' })).toBe(false)
  })

  it('does not flag closed projects', () => {
    expect(isStale({ ...base, status: 'Closed' })).toBe(false)
  })

  it('does not flag projects on hold', () => {
    expect(isStale({ ...base, status: 'Hold' })).toBe(false)
  })

  it('does not flag projects still in scoping', () => {
    expect(isStale({ ...base, phase: 'Scoping' })).toBe(false)
  })
})

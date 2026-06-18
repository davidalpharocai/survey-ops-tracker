import { describe, it, expect } from 'vitest'
import {
  sprintNumberForDate,
  sprintRange,
  sprintStartISO,
  sprintLabel,
  sprintOptions,
  currentSprintNumber,
  type SprintConfig,
} from './sprints'

// Anchor on a Monday; 14-day sprints. Sprint 1 = Jun 1–Jun 14, 2026.
const cfg: SprintConfig = { anchor_date: '2026-06-01', length_days: 14 }

describe('sprints', () => {
  it('numbers dates relative to the anchor', () => {
    expect(sprintNumberForDate(new Date(2026, 5, 1), cfg)).toBe(1) // anchor day
    expect(sprintNumberForDate(new Date(2026, 5, 14), cfg)).toBe(1) // last day of S1
    expect(sprintNumberForDate(new Date(2026, 5, 15), cfg)).toBe(2) // first day of S2
    expect(sprintNumberForDate(new Date(2026, 5, 29), cfg)).toBe(3)
  })

  it('derives the inclusive date range of a sprint', () => {
    const { start, end } = sprintRange(3, cfg)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(5) // June
    expect(start.getDate()).toBe(29)
    expect(end.getDate()).toBe(12) // Jul 12 — 14 days inclusive
    expect(end.getMonth()).toBe(6) // July
  })

  it('returns the local-time start date (no UTC off-by-one)', () => {
    // Regression: .toISOString() shifted this back a day in any timezone
    // behind UTC. Must match the local calendar date of the sprint start.
    expect(sprintStartISO(1, cfg)).toBe('2026-06-01')
    expect(sprintStartISO(2, cfg)).toBe('2026-06-15')
    expect(sprintStartISO(3, cfg)).toBe('2026-06-29')
  })

  it('labels a sprint with its number and range', () => {
    expect(sprintLabel(1, cfg)).toBe('Sprint 1 · Jun 1 – Jun 14')
  })

  it('clamps the current sprint number to >= 1 when the anchor is in the future', () => {
    const future: SprintConfig = { anchor_date: '2999-01-01', length_days: 14 }
    expect(currentSprintNumber(future)).toBe(1)
  })

  it('builds an options window that always includes the stored sprint', () => {
    const opts = sprintOptions(cfg, 99, 2, 6)
    expect(opts.some(o => o.number === 99)).toBe(true)
    // never offers sprint numbers below 1
    expect(opts.every(o => o.number >= 1)).toBe(true)
    // sorted ascending
    const nums = opts.map(o => o.number)
    expect(nums).toEqual([...nums].sort((a, b) => a - b))
  })
})

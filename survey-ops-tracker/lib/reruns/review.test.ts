import { describe, it, expect } from 'vitest'
import { mostRecentMonday, isReviewedThisWeek } from './review'

describe('mostRecentMonday', () => {
  it('returns a Monday on or before the given day, within the last 7 days', () => {
    // Cover every weekday in a stable window.
    for (let offset = 0; offset < 14; offset++) {
      const now = new Date(2026, 6, 1 + offset, 15, 30) // Jul 2026, mid-afternoon
      const mon = mostRecentMonday(now)
      expect(mon.getDay()).toBe(1) // Monday
      expect(mon.getHours()).toBe(0)
      expect(mon.getMinutes()).toBe(0)
      const midnightNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      expect(mon.getTime()).toBeLessThanOrEqual(midnightNow)
      const diffDays = (midnightNow - mon.getTime()) / 86_400_000
      expect(diffDays).toBeGreaterThanOrEqual(0)
      expect(diffDays).toBeLessThan(7)
    }
  })

  it('returns the same day when now is already a Monday', () => {
    const monday = mostRecentMonday(new Date(2026, 6, 15)) // seed
    const asked = mostRecentMonday(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9))
    expect(asked.getTime()).toBe(monday.getTime())
  })
})

describe('isReviewedThisWeek', () => {
  const now = new Date(2026, 6, 15, 12) // a Wednesday
  const monday = mostRecentMonday(now)

  it('is false when there is no prior review', () => {
    expect(isReviewedThisWeek(null, now)).toBe(false)
    expect(isReviewedThisWeek(undefined, now)).toBe(false)
    expect(isReviewedThisWeek('not-a-date', now)).toBe(false)
  })

  it('is false when the last review was before this week’s Monday', () => {
    const beforeMonday = new Date(monday.getTime() - 60_000).toISOString()
    expect(isReviewedThisWeek(beforeMonday, now)).toBe(false)
  })

  it('is true when the last review was on or after this week’s Monday', () => {
    const onMonday = new Date(monday.getTime() + 60_000).toISOString()
    expect(isReviewedThisWeek(onMonday, now)).toBe(true)
    expect(isReviewedThisWeek(now.toISOString(), now)).toBe(true)
  })
})

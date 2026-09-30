import { describe, it, expect } from 'vitest'
import { freshness, STALE_AFTER_DAYS } from './freshness'

const TODAY = '2026-09-28'

describe('the in-field freshness stamp', () => {
  // Alex via David, 2026-09-28: "it should show the date and time." Four of his
  // studies were last changed inside the same minute on 28 Sep, so "today" on
  // its own cannot tell an 8am edit from a 9pm one.
  it('prints the day, the clock time in Eastern, and how long ago', () => {
    const f = freshness('2026-09-26T18:32:00Z', TODAY, true)
    expect(f?.text).toBe('responses last counted 2026-09-26, 2:32 PM ET · 2 days ago')
    expect(f?.stale).toBe(false)
    expect(f?.title).toBe('The response count on this study last changed 2026-09-26 at 2:32 PM Eastern.')
  })

  it('counts the day in Eastern, not on the server clock', () => {
    // 01:30 UTC on the 28th is 9:30 PM ET on the 27th. Slicing the raw
    // timestamp would date this to today and print "today".
    const f = freshness('2026-09-28T01:30:00Z', TODAY, true)
    expect(f?.text).toContain('2026-09-27')
    expect(f?.text).toContain('yesterday')
  })

  it('says "today" and "yesterday" rather than counting to one', () => {
    expect(freshness('2026-09-28T14:00:00Z', TODAY, true)?.text).toContain('· today')
    expect(freshness('2026-09-27T14:00:00Z', TODAY, true)?.text).toContain('· yesterday')
    expect(freshness('2026-09-26T14:00:00Z', TODAY, true)?.text).toContain('· 2 days ago')
  })

  it('colours a count older than a week, and not one exactly a week old', () => {
    const at = (d: string) => freshness(`${d}T14:00:00Z`, TODAY, true)
    expect(at('2026-09-21')?.stale).toBe(false)   // 7 days
    expect(at('2026-09-20')?.stale).toBe(true)    // 8
    expect(STALE_AFTER_DAYS).toBe(7)
  })

  // The case that matters: 8 of Alex's 25 live surveys had no recorded change
  // at all. "0 of 3,000, never counted" is unmeasured, not behind.
  it('distinguishes never counted from counted long ago', () => {
    const never = freshness(undefined, TODAY, true)
    expect(never?.text).toBe('responses never counted')
    expect(never?.stale).toBe(true)
    expect(never?.title).toContain('not a measurement')
  })

  // A failed or denied read is a statement about our access, not about the
  // survey. Rendering it as "never" would be a claim about the data.
  it('says nothing at all when the freshness read failed', () => {
    expect(freshness(undefined, TODAY, false)).toBeNull()
    expect(freshness('2026-09-26T18:32:00Z', TODAY, false)).toBeNull()
  })

  // The words the stamp used until 2026-09-28. "N collected" was a column
  // heading on the sales screens; it is not one anywhere in the portal now, so
  // the stamp must not date a field by a name its reader cannot find.
  it('names no field the sales portal no longer shows', () => {
    const texts = [
      freshness('2026-09-26T18:32:00Z', TODAY, true),
      freshness(undefined, TODAY, true),
    ].flatMap(f => [f?.text ?? '', f?.title ?? ''])
    for (const t of texts) {
      expect(t).not.toMatch(/\bN collected\b/i)
      expect(t).not.toMatch(/\bN updated\b/i)
      expect(t).not.toMatch(/\bcollected\b/i)
    }
  })
})

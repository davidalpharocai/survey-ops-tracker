import { describe, it, expect } from 'vitest'
import { CHANGELOG, LATEST_CHANGE_DATE } from './entries'

// The changelog is hand-written by whoever ships a change, which makes it the
// kind of file that rots quietly: a date typed in the wrong order, an entry
// pasted straight from a commit message, an empty section left behind. These
// assertions are the editorial rules from the file's own header, enforced.

describe('CHANGELOG', () => {
  it('is not empty and exposes the newest date', () => {
    expect(CHANGELOG.length).toBeGreaterThan(0)
    expect(LATEST_CHANGE_DATE).toBe(CHANGELOG[0].date)
  })

  it('is ordered newest first', () => {
    // The page renders in array order and does not sort, so the order here IS
    // the order on screen. ISO dates compare correctly as strings.
    const dates = CHANGELOG.map((e) => e.date)
    expect([...dates]).toEqual([...dates].sort().reverse())
  })

  it('uses ISO dates that are real calendar days', () => {
    for (const { date } of CHANGELOG) {
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const [y, m, d] = date.split('-').map(Number)
      const parsed = new Date(y, m - 1, d)
      // Catches 2026-02-31, which Date would silently roll into March.
      expect(parsed.getMonth()).toBe(m - 1)
      expect(parsed.getDate()).toBe(d)
    }
  })

  it('has no duplicate dates', () => {
    // Two entries for one day would render as two identical headings.
    const dates = CHANGELOG.map((e) => e.date)
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('has at least one change per date', () => {
    for (const e of CHANGELOG) {
      expect(e.changes.length, `${e.date} has no changes`).toBeGreaterThan(0)
    }
  })

  it('writes for a colleague, not from the commit log', () => {
    for (const e of CHANGELOG) {
      for (const c of e.changes) {
        expect(['NEW', 'IMPROVED', 'FIXED']).toContain(c.kind)
        expect(c.text.trim().length, `${e.date}: empty text`).toBeGreaterThan(20)
        // A conventional-commit prefix means the commit subject was pasted in
        // rather than rewritten — the one mistake this file exists to prevent.
        expect(c.text, `${e.date}: reads like a commit message — "${c.text}"`).not.toMatch(
          /^(feat|fix|perf|chore|refactor|docs|types|style|test)(\([^)]*\))?:/i
        )
        // Sentence, not a fragment.
        expect(c.text.trim(), `${e.date}: should end in a full stop — "${c.text}"`).toMatch(/[.!?]$/)
      }
    }
  })

  it('keeps internal vocabulary out of the copy', () => {
    // No file paths, table names or migration numbers — the rule from the
    // file's header. A reader of this page does not know what 082 is.
    for (const e of CHANGELOG) {
      for (const c of e.changes) {
        expect(c.text, `${e.date}: looks like a file path — "${c.text}"`).not.toMatch(/\.(ts|tsx|sql)\b/)
        expect(c.text, `${e.date}: mentions a migration number — "${c.text}"`).not.toMatch(
          /\bmigration\s*\d+/i
        )
        expect(c.text, `${e.date}: mentions a table — "${c.text}"`).not.toMatch(
          /\b(project_\w+|profile_\w+|survey_projects)\b/
        )
      }
    }
  })
})

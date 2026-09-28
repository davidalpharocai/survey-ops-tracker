import { describe, expect, it } from 'vitest'
import { checkById, type CheckResult, type CleanupReport } from '@/lib/admin/cleanup'
import { cleanSurvey, resetFixtureSeq } from '@/lib/admin/fixtures'
import { headline, orderResults, tileState } from './order'

/** A result for a real check, so the severities under test are the shipped ones. */
const res = (id: string, over: Partial<CheckResult> = {}): CheckResult => ({
  check: checkById(id)!,
  available: true,
  blockedBy: [],
  applies: 100,
  rows: [],
  waves: [],
  count: 0,
  waveCount: 0,
  ...over,
})

const ids = (rs: CheckResult[]) => orderResults(rs).map(r => r.check.id)

describe('what a tile is', () => {
  it('separates "nothing wrong" from "we could not look"', () => {
    expect(tileState(res('no_due_date'))).toBe('clear')
    expect(tileState(res('no_due_date', { count: 3 }))).toBe('work')
    // Waves alone are still work — they are stated apart, not written off.
    expect(tileState(res('no_due_date', { waveCount: 3 }))).toBe('work')
    expect(tileState(res('no_launch_date', { available: false, blockedBy: ['blasts'] }))).toBe('blocked')
  })
})

describe('worst first', () => {
  it('puts what we could not measure above any number we did measure', () => {
    expect(ids([
      res('no_salesperson', { count: 99 }),
      res('no_launch_date', { available: false, blockedBy: ['blasts'] }),
    ])).toEqual(['no_launch_date', 'no_salesperson'])
  })

  it('ranks work by severity first, then by size', () => {
    expect(ids([
      res('no_requested_by', { count: 200 }),        // medium, big
      res('no_salesperson', { count: 3 }),           // high, small
      res('no_captain', { count: 30 }),              // high, bigger
      res('repeated_survey_tool_id', { count: 500 }), // low, biggest
    ])).toEqual(['no_captain', 'no_salesperson', 'no_requested_by', 'repeated_survey_tool_id'])
  })

  it('sinks the settled tiles to the bottom and keeps their order stable', () => {
    expect(ids([
      res('no_captain'),
      res('no_requested_by', { count: 1 }),
      res('no_salesperson'),
    ])).toEqual(['no_requested_by', 'no_captain', 'no_salesperson'])
  })
})

describe('the headline', () => {
  const report = (results: CheckResult[]): CleanupReport => ({
    results,
    scope: { includeLegacyImport: false },
    scanned: 433, inScope: 257, excludedLegacy: 176, waves: 130,
    blocked: [], today: '2026-09-28', clean: false, surveysNeedingWork: 62,
  })

  it('counts blocked tiles apart from clear ones — an unknown is not a zero', () => {
    resetFixtureSeq()
    const wave = cleanSurvey({ series_id: 's1', rerun_number: 2 })
    const h = headline(report([
      res('no_captain'),
      res('no_salesperson', { count: 2, rows: [cleanSurvey(), cleanSurvey()] }),
      res('no_due_date', { waveCount: 1, waves: [wave] }),
      res('no_launch_date', { available: false, blockedBy: ['blasts'] }),
    ]))
    expect(h).toEqual({ clear: 1, work: 2, blocked: 1, total: 4, surveys: 62, waves: 1 })
  })
})

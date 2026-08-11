import { describe, it, expect } from 'vitest'
import { bucketRerunCalendar, buildRerunDigest, type RerunCalendarRow } from './digest'

// Monday, matches the cron's week-window convention.
const WEEK_START = '2026-08-10'
const WEEK_END = '2026-08-16'

const row = (over: Partial<RerunCalendarRow>): RerunCalendarRow => ({
  client: 'Acme',
  surveyName: 'Consumer Tracker',
  waveNo: 4,
  cadenceLabel: 'Monthly',
  isOverdue: false,
  needsDefinition: false,
  effectiveDueISO: null,
  launchDateISO: null,
  deliverDateISO: null,
  ...over,
})

describe('bucketRerunCalendar', () => {
  it('buckets a wave with a launch_date in-window as fielding this week', () => {
    const rows = [row({ launchDateISO: '2026-08-12' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.fielding).toHaveLength(1)
    expect(buckets.fielding[0].dateISO).toBe('2026-08-12')
    expect(buckets.overdue).toHaveLength(0)
    expect(buckets.delivering).toHaveLength(0)
    expect(buckets.upcoming).toHaveLength(0)
  })

  it('buckets a wave with a deliver_date in-window as delivering this week', () => {
    const rows = [row({ deliverDateISO: '2026-08-14' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.delivering).toHaveLength(1)
    expect(buckets.delivering[0].dateISO).toBe('2026-08-14')
  })

  it('a wave can land in both fielding and delivering when both dates fall in-window', () => {
    const rows = [row({ launchDateISO: '2026-08-11', deliverDateISO: '2026-08-13' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.fielding).toHaveLength(1)
    expect(buckets.delivering).toHaveLength(1)
  })

  it('an overdue series lands in overdue, not fielding/delivering/upcoming', () => {
    const rows = [row({ isOverdue: true, effectiveDueISO: '2026-08-01' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.overdue).toHaveLength(1)
    expect(buckets.overdue[0].dateISO).toBe('2026-08-01')
    expect(buckets.fielding).toHaveLength(0)
  })

  it('a needs-definition series lands in overdue even with no due date computed', () => {
    const rows = [row({ needsDefinition: true, effectiveDueISO: null })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.overdue).toHaveLength(1)
    expect(buckets.overdue[0].dateISO).toBe('')
  })

  it('a series due next week (no in-window wave dates) lands in the preview bucket', () => {
    const rows = [row({ effectiveDueISO: '2026-08-19' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.upcoming).toHaveLength(1)
    expect(buckets.upcoming[0].dateISO).toBe('2026-08-19')
    expect(buckets.overdue).toHaveLength(0)
  })

  it('a due date beyond next week matches no bucket', () => {
    const rows = [row({ effectiveDueISO: '2026-09-01' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.overdue).toHaveLength(0)
    expect(buckets.fielding).toHaveLength(0)
    expect(buckets.delivering).toHaveLength(0)
    expect(buckets.upcoming).toHaveLength(0)
  })

  it('a due date before this week (not flagged overdue) matches no bucket', () => {
    // Guards against silently promoting a stale/undated row into "next week" —
    // only isOverdue/needsDefinition should populate the overdue bucket.
    const rows = [row({ effectiveDueISO: '2026-08-01' })]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.overdue).toHaveLength(0)
    expect(buckets.upcoming).toHaveLength(0)
  })

  it('sorts each bucket by date then client', () => {
    const rows = [
      row({ client: 'Zeta', launchDateISO: '2026-08-11' }),
      row({ client: 'Acme', launchDateISO: '2026-08-11' }),
      row({ client: 'Beta', launchDateISO: '2026-08-10' }),
    ]
    const buckets = bucketRerunCalendar(rows, WEEK_START)
    expect(buckets.fielding.map((i) => i.client)).toEqual(['Beta', 'Acme', 'Zeta'])
  })
})

describe('buildRerunDigest', () => {
  const emptyBuckets = { overdue: [], fielding: [], delivering: [], upcoming: [] }

  it('front-loads overdue/fielding/delivering counts in the subject', () => {
    const buckets = bucketRerunCalendar(
      [
        row({ client: 'A', isOverdue: true, effectiveDueISO: '2026-08-01' }),
        row({ client: 'B', launchDateISO: '2026-08-11' }),
        row({ client: 'C', launchDateISO: '2026-08-12' }),
        row({ client: 'D', launchDateISO: '2026-08-13' }),
        row({ client: 'E', deliverDateISO: '2026-08-14' }),
        row({ client: 'F', deliverDateISO: '2026-08-15' }),
      ],
      WEEK_START
    )
    const digest = buildRerunDigest({ ...buckets, weekStartISO: WEEK_START, weekEndISO: WEEK_END, baseUrl: 'https://example.com' })
    expect(digest.subject).toBe('Rerun digest · week of Aug 10 — 1 overdue, 3 fielding, 2 delivering')
  })

  it('empty week returns a valid digest with a (0) subject and short body', () => {
    const digest = buildRerunDigest({ ...emptyBuckets, weekStartISO: WEEK_START, weekEndISO: WEEK_END, baseUrl: 'https://example.com' })
    expect(digest.subject).toBe('Rerun digest · week of Aug 10 (0)')
    expect(digest.html).toContain('Nothing on the rerun calendar this week.')
  })

  it('HTML-escapes a script-y client/survey name', () => {
    const digest = buildRerunDigest({
      overdue: [],
      fielding: [{ client: '<script>alert(1)</script>', surveyName: 'Tracker & Co', waveNo: 2, cadenceLabel: 'Monthly', dateISO: '2026-08-11' }],
      delivering: [],
      upcoming: [],
      weekStartISO: WEEK_START,
      weekEndISO: WEEK_END,
      baseUrl: 'https://example.com',
    })
    expect(digest.html).not.toContain('<script>alert(1)</script>')
    expect(digest.html).toContain('&lt;script&gt;')
    expect(digest.html).toContain('Tracker &amp; Co')
  })

  it('renders no flexbox/inline-block anywhere (Outlook-safe table layout)', () => {
    const buckets = bucketRerunCalendar(
      [
        row({ isOverdue: true, effectiveDueISO: '2026-08-01' }),
        row({ launchDateISO: '2026-08-11' }),
        row({ deliverDateISO: '2026-08-12' }),
        row({ effectiveDueISO: '2026-08-19' }),
      ],
      WEEK_START
    )
    const digest = buildRerunDigest({ ...buckets, weekStartISO: WEEK_START, weekEndISO: WEEK_END, baseUrl: 'https://example.com' })
    expect(digest.html).not.toContain('display:flex')
    expect(digest.html).not.toContain('display: flex')
    expect(digest.html).not.toContain('inline-block')
    expect(digest.html).not.toContain('display:grid')
    expect(digest.html).not.toContain('display: grid')
  })

  it('includes the Reruns page link built from baseUrl and the footer cadence note', () => {
    const digest = buildRerunDigest({ ...emptyBuckets, weekStartISO: WEEK_START, weekEndISO: WEEK_END, baseUrl: 'https://survey-ops-tracker.vercel.app' })
    expect(digest.html).toContain('https://survey-ops-tracker.vercel.app/reruns')
    expect(digest.html).toContain('Sent Mondays')
  })

  it('renders wave # and cadence as a subline', () => {
    const digest = buildRerunDigest({
      overdue: [],
      fielding: [{ client: 'Acme', surveyName: 'Tracker', waveNo: 5, cadenceLabel: 'Quarterly', dateISO: '2026-08-11' }],
      delivering: [],
      upcoming: [],
      weekStartISO: WEEK_START,
      weekEndISO: WEEK_END,
      baseUrl: 'https://example.com',
    })
    expect(digest.html).toContain('Wave 5 · Quarterly')
  })
})

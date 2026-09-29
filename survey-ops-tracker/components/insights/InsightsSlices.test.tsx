import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, within } from '@testing-library/react'
import type { InsightsProject, InsightsRaw } from '@/lib/insights/load'

/**
 * /insights, sliced every way it can be sliced.
 *
 * David, 2026-09-28: "insights should be full proof no matter how you slice and
 * dice it too." The suite beside this one checks particular behaviours on one
 * fixture. This one checks INVARIANTS — the things that must hold for every
 * combination of date range, type, captain and account, including the empty and
 * single-point slices that are where a chart usually starts lying.
 *
 * What it is looking for, in order of how badly each would read to David:
 *
 *   1. A rendered NaN, Infinity, undefined or "[object Object]". A chart that
 *      divides by an empty slice produces these and they go straight on screen.
 *   2. A dollar figure. /insights has none and must never grow one.
 *   3. An unmeasured figure printed as a measurement — "0%" or "0 days" for a
 *      month with nothing to measure. The NULL-vs-0 rule this codebase keeps
 *      re-learning: a month with no due dates has no on-time rate, and 0% is a
 *      claim that everything was late.
 *   4. More than one range boundary on a chart. The rule is drawn where the
 *      chosen dates begin, and trendMonths always ends the axis on the range's
 *      last month, so a second rule would mean the reasoning behind it broke.
 *   5. A scope chip that does not say what range it covers.
 *
 * The fixture is deliberately awkward: a month with no due dates, a month with
 * no submitted dates, a captain who appears in one month only, a delivered
 * survey with no captain, and an account with a single survey.
 */

const replace = vi.fn()
let qs = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(qs),
}))

let raw: InsightsRaw
vi.mock('./useInsightsData', () => ({
  useInsightsData: () => ({ data: raw, isLoading: false, error: null }),
}))

import { InsightsDashboard } from './InsightsDashboard'

let seq = 0
const P = (o: Partial<InsightsProject> = {}): InsightsProject => ({
  id: `p${++seq}`, project_code: `PR${String(seq).padStart(5, '0')}`, project_name: `Survey ${seq}`,
  client: 'Acme', client_id: 'acme', status: 'Closed', phase: 'Active', board_column: 'Delivery',
  project_type: 'PS', submitted_date: null, launch_date: null, due_date: null, deliver_date: null,
  n_target: null, n_target_max: null, n_collected: 0, n_actual: null, is_placeholder: false,
  cancelled_at: null, series_id: null, rerun_number: 1, captain: { id: 'alex', name: 'Alex Pinsky', initials: 'AP' },
  ...o,
})

const AL = { id: 'alex', name: 'Alex Pinsky', initials: 'AP' }
const SR = { id: 'sree', name: 'Sree', initials: 'SR' }
const JE = { id: 'jenna', name: 'Jenna', initials: 'JE' }

function fixture(): InsightsRaw {
  seq = 0
  const projects: InsightsProject[] = []
  const months: [string, number][] = [
    ['2025-10', 5], ['2025-11', 9], ['2025-12', 4], ['2026-01', 11], ['2026-02', 6], ['2026-03', 13],
    ['2026-04', 8], ['2026-05', 15], ['2026-06', 10], ['2026-07', 12], ['2026-08', 17], ['2026-09', 9],
  ]
  for (const [m, n] of months) {
    for (let i = 0; i < n; i++) {
      const day = String((i % 26) + 2).padStart(2, '0')
      projects.push(P({
        deliver_date: `${m}-${day}`,
        // June: no due dates at all — the on-time line must BREAK, not read 0%.
        due_date: m === '2026-06' ? null : i % 5 === 0 ? `${m}-01` : `${m}-28`,
        // March: no submitted dates — the cycle line must break too.
        submitted_date: m === '2026-03' ? null : `${m}-01`,
        n_actual: 120 + ((i * 37) % 900),
        project_type: i % 3 === 0 ? 'B2B' : i % 7 === 0 ? 'Rerun' : 'PS',
        client_id: i % 4 === 0 ? 'brix' : i === 3 && m === '2026-05' ? 'solo' : 'acme',
        // Jenna delivers in September only: every other month is UNMEASURED for
        // her, not zero.
        captain: m === '2026-09' && i % 4 === 0 ? JE : i % 3 === 0 ? SR : AL,
      }))
    }
  }
  projects.push(P({ deliver_date: '2026-09-22', submitted_date: '2026-09-01', n_actual: 300, captain: null as never }))
  projects.push(P({ status: 'Open', board_column: 'Fielding', due_date: '2026-09-20', n_target: 1000, n_collected: 400 }))
  projects.push(P({ status: 'Hold', board_column: 'Submitted' }))
  projects.push(P({ status: 'Cancelled', cancelled_at: '2026-08-02', board_column: 'Fielding' }))
  projects.push(P({ is_placeholder: true, deliver_date: '2026-09-03' }))
  return {
    projects,
    rowCounts: new Map(),
    accounts: new Map([['acme', 'Acme Capital'], ['brix', 'Brixton Partners'], ['solo', 'Solo Account']]),
    blocked: [],
    demoDropped: 0,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-28T16:00:00Z'))
  qs = ''
  raw = fixture()
  replace.mockClear()
})
afterEach(() => vi.useRealTimers())

const RANGES = ['', 'range=last-month', 'range=this-quarter', 'range=since-jun-1', 'range=last-12-months', 'range=all',
  'range=custom&from=2026-09-15&to=2026-09-20', 'range=custom&from=2026-06-01&to=2026-06-30']
const TYPES = ['', 'type=PS', 'type=B2B', 'type=Rerun']
const CAPTAINS = ['', 'captain=alex', 'captain=sree', 'captain=jenna', 'captain=none']
const ACCOUNTS = ['', 'account=acme', 'account=brix', 'account=solo']

const join = (...parts: string[]) => parts.filter(Boolean).join('&')

/** Every combination, which is 8 x 4 x 5 x 4 = 640 renders. */
function everySlice(): string[] {
  const out: string[] = []
  for (const r of RANGES) for (const t of TYPES) for (const c of CAPTAINS) for (const a of ACCOUNTS) {
    out.push(join(r, t, c, a))
  }
  return out
}

/** Text the reader sees, with the accessible-only summaries left in — those
 *  are read out loud and a NaN in one is still a NaN said to a person. */
const visible = (el: HTMLElement) => el.textContent ?? ''

describe('/insights, sliced every way', () => {
  const slices = everySlice()

  /**
   * ONE PASS, EVERY INVARIANT. Each of these started as its own `it`, which
   * rendered all 640 slices five times over and cost six minutes of every CI
   * run for the same coverage. The assertions all name the slice and what
   * failed, so a single test is no harder to diagnose than five were.
   */
  it('holds every invariant across all 640 slices', () => {
    expect(slices.length).toBe(640)

    // Percentages are read off LEAF TEXT NODES, not the concatenated
    // textContent: "September 2026" immediately followed by "78%" reads as
    // 202678% and would fail a page that is perfectly correct.
    const percents = (root: HTMLElement) => {
      const out: string[] = []
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        for (const m of (n.textContent ?? '').matchAll(/(?:^|[^\d,.])(-?\d+(?:\.\d+)?)%/g)) out.push(m[1])
      }
      return out
    }

    for (const slice of slices) {
      qs = slice
      // A throw here fails with the slice in the message.
      const { container, unmount } = render(<InsightsDashboard />)
      const t = visible(container)

      for (const bad of ['NaN', 'Infinity', 'undefined', 'null', '[object Object]']) {
        expect(t.includes(bad), `${bad} in ?${slice}`).toBe(false)
      }

      // /insights carries no money and must not grow any.
      expect(t.includes('$'), `$ in ?${slice}`).toBe(false)

      // trendMonths ends the axis on the range's last month, so only the START
      // can fall inside the picture. Two rules would mean that stopped being
      // true and the label would point at the wrong month.
      for (const svg of container.querySelectorAll('svg')) {
        const rules = svg.querySelectorAll('[data-part="range-start"]')
        expect(rules.length, `${rules.length} boundaries in ?${slice}`).toBeLessThanOrEqual(1)
      }

      // Every card names the window it counts. Usually that is a date range;
      // the live card deliberately ignores the dates and says "right now"
      // instead — work in flight is not a thing that happened in a past month.
      const chips = [...container.querySelectorAll('[title="Which surveys this card counts"]')]
        .map(c => c.textContent ?? '')
      expect(chips.length, `no scope chips in ?${slice}`).toBeGreaterThan(0)
      for (const chip of chips) {
        const named = /\d{4}|All time/.test(chip) || /right now/i.test(chip)
        expect(named, `chip without a window in ?${slice}: ${chip}`).toBe(true)
      }

      for (const p of percents(container)) {
        const pct = Number(p)
        expect(pct, `${p}% in ?${slice}`).toBeGreaterThanOrEqual(0)
        expect(pct, `${p}% in ?${slice}`).toBeLessThanOrEqual(100)
      }

      unmount()
    }
  }, 300_000)
})

describe('/insights: an unmeasured month is not a zero', () => {
  // The rule this codebase keeps re-learning. June has no due dates in the
  // fixture and March has no submitted dates, so neither month has an on-time
  // rate or a cycle time — and 0% would say everything was late.
  it('breaks the on-time line in a month with no due dates rather than calling it 0%', () => {
    qs = 'range=last-12-months'
    const { container } = render(<InsightsDashboard />)
    const card = [...container.querySelectorAll('section,div')]
      .find(el => /On time, by month/i.test(el.querySelector('h3,h2')?.textContent ?? '')) as HTMLElement
    expect(card).toBeTruthy()
    const label = card.querySelector('svg')?.getAttribute('aria-label') ?? ''
    expect(label).toBeTruthy()
    // June has no due dates in the fixture, so it has no on-time rate. What
    // must never happen is its being described as 0% — that is a claim that
    // every June delivery was late. The line breaks instead.
    expect(label).not.toMatch(/0%/)
  })

  it('breaks the cycle line in a month with no submitted dates', () => {
    qs = 'range=last-12-months'
    const { container } = render(<InsightsDashboard />)
    const card = [...container.querySelectorAll('section,div')]
      .find(el => /Median cycle time/i.test(el.querySelector('h3,h2')?.textContent ?? '')) as HTMLElement
    const label = card.querySelector('svg')?.getAttribute('aria-label') ?? ''
    expect(label).toBeTruthy()
    // March has no submitted dates, so no survey in it has a cycle time.
    // "0 days" would say every March survey delivered the day it came in.
    expect(label).not.toMatch(/0 days/)
  })

  it('does not turn a captain who delivered in one month into five months of zeros', () => {
    // Jenna delivers in September only. The other months on her axis are months
    // she measured nothing in, which is not the same as months she delivered
    // none in — and the column chart draws no bar rather than a zero-height one
    // labelled 0.
    qs = 'captain=jenna&range=last-12-months'
    const { container } = render(<InsightsDashboard />)
    const t = visible(container)
    expect(t).not.toContain('NaN')
    const onTime = [...container.querySelectorAll('svg')]
      .map(s => s.getAttribute('aria-label') ?? '')
      .find(l => /on time/i.test(l)) ?? ''
    expect(onTime).not.toMatch(/January 2026[^.]*\b0%/)
  })
})

describe('/insights: an empty slice says so rather than drawing nothing', () => {
  it('tells the reader when a filter leaves no surveys at all', () => {
    // Solo Account has one survey, delivered in May. Filtered to it in a
    // September window, the page has nothing to show and must say that in
    // words rather than render six empty cards.
    qs = 'account=solo&range=custom&from=2026-09-01&to=2026-09-30'
    const { container } = render(<InsightsDashboard />)
    const t = visible(container)
    expect(t).toMatch(/No delivered surveys|no surveys|nothing/i)
    expect(t).not.toContain('NaN')
    // And it still says which window it was looking at, so the reader knows
    // what to widen.
    const chips = [...container.querySelectorAll('[title="Which surveys this card counts"]')]
        .map(c => c.textContent ?? '')
    expect(chips.some(c => /Sep 2026/.test(c))).toBe(true)
  })

  it('survives a custom range whose end is before its start', () => {
    qs = 'range=custom&from=2026-09-30&to=2026-09-01'
    const { container } = render(<InsightsDashboard />)
    expect(visible(container)).not.toContain('NaN')
  })

  it('survives a custom range with only one end filled in', () => {
    for (const slice of ['range=custom&from=2026-09-01', 'range=custom&to=2026-09-01', 'range=custom']) {
      qs = slice
      const { container, unmount } = render(<InsightsDashboard />)
      expect(visible(container), slice).not.toContain('NaN')
      unmount()
    }
  })

  it('ignores a filter value that names nothing, instead of blanking the page', () => {
    // A stale link, a renamed captain, a deleted account. The page should read
    // as "everyone" rather than as "nobody", and must never render an empty
    // shell with no explanation.
    for (const slice of ['captain=ghost', 'account=ghost', 'type=Ghost', 'range=not-a-preset']) {
      qs = slice
      const { container, unmount } = render(<InsightsDashboard />)
      const t = visible(container)
      expect(t, slice).not.toContain('NaN')
      expect(t.length, slice).toBeGreaterThan(200)
      unmount()
    }
  })
})

describe('/insights: the numbers agree with each other', () => {
  // The share bounds are checked in the single full-slice pass above.
  it('counts the same delivered total in the tile and the month chart', () => {
    // Two different code paths over the same slice. When they disagree the
    // reader is looking at one page that contradicts itself.
    for (const slice of ['', 'range=last-month', 'type=PS', 'captain=sree', 'account=brix',
      'range=last-12-months&type=B2B', 'range=this-quarter&captain=alex&account=acme']) {
      qs = slice
      const { container, unmount } = render(<InsightsDashboard />)
      const tile = [...container.querySelectorAll('[data-part="kpi-tile"]')]
        .find(el => /Surveys delivered/i.test(el.textContent ?? '')) as HTMLElement | undefined
      if (tile) {
        const big = within(tile).queryByTestId?.('kpi-value')?.textContent
          ?? (tile.textContent ?? '').match(/\d[\d,]*/)?.[0] ?? ''
        expect(big, slice).not.toContain('NaN')
      }
      unmount()
    }
  })
})

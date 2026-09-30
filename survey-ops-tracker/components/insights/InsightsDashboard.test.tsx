import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { InsightsProject, InsightsRaw } from '@/lib/insights/load'

/**
 * The page end to end, on fixture data: it renders, it says only what the
 * numbers carry, a clicked figure lists exactly its surveys as real links, a
 * failed read is shown as Blocked (never as zeros), and no dollar sign appears
 * anywhere on the rendered page.
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
  cancelled_at: null, series_id: null, rerun_number: 1, captain: { id: 'alex', name: 'Alex', initials: 'AL' },
  ...o,
})

function fixture(): InsightsRaw {
  seq = 0
  const projects = [
    ...Array.from({ length: 12 }, (_, i) => P({
      deliver_date: `2026-09-${String(i + 2).padStart(2, '0')}`, due_date: '2026-09-20',
      submitted_date: '2026-08-28', n_actual: 150,
    })),
    ...Array.from({ length: 11 }, () => P({ deliver_date: '2026-08-12', due_date: '2026-08-10', project_type: 'B2B' })),
    P({ is_placeholder: true, deliver_date: '2026-09-03' }),
    P({ status: 'Open', board_column: 'Fielding', due_date: '2026-09-20', n_target: 100, n_collected: 40 }),
    P({ status: 'Hold', board_column: 'Submitted' }),
  ]
  return {
    projects, rowCounts: new Map(), accounts: new Map([['acme', 'Acme Capital']]), blocked: [], demoDropped: 2,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-27T16:00:00Z'))
  qs = ''
  raw = fixture()
  replace.mockClear()
})
afterEach(() => vi.useRealTimers())

/** A KPI tile's trend: the sparkline, the line of text under it, and the
 *  live region that says the same thing out loud. */
const tileTrend = (container: HTMLElement, ariaLabel: string): HTMLElement =>
  container.querySelector(`svg[aria-label^="${ariaLabel}."]`)!.closest('[data-part="tile-trend"]') as HTMLElement

describe('InsightsDashboard', () => {
  it('leads with a computed, factual headline', () => {
    render(<InsightsDashboard />)
    expect(screen.getByText(
      'The team has delivered 12 studies so far in September, up from 11 in 1–27 Aug 2026. ' +
      'That is 1,800 respondents, and 100% of those with a due date arrived on or before it.',
    )).toBeInTheDocument()
  })

  it('shows no dollar figure anywhere', () => {
    const { container } = render(<InsightsDashboard />)
    expect(container.textContent).not.toMatch(/\$/)
  })

  it('leaves the empty placeholder out and says so', () => {
    render(<InsightsDashboard />)
    expect(screen.getByText(/Left out everywhere: 1 empty rerun placeholder and 2 demo or test-account studies\./)).toBeInTheDocument()
  })

  it('a clicked tile lists exactly its surveys, each a real link', () => {
    render(<InsightsDashboard />)
    fireEvent.click(screen.getByRole('button', { name: '12' }))
    const panel = screen.getByRole('dialog', { name: 'Studies delivered' })
    expect(within(panel).getByText(/12 studies listed — the same as the 12 in the tile ✓/)).toBeInTheDocument()
    const links = within(panel).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/projects/'))
    expect(links).toHaveLength(12)
  })

  it('a clicked month column lists that month\'s surveys', () => {
    render(<InsightsDashboard />)
    // The stacked monthly chart is the first chart on the page.
    fireEvent.click(screen.getAllByRole('button', { name: /^Aug/ })[0])
    const panel = screen.getByRole('dialog', { name: 'Delivered · August 2026' })
    expect(within(panel).getByText(/11 studies listed — the same as the 11 on the chart ✓/)).toBeInTheDocument()
    // …with a real link that filters the whole page to that month.
    expect(within(panel).getByRole('link', { name: 'Filter the page to 1–31 Aug 2026' }))
      .toHaveAttribute('href', '/insights?range=custom&from=2026-08-01&to=2026-08-31')
  })

  it('reads the filter from the URL', () => {
    qs = 'range=last-month'
    render(<InsightsDashboard />)
    // A past month reads in the past tense, and August has no earlier month to
    // rank against or compare with, so the sentence claims nothing more.
    expect(screen.getByText(/^The team delivered 11 studies in August\./)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('a failed survey read is Blocked, never zero', () => {
    raw = { ...fixture(), projects: [], blocked: [{ table: 'survey_projects', message: 'permission denied' }] }
    render(<InsightsDashboard />)
    expect(screen.getByRole('alert')).toHaveTextContent('Blocked: survey_projects did not load (permission denied)')
    expect(screen.queryByText(/Studies delivered/)).not.toBeInTheDocument()
  })

  it('when clients fail, the footer says demo accounts could not be checked — never "0 demo"', () => {
    raw = { ...fixture(), accounts: new Map(), demoDropped: null, blocked: [{ table: 'clients', message: 'timeout' }] }
    render(<InsightsDashboard />)
    expect(screen.getByText(/Left out everywhere: 1 empty rerun placeholder\. Demo and test accounts could not be checked, because the clients table did not load\./))
      .toBeInTheDocument()
    expect(screen.queryByText(/0 demo/)).not.toBeInTheDocument()
  })

  it('the on-hold count opens the surveys on hold', () => {
    render(<InsightsDashboard />)
    fireEvent.click(screen.getAllByRole('button', { name: '1 on hold' })[0])
    const panel = screen.getByRole('dialog', { name: 'On hold' })
    expect(within(panel).getByText(/1 study listed — the same as the 1 in the tile ✓/)).toBeInTheDocument()
    expect(within(panel).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/projects/'))).toHaveLength(1)
  })

  /**
   * David, 2026-09-28: "if im looking at last 12 months as a date range, then
   * it needs to show the month-year in the chart. how else would i follow it".
   * So: every drawn month label names its month AND its year, the full month
   * is one hover away, and every month — labelled or thinned — has a tick.
   */
  describe('following a 12-month window', () => {
    /**
     * These render at DEFAULT_CHART_WIDTH: jsdom has no ResizeObserver, so
     * useChartWidth never measures and every chart here is 640px wide — not a
     * width the page renders at. The two trend charts actually get 534px (see
     * LineChart.test.tsx, "names all twelve months at the width /insights
     * renders it"), which is where the thinning used to bite; this file is
     * about the WIRING — which label the page hands each chart, and that a
     * thinned one is still recoverable — not about the geometry.
     */
    /** The axis labels that were shortened: what is drawn, and the full form
     *  riding along as the <title> a hover shows. */
    const axisMonths = (container: HTMLElement) =>
      [...container.querySelectorAll('svg text > title')]
        .filter(t => /^[A-Z][a-z]+ \d{4}$/.test(t.textContent ?? ''))
        .map(t => ({ full: t.textContent, drawn: t.nextSibling?.textContent }))

    it('draws a narrow month-and-year on every label, with the full month on hover', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      const labels = axisMonths(container)
      // Three month charts (delivered, on time, cycle time) of twelve months.
      expect(labels).toHaveLength(36)
      expect(labels.map(l => l.drawn)).toContain('Oct 25')
      expect(labels.map(l => l.drawn)).toContain('Sep 26')
      // Nothing is drawn that a reader could read as the wrong year…
      expect(labels.every(l => /^[A-Z][a-z]{2} \d{2}$/.test(l.drawn ?? ''))).toBe(true)
      // …and the axis never spends its width on the long form.
      expect(labels.find(l => l.full === 'September 2026')?.drawn).toBe('Sep 26')
    })

    it('gives every month a tick, so a thinned label still leaves its place marked', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      const ticks = [...container.querySelectorAll('[data-part="category-ticks"]')]
      expect(ticks.length).toBeGreaterThanOrEqual(3)
      expect(ticks[0].querySelectorAll('line')).toHaveLength(12)
    })

    it('a KPI sparkline has no axis, so it names its ends under it', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      const trend = tileTrend(container, 'Studies delivered per month')
      expect(within(trend).getByText('Oct 25')).toBeInTheDocument()
      expect(within(trend).getByText('Sep 26')).toBeInTheDocument()
      // The whole trend, for a reader who never points at it.
      const label = trend.querySelector('svg')!.getAttribute('aria-label')!
      expect(label).toMatch(/October 2025/)
      expect(label).toMatch(/September 2026/)
    })

    it('a clicked month still opens under its full name', () => {
      qs = 'range=last-12-months'
      render(<InsightsDashboard />)
      fireEvent.click(screen.getAllByRole('button', { name: /^September 2026/ })[0])
      expect(screen.getByRole('dialog', { name: 'Delivered · September 2026' })).toBeInTheDocument()
    })
  })

  /**
   * David, 2026-09-28: "it show be that as i hover over the graph, the month
   * and it is values pop up. nothing happens when i hover over the graphs" —
   * hovered on the tile trends, which are the first graphics on the page and
   * were the only inert ones.
   */
  describe('hovering a tile trend', () => {
    it('swaps the two end months for the month under the pointer and its figure', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      const trend = tileTrend(container, 'Studies delivered per month')
      const readout = trend.querySelector('[data-part="tile-readout"]')!
      expect(readout.textContent).toBe('Oct 25Sep 26')

      // The eleventh of twelve months is August 2026: eleven deliveries.
      fireEvent.mouseEnter(trend.querySelector('[data-spark-hit="10"]')!)
      expect(readout.textContent).toBe('August 202611')
      // And out loud, for a reader who is not looking at the tile.
      expect(within(trend).getByRole('status').textContent)
        .toBe('Studies delivered per month, August 2026: 11')

      fireEvent.mouseLeave(trend.querySelector('[data-part="spark-hits"]')!)
      expect(readout.textContent).toBe('Oct 25Sep 26')
      expect(within(trend).getByRole('status').textContent).toBe('')
    })

    it('says a month is not recorded rather than calling it zero', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      // No delivered survey in October 2025 has a cycle time, so the median
      // is missing — which is not the same as a median of nought days.
      const trend = tileTrend(container, 'Median days from submitted to delivered per month')
      fireEvent.mouseEnter(trend.querySelector('[data-spark-hit="0"]')!)
      expect(trend.querySelector('[data-part="tile-readout"]')!.textContent).toBe('October 2025not recorded')
    })

    it('is reachable from the keyboard, starting at the newest month', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      const trend = tileTrend(container, 'Studies delivered per month')
      const svg = trend.querySelector('svg')!
      fireEvent.focus(svg)
      expect(trend.querySelector('[data-part="tile-readout"]')!.textContent).toBe('September 202612')
      fireEvent.keyDown(svg, { key: 'ArrowLeft' })
      expect(trend.querySelector('[data-part="tile-readout"]')!.textContent).toBe('August 202611')
    })
  })

  /**
   * David, 2026-09-28: "nothing happens on the date range in the graph when i
   * change it in the filters". The trend charts pad to MIN_TREND_MONTHS, so
   * three presets can draw the same six months; what changes must be said,
   * not left to a wash on one chart of eight.
   */
  describe('changing the date range', () => {
    const ruleLabels = (container: HTMLElement) =>
      [...container.querySelectorAll('svg text')].map(t => t.textContent).filter(t => t?.startsWith('Your dates:'))
    const monthChips = () =>
      screen.getAllByTitle('Which studies this card counts').map(c => c.textContent).filter(c => c?.includes('by deliver month'))
    /** The rule on the "Delivered per month" columns. Scoped to that chart:
     *  a tile sparkline's dashed GOAL line is also "3 3". */
    const boundaryX = (container: HTMLElement) =>
      Number(container
        .querySelector('svg[aria-label^="Studies delivered per month, by type."]')!
        .querySelector('line[stroke-dasharray="3 3"]')!
        .getAttribute('x1'))

    it('marks where the chosen dates begin on all three month charts', () => {
      qs = ''
      const { container } = render(<InsightsDashboard />)
      // This month: six months are drawn, and only September is the answer.
      expect(ruleLabels(container)).toEqual([
        'Your dates: 1–27 Sep 2026', 'Your dates: 1–27 Sep 2026', 'Your dates: 1–27 Sep 2026',
      ])
      // The sparklines carry the same boundary.
      expect(container.querySelectorAll('[data-part="range-start"]').length).toBeGreaterThan(0)
    })

    it('moves the boundary when the preset changes, even though the months do not', () => {
      qs = ''
      const { container, unmount } = render(<InsightsDashboard />)
      const septRule = boundaryX(container)
      const septChip = monthChips()[0]
      unmount()

      qs = 'range=this-quarter'
      const q = render(<InsightsDashboard />)
      // Apr–Sep either way — the same six columns, a different answer.
      expect(boundaryX(q.container)).toBeLessThan(septRule)
      expect(ruleLabels(q.container)[0]).toBe('Your dates: 1 Jul–27 Sep 2026')
      expect(monthChips()[0]).not.toBe(septChip)
    })

    it('says the range and how much of the picture is only context', () => {
      qs = ''
      render(<InsightsDashboard />)
      expect(monthChips()[0]).toBe('Delivered · by deliver month · 1–27 Sep 2026 · 5 earlier months for context')
    })

    it('draws no boundary when every month drawn is inside the dates', () => {
      qs = 'range=last-12-months'
      const { container } = render(<InsightsDashboard />)
      expect(ruleLabels(container)).toEqual([])
      expect(container.querySelector('[data-part="range-start"]')).toBeNull()
      expect(monthChips()[0]).toBe('Delivered · by deliver month · 1 Oct 2025–27 Sep 2026')
    })

    it('fades the context months on the line charts too, not just the columns', () => {
      qs = ''
      const { container } = render(<InsightsDashboard />)
      const onTime = container.querySelector('svg[aria-label^="Share of deliveries on time, by month."]')!
      // Apr–Aug are context; September is the answer.
      expect(onTime.getAttribute('aria-label')).toContain(
        'Faded (outside your dates, shown for context): April 2026, May 2026, June 2026, July 2026, August 2026',
      )
      // Only August and September have a due date to judge. August's marker
      // is washed out…
      expect([...onTime.querySelectorAll('[data-mark="point"]')].map(p => p.getAttribute('opacity'))).toEqual(['0.35', null])
      // …and the one link, which crosses INTO the dates, keeps full ink.
      expect([...onTime.querySelectorAll('[data-mark="line"]')].map(p => p.getAttribute('opacity'))).toEqual([null])
    })
  })

  it('a failed child table is named, and the page still draws', () => {
    raw = { ...fixture(), rowCounts: null, blocked: [{ table: 'project_costs', message: 'timeout' }] }
    render(<InsightsDashboard />)
    expect(screen.getByText(/Blocked: project_costs did not load \(timeout\)/)).toBeInTheDocument()
    expect(screen.getByText('Studies delivered')).toBeInTheDocument()
  })
})

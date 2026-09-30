import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ImproveTab } from '../tabs/ImproveTab'
import type { FinanceTabProps } from '../tabs/types'
import { buildImproveModel } from '@/lib/finance/improve'
import { buildIndex, type FinProject } from '@/lib/finance/hub'
import { DEFAULT_FILTER, describe as describeFilter, itemsOf, populationFor } from '@/lib/finance/filters'
import { reconcile, type DrillSpec } from '@/lib/finance/drill'
import type { FinanceLoad, FinanceRaw } from '@/lib/finance/load'

/**
 * The tab end to end on a small book: it renders every card, the ranked list
 * opens reconciled drills, survey codes are real links, the export is the
 * ranked gap list registered ONCE (a shell that re-renders on registration must
 * not loop), and a failed read reads "Blocked", never "resolved".
 */

const TODAY = '2026-09-28'
const P = (o: Partial<FinProject> & { id: string }): FinProject => ({
  project_code: o.id.toUpperCase(), project_name: 'Survey', client: null, client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-10', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
let seq = 0
const B = (project_id: string, bid = 10) => ({
  id: `b${++seq}`, project_id, bid, completes: 10, people: 0, cost_per_send: 0, channel: 'email',
  blast_at: '2026-08-05T15:00:00Z', created_at: '2026-08-06T15:00:00Z',
})

function propsOf(blocked: FinanceLoad['blocked'] = [], extra: FinProject[] = []) {
  const projects = [P({ id: 'a1' }), P({ id: 'a2' }), P({ id: 'u1', deliver_date: null }), P({ id: 'q1', n_actual: null }), ...extra]
  const blasts = [B('a1'), B('a2', 50), B('u1', 3), B('q1', 2), ...extra.map(e => B(e.id, 5))]
  const rates = new Map([['a1', 50]])
  const raw: FinanceRaw = {
    projects, blasts, suppliers: [], launches: [], costs: [],
    financials: [{ project_id: 'a1', price_per_n: 50 }], rates, segments: [],
    accounts: [{ id: 'bam', name: 'BAM' }], contacts: [], terms: [],
  }
  const load: FinanceLoad = {
    raw, blocked,
    integrity: {
      loadedCounts: {} as never, expectedCounts: {} as never, countMismatches: [],
      spendRecomputedMatches: { matches: 0, of: 0, mismatchIds: [] },
      pricesReturned: 1, demoDropped: 0, loadedAt: `${TODAY}T12:00:00Z`,
    },
  }
  const ix = buildIndex(blasts, [], [])
  const items = itemsOf(projects, blasts, [], [], ix)
  const population = populationFor(items, 'improve', DEFAULT_FILTER, TODAY)
  const props: FinanceTabProps = {
    tab: 'improve', load, ix, items, population, side: [], filter: DEFAULT_FILTER, today: TODAY,
    scope: describeFilter(DEFAULT_FILTER, { tab: 'improve', today: TODAY, count: population.length }),
    accountName: id => (id === 'bam' ? 'BAM' : '(unknown account)'),
    openDrill: vi.fn(),
    hrefFor: patch => `/finance?${new URLSearchParams({ tab: patch.tab ?? 'improve', ...(patch.account ? { account: patch.account } : {}) })}`,
    registerExport: vi.fn(),
  }
  return props
}

describe('ImproveTab', () => {
  it('renders the four cards and the ranked list, largest dollars first', () => {
    render(<ImproveTab {...propsOf()} />)
    expect(screen.getByText(/What to record next, ranked by how much each gap hides/)).toBeInTheDocument()
    for (const h of ['What each month’s records carry', 'Logged within a week', 'What to record next', 'Blocked: needs data SOCC does not capture']) {
      expect(screen.getByRole('heading', { name: new RegExp(h) })).toBeInTheDocument()
    }
    const list = screen.getAllByRole('list').find(l => l.tagName === 'OL')!
    const first = within(list).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('Client price missing on costed work')
    expect(first).toHaveTextContent('$520')
    expect(screen.getByText(/Client price covers 1 of 3 delivered studies/)).toBeInTheDocument()
  })

  /**
   * David, 2026-09-28: a chart over a run of months has to say WHICH month.
   * This grid draws EVERY month with delivered work whatever dates are picked,
   * so it nearly always runs across a year — and two columns reading "Jun" a
   * year apart name nothing. Past about a year of columns the full "Jun 2026"
   * no longer fits and the grid falls back to the short form, which is the one
   * that used to be a bare "Jun".
   */
  it('names the year on the coverage grid once its months cross one', () => {
    const months = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
    const extra = months.map(m => P({ id: `m${m}`, deliver_date: `${m}-15` }))
    const { container } = render(<ImproveTab {...propsOf([], extra)} />)
    const grid = container.querySelector('figure[aria-label^="Share of delivered studies carrying each field"]')!
    // A FitText carries its long form as a <title> child, which textContent
    // would fold into the drawn words.
    const drawn = [...grid.querySelectorAll('svg text')]
      .map(t => [...t.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent ?? '').join(''))
    expect(drawn).toContain('Oct 25')
    // Every month label it does print carries its year: a bare "Oct" here
    // would be one of two Octobers the moment the book runs past twelve months.
    const MONTH = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( |$)/
    const bare = drawn.filter(t => MONTH.test(t) && !/\d\d$/.test(t))
    expect(bare).toEqual([])
    // The heatmap thins column headers that would collide, and a thinned month
    // is read from its cells instead — every one of which names its month in
    // full, to a screen reader and in the table twin.
    expect(grid.querySelector('[aria-label*="Oct 2025"]')).toBeTruthy()
    expect(grid.querySelector('[aria-label*="Sep 2026"]')).toBeTruthy()
  })

  it('plots the ranked list, colours the bars by what the dollars are, and drills from a bar', () => {
    const props = propsOf()
    const { container } = render(<ImproveTab {...props} />)
    const model = buildImproveModel({
      items: props.items, population: props.population, load: props.load, ix: props.ix,
      filter: props.filter, today: props.today, accountName: props.accountName,
    })
    // One bar per open gap that hides dollars; a gap with no dollar figure
    // would be a bar of nothing, so it stays in the list only.
    const sized = model.gaps.filter(g => g.status === 'open' && (g.dollars ?? 0) > 0)
    const gapChart = container.querySelector('figure[aria-label^="Dollars each open gap hides"]')!
    expect(gapChart.querySelectorAll('[data-mark="bar"]')).toHaveLength(sized.length)
    // The colour is explained in words beside it, never colour alone.
    expect(within(gapChart.parentElement as HTMLElement).getByText('Recorded cost')).toBeInTheDocument()

    const bar = gapChart.querySelector('[role="button"][aria-label^="Client price missing on costed work"]')!
    expect(bar.getAttribute('aria-label')).toContain('$520')
    fireEvent.click(bar)
    const spec = (props.openDrill as ReturnType<typeof vi.fn>).mock.calls[0][0] as DrillSpec
    expect(spec.key).toBe('improve-gap-price')
    expect(reconcile(spec).ok).toBe(true)
  })

  it('opens a gap’s surveys in a drill that reconciles', () => {
    const props = propsOf()
    render(<ImproveTab {...props} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Show the 2 studies/ })[0])
    const spec = (props.openDrill as ReturnType<typeof vi.fn>).mock.calls[0][0] as DrillSpec
    expect(spec.key).toBe('improve-gap-price')
    expect(reconcile(spec).ok).toBe(true)
  })

  it('links a one-survey gap straight to its project page with a real href', () => {
    render(<ImproveTab {...propsOf()} />)
    const link = screen.getByRole('link', { name: 'Open U1' })
    expect(link).toHaveAttribute('href', '/projects/u1')
  })

  it('registers the ranked gap list for export once, and clears it on unmount', () => {
    const props = propsOf()
    const { rerender, unmount } = render(<ImproveTab {...props} />)
    rerender(<ImproveTab {...props} accountName={id => (id === 'bam' ? 'BAM' : '(unknown account)')} />)
    const reg = props.registerExport as ReturnType<typeof vi.fn>
    expect(reg).toHaveBeenCalledTimes(1)
    expect(reg.mock.calls[0][0]).toMatchObject({ name: 'finance-improve-gaps' })
    expect(reg.mock.calls[0][0].rows).toHaveLength(16)
    unmount()
    expect(reg).toHaveBeenLastCalledWith(null)
  })

  it('shows a check whose table did not load as Blocked, not resolved', () => {
    render(<ImproveTab {...propsOf([{ table: 'project_costs', message: 'boom' }])} />)
    expect(screen.getAllByText(/Blocked: project_costs did not load, so this cannot be checked/).length).toBeGreaterThan(0)
    const box = screen.getByRole('heading', { name: /Resolved in this view/ }).closest('div')!
    expect(box).toHaveTextContent('PureSpectrum waves with no target')
    expect(box).not.toHaveTextContent('Reward recoveries not booked')
    // Spend without the cost lines is a floor, so no share of it is stated.
    expect(screen.getByText(/Blocked: project_costs did not load, so price coverage cannot be measured/)).toBeInTheDocument()
  })
})

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

describe('InsightsDashboard', () => {
  it('leads with a computed, factual headline', () => {
    render(<InsightsDashboard />)
    expect(screen.getByText(
      'The team has delivered 12 surveys so far in September, up from 11 in 1–27 Aug 2026. ' +
      'That is 1,800 respondents, and 100% of those with a due date arrived on or before it.',
    )).toBeInTheDocument()
  })

  it('shows no dollar figure anywhere', () => {
    const { container } = render(<InsightsDashboard />)
    expect(container.textContent).not.toMatch(/\$/)
  })

  it('leaves the empty placeholder out and says so', () => {
    render(<InsightsDashboard />)
    expect(screen.getByText(/Left out everywhere: 1 empty rerun placeholder and 2 demo or test-account surveys\./)).toBeInTheDocument()
  })

  it('a clicked tile lists exactly its surveys, each a real link', () => {
    render(<InsightsDashboard />)
    fireEvent.click(screen.getByRole('button', { name: '12' }))
    const panel = screen.getByRole('dialog', { name: 'Surveys delivered' })
    expect(within(panel).getByText(/12 surveys listed — the same as the 12 in the tile ✓/)).toBeInTheDocument()
    const links = within(panel).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/projects/'))
    expect(links).toHaveLength(12)
  })

  it('a clicked month column lists that month\'s surveys', () => {
    render(<InsightsDashboard />)
    // The stacked monthly chart is the first chart on the page.
    fireEvent.click(screen.getAllByRole('button', { name: /^Aug/ })[0])
    const panel = screen.getByRole('dialog', { name: 'Delivered · August 2026' })
    expect(within(panel).getByText(/11 surveys listed — the same as the 11 on the chart ✓/)).toBeInTheDocument()
    // …with a real link that filters the whole page to that month.
    expect(within(panel).getByRole('link', { name: 'Filter the page to 1–31 Aug 2026' }))
      .toHaveAttribute('href', '/insights?range=custom&from=2026-08-01&to=2026-08-31')
  })

  it('reads the filter from the URL', () => {
    qs = 'range=last-month'
    render(<InsightsDashboard />)
    // A past month reads in the past tense, and August has no earlier month to
    // rank against or compare with, so the sentence claims nothing more.
    expect(screen.getByText(/^The team delivered 11 surveys in August\./)).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('a failed survey read is Blocked, never zero', () => {
    raw = { ...fixture(), projects: [], blocked: [{ table: 'survey_projects', message: 'permission denied' }] }
    render(<InsightsDashboard />)
    expect(screen.getByRole('alert')).toHaveTextContent('Blocked: survey_projects did not load (permission denied)')
    expect(screen.queryByText(/Surveys delivered/)).not.toBeInTheDocument()
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
    expect(within(panel).getByText(/1 survey listed — the same as the 1 in the tile ✓/)).toBeInTheDocument()
    expect(within(panel).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/projects/'))).toHaveLength(1)
  })

  it('a failed child table is named, and the page still draws', () => {
    raw = { ...fixture(), rowCounts: null, blocked: [{ table: 'project_costs', message: 'timeout' }] }
    render(<InsightsDashboard />)
    expect(screen.getByText(/Blocked: project_costs did not load \(timeout\)/)).toBeInTheDocument()
    expect(screen.getByText('Surveys delivered')).toBeInTheDocument()
  })
})

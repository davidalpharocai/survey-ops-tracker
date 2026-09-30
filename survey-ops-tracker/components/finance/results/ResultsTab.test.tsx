import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { FinanceExport, FinanceTabProps, DrillOpts } from '../tabs/types'
import { reconcile, type DrillSpec } from '@/lib/finance/drill'
import { DEFAULT_FILTER, describe as describeFilter, serializeFilter, type FinanceFilter } from '@/lib/finance/filters'
import { resultsInputOf } from '@/lib/finance/results'
import type { FinanceLoad } from '@/lib/finance/load'
import { fixtureLoad, TODAY } from '@/lib/finance/results.fixture'

let qs = 'tab=results'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(qs),
  usePathname: () => '/finance',
}))

import { ResultsTab } from '../tabs/ResultsTab'

function props(load: FinanceLoad = fixtureLoad(), filter: FinanceFilter = DEFAULT_FILTER) {
  const input = resultsInputOf(load, filter, TODAY)
  const openDrill = vi.fn<(spec: DrillSpec, opts?: DrillOpts) => void>()
  const registerExport = vi.fn<(x: FinanceExport | null) => void>()
  const p: FinanceTabProps = {
    tab: 'results',
    load,
    ix: input.ix,
    items: input.items,
    population: input.population,
    side: [],
    filter,
    today: TODAY,
    scope: describeFilter(filter, { tab: 'results', today: TODAY, count: input.population.length }),
    accountName: id => (id === 'coa' ? 'Coatue' : '(unknown account)'),
    openDrill,
    hrefFor: ({ tab, ...patch }) => {
      const q = serializeFilter({ ...filter, ...patch })
      q.set('tab', tab ?? 'results')
      return `/finance?${q.toString()}`
    },
    registerExport,
  }
  return { p, openDrill, registerExport }
}

beforeEach(() => { qs = 'tab=results' })

describe('ResultsTab', () => {
  it('shows the four Tile 1 figures from the model and registers the margin-set rows once', () => {
    const { p, registerExport } = props()
    const { rerender } = render(<ResultsTab {...p} />)
    expect(screen.getByText('$86,540')).toBeInTheDocument()
    expect(screen.getByText('$46,021')).toBeInTheDocument()
    expect(screen.getByText('$40,519 · 47%')).toBeInTheDocument()
    expect(screen.getByText('56¢ per $1')).toBeInTheDocument()
    expect(registerExport).toHaveBeenCalledTimes(1)
    const exp = registerExport.mock.calls[0][0]!
    expect(exp.name).toBe('finance-results-surveys')
    expect(exp.rows).toHaveLength(31)
    // A parent re-render that changes no figure does not register again.
    rerender(<ResultsTab {...p} scope={{ ...p.scope }} />)
    expect(registerExport).toHaveBeenCalledTimes(1)
  })

  it('opens a drill that reconciles when a figure is clicked', () => {
    const { p, openDrill } = props()
    render(<ResultsTab {...p} />)
    fireEvent.click(screen.getByTitle('Show the 31 studies behind the client price'))
    const spec = openDrill.mock.calls[0][0]
    expect(spec.key).toBe('results-price')
    expect(reconcile(spec).ok).toBe(true)
  })

  it('opens the spend waterfall in place from the coverage line', () => {
    const { p } = props()
    render(<ResultsTab {...p} />)
    const spend = screen.getByRole('button', { name: '$50,371' })
    expect(spend).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(spend)
    expect(spend).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Where the delivered spend went')).toBeInTheDocument()
    expect(screen.getByText(/at \$0\.02 a message/)).toBeInTheDocument()
  })

  it('links to Improve and to every survey it names with real hrefs', () => {
    const { p } = props()
    render(<ResultsTab {...p} />)
    const improve = screen.getByRole('link', { name: 'price it from the Improve tab' })
    expect(improve.getAttribute('href')).toBe('/finance?tab=improve')
    expect(screen.getByRole('link', { name: 'LOSS' }).getAttribute('href')).toBe('/projects/loss')
  })

  it('offers "Filter the page to <month>" on a month drill', () => {
    const { p, openDrill } = props()
    render(<ResultsTab {...p} />)
    // The chart's table twin carries the same drill as the marks.
    fireEvent.click(screen.getAllByRole('button', { name: /View as table/i })[0])
    const table = screen.getAllByRole('table')[0]
    fireEvent.click(within(table).getByRole('button', { name: /Aug/ }))
    const [spec, opts] = openDrill.mock.calls[0]
    expect(spec.key).toBe('results-month-2026-08')
    expect(reconcile(spec).ok).toBe(true)
    expect(opts?.filter?.label).toBe('Filter the page to Aug 2026')
    expect(opts?.filter?.href).toBe('/finance?range=custom&from=2026-08-01&to=2026-08-31&tab=results')
  })

  it('groups by account by default, with the other groupings as real links', () => {
    const { p } = props()
    render(<ResultsTab {...p} />)
    expect(screen.getByText('Where it was made and lost · by account')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: /Group Where it was made and lost by/ })
    expect(within(nav).getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Route' }).getAttribute('href')).toBe('/finance?tab=results&by=route')
    expect(screen.getAllByText('too few to judge').length).toBeGreaterThan(0)
  })

  it('shows the three-way ledger with its tags for by=survey', () => {
    qs = 'tab=results&by=survey'
    const { p } = props()
    render(<ResultsTab {...p} />)
    expect(screen.getAllByText('LOST MONEY').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GIVEN AWAY $0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('NO PRICE').length).toBeGreaterThan(0)
  })

  it('hands by=panel to the panel supplier view, keeping the picker', () => {
    qs = 'tab=results&by=panel'
    const { p } = props()
    render(<ResultsTab {...p} />)
    const nav = screen.getByRole('navigation', { name: /Group Where it was made and lost by/ })
    expect(within(nav).getByRole('link', { name: 'Panel supplier' })).toHaveAttribute('aria-current', 'page')
    // The panel view draws its own card; the Results group table is not drawn.
    expect(screen.getByText('Where it was made and lost · by panel supplier')).toBeInTheDocument()
    expect(screen.queryByText('Where it was made and lost · by account')).not.toBeInTheDocument()
  })

  it('shows "missing, not zero" when a finance reader gets no prices back', () => {
    const { p } = props(fixtureLoad({ prices: false }))
    render(<ResultsTab {...p} />)
    expect(screen.getAllByText(/Blocked: project_financials returned no prices\. These figures are missing, not zero\./).length).toBeGreaterThan(0)
    expect(screen.queryByText('$86,540')).not.toBeInTheDocument()
  })

  it('names a failed table on the card instead of drawing a figure', () => {
    const { p } = props(fixtureLoad({ blocked: ['project_costs'] }))
    render(<ResultsTab {...p} />)
    expect(screen.getAllByText(/Blocked: project_costs did not load/).length).toBeGreaterThan(0)
    expect(screen.queryByText('$46,021')).not.toBeInTheDocument()
  })
})

import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { AppRouterContext, type AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { FinanceLoad, FinanceTable } from '@/lib/finance/load'
import type { FinProject } from '@/lib/finance/hub'
import { FinanceAccessProvider } from './FinanceAccess'

/**
 * The finance shell, end to end, with the four tabs replaced by stubs (they
 * are built and tested by their own slices). What this pins: the page only
 * renders inside the server gate; old bookmarks are rewritten; the header,
 * banner and integrity line are computed from the load; the date control is
 * disabled on This week; "Export what you see" writes exactly the rows the
 * tab registered, under the header block, and then says whether it was logged;
 * a failed load offers Retry and blames no one.
 */

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => '/finance',
}))

const data = vi.hoisted(() => ({ value: null as unknown, calls: 0 }))
vi.mock('@/lib/finance/useFinanceData', () => ({
  FINANCE_QUERY_KEY: ['finance-hub-v6'],
  useFinanceData: () => { data.calls++; return data.value },
}))

const dl = vi.hoisted(() => ({ files: [] as { text: string; name: string }[] }))
vi.mock('@/lib/utils/exportCsv', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/utils/exportCsv')>()),
  downloadCsv: (text: string, name: string) => { dl.files.push({ text, name }) },
}))

// Each stub registers its population as the rows behind its main tile, the
// way the contract (components/finance/tabs/types.ts) asks a tab to. Hoisted,
// because vi.mock runs before anything else in this file.
const { stub } = vi.hoisted(() => ({ stub: (label: string) => async () => {
  const React = await import('react')
  type Props = import('@/components/finance/tabs/types').FinanceTabProps
  return {
    [label]: (p: Props) => {
      React.useEffect(() => {
        p.registerExport({
          name: `finance-${p.tab}-surveys`,
          columns: [{ key: 'code', header: 'Survey' }, { key: 'name', header: 'Name' }],
          rows: p.population.map(i => ({ code: i.p.project_code, name: i.p.project_name })),
        })
        return () => p.registerExport(null)
      }, [p])
      return React.createElement('div', { 'data-testid': 'tab' },
        `${label}|${p.population.length}|${p.side.length}|${p.scope.chip}`)
    },
  }
} }))
vi.mock('@/components/finance/tabs/ResultsTab', stub('ResultsTab'))
vi.mock('@/components/finance/tabs/ThisWeekTab', stub('ThisWeekTab'))
vi.mock('@/components/finance/tabs/PerRespondentTab', stub('PerRespondentTab'))
vi.mock('@/components/finance/tabs/ImproveTab', stub('ImproveTab'))

import FinancePage from '@/app/(app)/finance/page'

const router = { push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }

let k = 0
const P = (o: Partial<FinProject>): FinProject => ({
  id: `p${++k}`, project_code: `PR${String(k).padStart(5, '0')}`, project_name: `Study ${k}`, client: 'BAM', client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: '2026-08-10', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 100, actual_spend: 100, ...o,
})

const TABLES: FinanceTable[] = [
  'survey_projects', 'project_blasts', 'project_suppliers', 'project_launches', 'project_costs',
  'project_financials', 'project_segments', 'clients', 'client_contacts', 'client_terms',
]

function makeLoad(o: { blocked?: FinanceLoad['blocked'] } = {}): FinanceLoad {
  k = 0
  const projects = [
    P({ deliver_date: '2026-06-10' }), P({ deliver_date: '2026-06-11' }), P({ deliver_date: '2026-06-12' }),
    P({ deliver_date: '2026-07-10' }), P({ deliver_date: '2026-07-11' }), P({ deliver_date: '2026-07-12', client_id: 'coa', client: 'Coatue' }),
    P({ board_column: 'Fielding', deliver_date: '2026-10-20', actual_spend: 0 }),
    P({ board_column: 'Fielding', status: 'Hold', deliver_date: null, actual_spend: 0 }),
    // Delivered before the default window: its account counts 0 under the
    // default range, so its option is greyed, not removed.
    P({ deliver_date: '2026-03-05', client_id: 'zed', client: 'Zed Capital', actual_spend: 0 }),
  ]
  const blasts = projects.filter(p => p.board_column === 'Delivery' && p.client_id !== 'zed')
    .map((p, i) => ({ id: `b${i}`, project_id: p.id, bid: 100, completes: 1, people: 0, cost_per_send: 0, channel: 'email', blast_at: '2026-06-01T21:30:00Z', created_at: '2026-09-15T12:00:00Z' }))
  const rates = new Map([[projects[0].id, 10], [projects[3].id, 10]])
  const counts = Object.fromEntries(TABLES.map(t => [t, 0])) as Record<FinanceTable, number>
  counts.survey_projects = projects.length
  counts.project_blasts = blasts.length
  counts.project_financials = rates.size
  return {
    raw: {
      projects, blasts, suppliers: [], launches: [], costs: [],
      financials: [...rates].map(([project_id, price_per_n]) => ({ project_id, price_per_n })),
      rates, segments: [],
      accounts: [{ id: 'bam', name: 'BAM' }, { id: 'coa', name: 'Coatue' }, { id: 'zed', name: 'Zed Capital' }],
      contacts: [], terms: [],
    },
    blocked: o.blocked ?? [],
    integrity: {
      loadedCounts: counts,
      expectedCounts: { ...counts },
      countMismatches: [],
      spendRecomputedMatches: { matches: projects.length, of: projects.length, mismatchIds: [] },
      pricesReturned: rates.size,
      demoDropped: 0,
      loadedAt: '2026-09-27T22:40:00Z',
    },
  }
}

const ok = (load: FinanceLoad | null, extra: Record<string, unknown> = {}) => ({
  load, isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(), ...extra,
})

function renderPage(verified = true) {
  return render(
    <AppRouterContext.Provider value={router as unknown as AppRouterInstance}>
      <FinanceAccessProvider verified={verified}>
        <FinancePage />
      </FinanceAccessProvider>
    </AppRouterContext.Provider>,
  )
}

beforeEach(() => {
  nav.query = ''
  nav.replace.mockClear()
  data.calls = 0
  data.value = ok(makeLoad())
  dl.files = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the gate, as the page sees it', () => {
  it('renders the limited-access page, and never loads the book, outside the server gate', () => {
    renderPage(false)
    expect(screen.getByText('Finance is limited to the finance team: David, Shanu and Vineet.')).toBeInTheDocument()
    expect(data.calls).toBe(0)
    expect(screen.queryByTestId('tab')).toBeNull()
  })
})

describe('the chrome', () => {
  it('computes the header, marks the current tab, and hands the tab its population', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument()
    expect(screen.getByText('6 delivered studies · From 1 Jun 2026')).toBeInTheDocument()
    const tabs = within(screen.getByRole('navigation', { name: 'Finance sections' })).getAllByRole('link')
    expect(tabs.map(t => t.textContent)).toEqual(['Results', 'This week', 'Per respondent', 'Improve'])
    expect(tabs[0]).toHaveAttribute('aria-current', 'page')
    expect(tabs[0]).toHaveAttribute('href', '/finance')
    expect(tabs[1]).toHaveAttribute('href', '/finance?tab=this-week')
    expect(tabs[1]).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('tab')).toHaveTextContent('ResultsTab|6|0|Delivered · From 1 Jun 2026 · 6 studies')
  })

  it('computes the banner and the integrity line from the load', () => {
    renderPage()
    const banner = screen.getByRole('region', { name: 'How complete the finance data is' })
    expect(banner).toHaveTextContent('Costs are reliable from Jun 2026.')
    expect(banner).toHaveTextContent('In this view 6 of 6 delivered studies (100%) carry a recorded cost, and 2 carry a client price.')
    // June and July each have 1 of 3 priced, over the 25% bar, so there is no
    // "still thin" line — but the link to Improve is always offered.
    expect(within(banner).getByRole('link', { name: /Improve tab/ })).toHaveAttribute('href', '/finance?tab=improve')
    expect(screen.getByText(/^Loaded 9 studies · 6 blasts · 0 panel rows · 0 cost lines · 2 prices · recomputed spend = stored on 9 of 9/)).toBeInTheDocument()
  })

  it('turns the integrity line red and names the table when a read failed', () => {
    data.value = ok(makeLoad({ blocked: [{ table: 'client_contacts', message: 'permission denied' }] }))
    renderPage()
    const alerts = screen.getAllByRole('alert')
    expect(alerts.some(a => a.textContent?.includes('Blocked: client_contacts did not load (permission denied).'))).toBe(true)
  })

  it('opens the glossary drawer from "How to read this"', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'How to read this' }))
    const dialog = screen.getByRole('dialog', { name: 'How to read this page' })
    expect(within(dialog).getAllByRole('term')).toHaveLength(10)
  })
})

describe('the filter bar', () => {
  it('counts each account under the other filters, greys an empty one, and writes the URL', () => {
    renderPage()
    const account = screen.getByLabelText('Account') as HTMLSelectElement
    const opts = [...account.options].map(o => [o.textContent, o.disabled])
    expect(opts).toEqual([['All accounts', false], ['BAM (5)', false], ['Coatue (1)', false], ['Zed Capital (0)', true]])
    fireEvent.change(account, { target: { value: 'coa' } })
    expect(nav.replace).toHaveBeenCalledWith('/finance?account=coa', { scroll: false })
  })

  it('computes the Date (i) reliability sentence from the same month as the banner', () => {
    // David's decision 8: the reliability line is COMPUTED so his backfill
    // moves it by itself. It used to be typed into the preset's help text, one
    // line above a banner that computed it — two sentences on one screen that
    // would contradict each other the moment the computed month stopped being
    // June. There is now one claim, in two places, from one number.
    const helpOf = () => screen.getByLabelText(/Filters by delivery date/).getAttribute('aria-label') ?? ''
    const { unmount } = renderPage()
    expect(helpOf()).toContain('Costs are recorded on most delivered studies from Jun 2026.')
    expect(screen.getByRole('region', { name: 'How complete the finance data is' }))
      .toHaveTextContent('Costs are reliable from Jun 2026.')
    expect(helpOf()).not.toMatch(/most reliable window/i)
    unmount()

    // Take the cost records away and the sentence follows, rather than going on
    // asserting June.
    const load = makeLoad()
    load.raw.blasts = []
    data.value = ok(load)
    renderPage()
    expect(helpOf()).toContain('No month yet has a recorded cost on most of its delivered studies.')
    expect(helpOf()).not.toContain('Jun 2026')
  })

  it('disables the date on This week and says so', () => {
    nav.query = 'tab=this-week'
    renderPage()
    const date = screen.getByLabelText('Date') as HTMLSelectElement
    expect(date).toBeDisabled()
    expect(date.options[0].textContent).toBe('Live work — all dates')
    expect(screen.getByText('1 live study · 1 on hold · Live work — all dates')).toBeInTheDocument()
    expect(screen.getByTestId('tab')).toHaveTextContent('ThisWeekTab|1|1|')
  })

  it('offers removable chips and Clear as real links once a filter is set', () => {
    nav.query = 'route=blast&account=bam'
    renderPage()
    expect(screen.getByRole('link', { name: 'Remove the account filter (BAM)' })).toHaveAttribute('href', '/finance?route=blast')
    expect(screen.getByRole('link', { name: 'Remove the route filter (Blast only)' })).toHaveAttribute('href', '/finance?account=bam')
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/finance')
  })
})

describe('old bookmarks', () => {
  it('rewrites a legacy tab and the old keys once, to the canonical address', () => {
    nav.query = 'tab=book&lifecycle=all&type=PS'
    renderPage()
    expect(nav.replace).toHaveBeenCalledWith('/finance', { scroll: false })
    expect(screen.getByTestId('tab')).toHaveTextContent('ResultsTab')
  })

  it('lands ?tab=now on This week and ?tab=save on Per respondent', () => {
    nav.query = 'tab=now'
    const { unmount } = renderPage()
    expect(screen.getByTestId('tab')).toHaveTextContent('ThisWeekTab')
    expect(nav.replace).toHaveBeenCalledWith('/finance?tab=this-week', { scroll: false })
    unmount()
    nav.query = 'tab=save'
    renderPage()
    expect(screen.getByTestId('tab')).toHaveTextContent('PerRespondentTab')
  })
})

describe('Export what you see', () => {
  it('writes exactly the registered rows under the header block, then says it was logged', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: '9a8b7c6d-0000-0000-0000-000000000000' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()
    const button = screen.getByRole('button', { name: /Export what you see/ })
    expect(button).toHaveTextContent('(6)')
    await user.click(button)
    expect(dl.files).toHaveLength(1)
    const lines = dl.files[0].text.split('\r\n')
    expect(lines[0]).toBe('SOCC finance export')
    // Quoted: the line carries a comma.
    expect(lines).toContain('"As of: 27 Sep 2026, 6:40 PM Eastern"')
    expect(lines).toContain('Tab: Results')
    expect(lines).toContain('Rows: 6')
    expect(lines).toContain('Studies in view: 6')
    expect(lines).toContain('Scoping work: not included')
    const at = lines.indexOf('Survey,Name')
    expect(lines.slice(at + 1)).toEqual(['PR00001,Study 1', 'PR00002,Study 2', 'PR00003,Study 3', 'PR00004,Study 4', 'PR00005,Study 5', 'PR00006,Study 6'])
    expect(dl.files[0].name).toMatch(/^socc-finance-results-surveys-\d{4}-\d{2}-\d{2}\.csv$/)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toMatchObject({ route: 'finance-results', rowCount: 6, includedRestricted: true })
    expect(body.filters).toMatchObject({ tab: 'results', range: 'since-jun-1', scoping_included: false, export: 'finance-results-surveys' })
    expect(await screen.findByText('Logged as export #9a8b7c6d')).toBeInTheDocument()
  })

  it('downloads even when the log fails, and says the export was not logged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /Export what you see/ }))
    expect(dl.files).toHaveLength(1)
    expect(await screen.findByText(/^Export not logged: the request did not reach the server/)).toBeInTheDocument()
  })
})

describe('a failed load', () => {
  it('offers Retry and a neutral line — it never tells the reader to go and find someone', async () => {
    const refetch = vi.fn()
    data.value = ok(null, { isError: true, refetch })
    const user = userEvent.setup()
    renderPage()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The finance data did not load.')
    expect(alert.textContent).not.toMatch(/David|tell /i)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows a blocked survey table as missing, not zero, with Retry', () => {
    data.value = ok(makeLoad({ blocked: [{ table: 'survey_projects', message: 'timeout' }] }))
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Blocked: survey_projects did not load. Nothing on this page can be computed without it, so every figure is missing, not zero.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('tab')).toBeNull()
  })

  it('shows the skeleton while the first load is in flight', () => {
    data.value = ok(null, { isLoading: true })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading the finance data…')
  })
})

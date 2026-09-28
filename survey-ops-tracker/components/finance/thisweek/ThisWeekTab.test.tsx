import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThisWeekTab } from '@/components/finance/tabs/ThisWeekTab'
import type { FinanceTabProps } from '@/components/finance/tabs/types'
import { buildIndex, type FinBlast } from '@/lib/finance/hub'
import { DEFAULT_FILTER, describe as describeFilter, itemsOf, populationFor, sideBucketFor } from '@/lib/finance/filters'
import type { Blocked, FinanceLoad } from '@/lib/finance/load'
import type { Extra, HoldSince, SeriesRecord, WeekProject } from '@/lib/finance/thisWeek'

// The extra reads are mocked with STABLE objects (a new object per render
// would rebuild the model every render, which is exactly the loop the tab's
// memoisation exists to prevent).
const HOLDS: Extra<Map<string, HoldSince>> = { state: 'ok', value: new Map() }
const SERIES: Extra<SeriesRecord[]> = { state: 'ok', value: [] }
const DOLLARS: Extra<Map<string, number | null>> = { state: 'ok', value: new Map() }
const OWNERS: Extra<Map<string, string>> = { state: 'ok', value: new Map([['cap1', 'Jenna']]) }
vi.mock('./useThisWeekExtras', () => ({
  useHoldSince: () => HOLDS,
  useSeriesRecords: () => SERIES,
  useTermDollars: () => DOLLARS,
  useOwners: () => OWNERS,
}))

// A fake Supabase client for the "Add as next step" write.
const inserted: { table: string; row: unknown }[] = []
let insertResult: { data: unknown[] | null; error: { message: string } | null } = { data: [{ id: 'new' }], error: null }
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { email: 'david@alpharoc.ai' } } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        insert: (row: unknown) => {
          inserted.push({ table, row })
          return { select: () => Promise.resolve(insertResult) }
        },
      }
      return chain
    },
  }),
}))

const TODAY = '2026-09-28'
const P = (o: Partial<WeekProject>): WeekProject => ({
  id: 'p', project_code: 'PR0', project_name: 'S', client: 'BAM', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Fielding', status: 'Open', phase: 'Active',
  deliver_date: '2026-10-15', launch_date: null, submitted_date: null,
  n_target: null, n_collected: 0, n_actual: null, captain_id: 'cap1', ...o,
})
const B = (project_id: string, dollars: number): FinBlast & { id: string } =>
  ({ id: `b-${project_id}`, project_id, bid: 1, completes: dollars, people: 0, cost_per_send: 0, channel: 'email' })

function props(registerExport = vi.fn(), openDrill = vi.fn(), blocked: Blocked[] = []): FinanceTabProps {
  const projects: WeekProject[] = [
    P({ id: 'a', project_code: 'PR00448', n_target: 100, budget: 300 }),
    ...Array.from({ length: 7 }, (_, i) => P({ id: `u${i}`, project_code: `PR0050${i}` })),
    P({ id: 'h', project_code: 'PR00450', status: 'Hold' }),
    P({ id: 'd', project_code: 'PR00300', client_id: 'acc2', board_column: 'Delivery', status: 'Closed', term_id: 'T', credits: 12, deliver_date: '2026-08-01' }),
  ]
  const blasts = [B('a', 880), ...Array.from({ length: 7 }, (_, i) => B(`u${i}`, 10 + i)), B('h', 20)]
  const rates = new Map([['a', 10]])
  const terms = [{ id: 'T', client_id: 'acc2', name: '2026 Contract', credits_total: 10, starts_on: '2026-03-30', renews_on: '2027-03-29' }]
  const ix = buildIndex(blasts, [], [])
  const items = itemsOf(projects, blasts, [], [], ix)
  const population = populationFor(items, 'this-week', DEFAULT_FILTER, TODAY)
  const side = sideBucketFor(items, 'this-week', DEFAULT_FILTER, TODAY)
  const load = {
    raw: {
      projects, blasts, suppliers: [], launches: [], costs: [], financials: [], rates, segments: [],
      accounts: [], contacts: [], terms,
    },
    blocked,
    integrity: {
      loadedCounts: {}, expectedCounts: {}, countMismatches: [],
      spendRecomputedMatches: { matches: 0, of: 0, mismatchIds: [] },
      pricesReturned: rates.size, demoDropped: 0, loadedAt: '2026-09-28T12:00:00Z',
    },
  } as unknown as FinanceLoad
  return {
    tab: 'this-week', load, ix, items, population, side, filter: DEFAULT_FILTER, today: TODAY,
    scope: describeFilter(DEFAULT_FILTER, { tab: 'this-week', today: TODAY, count: population.length }),
    accountName: id => (id === 'acc1' ? 'BAM' : id === 'acc2' ? 'DE Shaw' : '(unknown account)'),
    openDrill, hrefFor: () => '/finance', registerExport,
  }
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
}

const sectionOf = (label: string) => screen.getAllByText(label)[0].closest('section') as HTMLElement

beforeEach(() => {
  inserted.length = 0
  insertResult = { data: [{ id: 'new' }], error: null }
})

describe('ThisWeekTab', () => {
  it('renders the three cards, the verbs and real survey links, and registers the export once', () => {
    const registerExport = vi.fn()
    render(wrap(<ThisWeekTab {...props(registerExport)} />))
    expect(screen.getByText('Decisions this week')).toBeInTheDocument()
    expect(screen.getByText('On hold — its own bucket')).toBeInTheDocument()
    expect(screen.getByText('Credit pools')).toBeInTheDocument()
    expect(screen.getByText(/8 live surveys · \$971 spent so far/)).toBeInTheDocument()

    const freeze = sectionOf('FREEZE THE BID')
    const link = within(freeze).getAllByRole('link', { name: 'PR00448' })[0]
    expect(link).toHaveAttribute('href', '/projects/a')
    expect(within(sectionOf('RESUME OR CANCEL')).getAllByRole('link', { name: 'PR00450' })[0]).toHaveAttribute('href', '/projects/h')
    expect(sectionOf('TOP UP THE CONTRACT')).toBeTruthy()

    const calls = registerExport.mock.calls.filter(c => c[0])
    expect(calls).toHaveLength(1)
    const x = calls[0][0]
    expect(x.name).toBe('finance-this-week-decisions')
    expect(x.rows.some((r: Record<string, unknown>) => r.survey === 'PR00450' && r.bucket === 'On hold')).toBe(true)
  })

  it('collapses a group over five rows behind a real "Show all N"', () => {
    render(wrap(<ThisWeekTab {...props()} />))
    const price = sectionOf('PRICE IT')
    expect(within(price).getAllByText('Add as next step')).toHaveLength(5)
    fireEvent.click(within(price).getByRole('button', { name: 'Show all 7' }))
    expect(within(price).getAllByText('Add as next step')).toHaveLength(7)
    expect(within(price).getByRole('button', { name: 'Show the top 5' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens the header drills', () => {
    const openDrill = vi.fn()
    render(wrap(<ThisWeekTab {...props(vi.fn(), openDrill)} />))
    fireEvent.click(screen.getByTitle('Show the spend on each live survey'))
    expect(openDrill).toHaveBeenCalledWith(expect.objectContaining({ key: 'this-week-spent' }))
  })

  it('adds a next step only after confirming, with the project page’s write', async () => {
    render(wrap(<ThisWeekTab {...props()} />))
    const freeze = sectionOf('FREEZE THE BID')
    fireEvent.click(within(freeze).getByText('Add as next step'))
    expect(inserted).toHaveLength(0)
    const add = within(freeze).getByRole('button', { name: 'Add it' })
    await waitFor(() => expect(add).not.toBeDisabled())
    fireEvent.click(add)
    expect(await within(freeze).findByText(/Added to/)).toBeInTheDocument()
    expect(inserted).toEqual([{
      table: 'project_steps',
      row: { project_id: 'a', text: 'Freeze the bid: no higher reward and no new blast without sign-off.', created_by: 'david' },
    }])
  })

  it('puts the cost caveat on the hold card, whose figures are spend', () => {
    render(wrap(<ThisWeekTab {...props(vi.fn(), vi.fn(), [{ table: 'project_costs', message: 'boom' }])} />))
    const hold = sectionOf('On hold — its own bucket')
    expect(within(hold).getByText(/Floor only: project_costs did not load/)).toBeInTheDocument()
  })

  it('draws a verb tag’s label in the page ink, not in the chart token', () => {
    render(wrap(<ThisWeekTab {...props()} />))
    // The chart tokens are mark colours (3:1). An 11px label needs 4.5:1, so
    // the colour lives in the swatch, the tint and the border only.
    const tag = screen.getAllByText('RESUME OR CANCEL')[0]
    expect(tag.style.color).toBe('')
    expect(tag.className).toContain('text-foreground')
    expect(tag.style.background).not.toBe('')
  })

  it('reports a write that saved nothing (a silent RLS refusal) as a failure', async () => {
    insertResult = { data: [], error: null }
    render(wrap(<ThisWeekTab {...props()} />))
    const freeze = sectionOf('FREEZE THE BID')
    fireEvent.click(within(freeze).getByText('Add as next step'))
    const add = within(freeze).getByRole('button', { name: 'Add it' })
    await waitFor(() => expect(add).not.toBeDisabled())
    fireEvent.click(add)
    expect(await within(freeze).findByRole('alert')).toHaveTextContent(/Could not add it: .*saved nothing.*Nothing was saved/)
  })
})

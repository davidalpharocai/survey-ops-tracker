import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { FinanceExport, FinanceTabProps } from '../tabs/types'
import type { FinanceLoad } from '@/lib/finance/load'
import { buildIndex, type FinProject } from '@/lib/finance/hub'
import { DEFAULT_FILTER, type FinItem } from '@/lib/finance/filters'
import { SUPPLIER_COLUMNS, WAVE_COLUMNS } from './columns'

let qs = 'tab=results&by=panel'
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(qs),
  usePathname: () => '/finance',
}))

import { PanelSupplierView } from './PanelSupplierView'

const P = (id: string, o: Partial<FinProject> = {}): FinProject => ({
  id, project_code: id.toUpperCase(), project_name: null, client: null, client_id: 'acc', project_type: 'PS',
  board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
const projects = [P('pr1'), P('pr2')]
const suppliers = [
  { id: 's1', project_id: 'pr1', launch_id: 'l1', supplier_id: 'prime', cpi: 0.84, n_collected: 120, suppliers: { name: 'Prime Insights API' } },
  { id: 's2', project_id: 'pr1', launch_id: 'l1', supplier_id: 'social', cpi: 1.31, n_collected: 40, suppliers: { name: 'Social Loop' } },
  { id: 's3', project_id: 'pr2', launch_id: 'l2', supplier_id: 'social', cpi: 1.1, n_collected: 30, suppliers: { name: 'Social Loop' } },
]
const launches = [
  { id: 'l1', project_id: 'pr1', label: '52470052', launch_date: '2026-07-14', note: 'Tracker · United States · PureSpectrum Survey# 52470052 · 160 completes.', target: null },
  { id: 'l2', project_id: 'pr2', label: 'PS 50460796', launch_date: '2026-08-02', note: null, target: null },
]

function props(o: {
  blocked?: FinanceLoad['blocked']
  route?: FinanceTabProps['filter']['route']
  /** Extra purchases, for the case where one panel buys twice in one wave. */
  extra?: typeof suppliers
} = {}) {
  const rows = o.extra ? [...suppliers, ...o.extra] : suppliers
  const load = {
    raw: {
      projects, blasts: [], suppliers: rows, launches, costs: [], financials: [], rates: new Map(), segments: [],
      accounts: [], contacts: [], terms: [],
    },
    blocked: o.blocked ?? [],
    integrity: {} as FinanceLoad['integrity'],
  } as unknown as FinanceLoad
  const items: FinItem[] = projects.map(p => ({ p, cls: 'delivered', route: 'panel', date: p.deliver_date }))
  const registerExport = vi.fn<(x: FinanceExport | null) => void>()
  const p: FinanceTabProps = {
    tab: 'results',
    load,
    ix: buildIndex([], rows, []),
    items,
    population: items,
    side: [],
    filter: { ...DEFAULT_FILTER, route: o.route ?? DEFAULT_FILTER.route },
    today: '2026-09-28',
    scope: { chip: 'Delivered · From 1 Jun 2026 · 2 surveys', ignored: [], header: [], audit: {} as never },
    accountName: () => 'Acc',
    openDrill: vi.fn(),
    hrefFor: ({ tab }) => `/finance?tab=${tab ?? 'results'}`,
    registerExport,
  }
  return { ...p, registerExport }
}

beforeEach(() => { qs = 'tab=results&by=panel'; push.mockReset() })

describe('PanelSupplierView', () => {
  it('lists panels as real links that keep the page state, with a green check and an (i) on every header', () => {
    const p = props()
    const { container } = render(<PanelSupplierView {...p} />)
    const table = container.querySelector('table')!
    const link = within(table).getByRole('link', { name: 'Social Loop' })
    expect(link.getAttribute('href')).toBe('/finance?tab=results&by=panel&supplier=social#panel-supplier-detail')
    expect(screen.getByText(/The 2 panels below add up to \$186 — the same purchases the Panel \(PureSpectrum\) line of the spend breakdown counts/)).toBeInTheDocument()
    for (const w of Object.values(SUPPLIER_COLUMNS)) {
      expect(within(table).getByLabelText(w.help)).toBeInTheDocument()
    }
    // The Improve link is a real href, and it lands on the blocked-data card
    // rather than the top of a long tab.
    expect(screen.getByRole('link', { name: /what would unlock per-panel cost per qualified respondent/ }).getAttribute('href'))
      .toBe('/finance?tab=improve#blocked-data')
    // The Results tab owns the export; this view must not replace it.
    expect(p.registerExport).not.toHaveBeenCalled()
  })

  it('opens the picked panel in place: waves, survey links to the project page, country as recorded', () => {
    qs = 'tab=results&by=panel&supplier=social'
    const { container } = render(<PanelSupplierView {...props()} />)
    const detail = container.querySelector('#panel-supplier-detail') as HTMLElement
    expect(detail).not.toBeNull()
    expect(within(detail).getByText('Social Loop: its waves')).toBeInTheDocument()
    const table = detail.querySelector('table')!
    expect(within(table).getByRole('link', { name: 'PR1' }).getAttribute('href')).toBe('/projects/pr1')
    expect(within(table).getByText('United States')).toBeInTheDocument()
    expect(within(table).getByText('not recorded')).toBeInTheDocument()
    expect(within(table).getByText('PS 50460796')).toBeInTheDocument()
    expect(within(table).getByText('only panel')).toBeInTheDocument()
    for (const w of Object.values(WAVE_COLUMNS)) {
      expect(within(table).getByLabelText(w.help)).toBeInTheDocument()
    }
    // Close is a real link back to the table.
    expect(within(detail).getByRole('link', { name: 'Close' }).getAttribute('href')).toBe('/finance?tab=results&by=panel#panel-suppliers')
    expect(within(detail).getByText(/^Social Loop was paid \$19 above the cheapest panel on 1 of its 2 waves/)).toBeInTheDocument()
    // One purchase per wave here, so the footer counts waves and nothing else.
    expect(within(table).getByText('All 2 waves')).toBeInTheDocument()
  })

  it('counts the drilldown rows as purchases when a panel bought twice in one wave', () => {
    qs = 'tab=results&by=panel&supplier=social'
    const twice = [{ id: 's4', project_id: 'pr1', launch_id: 'l1', supplier_id: 'social', cpi: 1.4, n_collected: 10, suppliers: { name: 'Social Loop' } }]
    const { container } = render(<PanelSupplierView {...props({ extra: twice })} />)
    const detail = container.querySelector('#panel-supplier-detail') as HTMLElement
    const table = detail.querySelector('table')!
    // Still 2 waves, now 3 rows: the footer must not call the rows waves.
    expect(within(table).getByText('All 2 waves (3 purchases)')).toBeInTheDocument()
    expect(within(detail).getByText(/across its 2 waves|on 2 of its 2 waves|of its 2 waves/)).toBeInTheDocument()
  })

  it('names a picked panel that bought nothing in this view instead of drawing an empty detail', () => {
    qs = 'by=panel&supplier=ghost'
    render(<PanelSupplierView {...props()} />)
    expect(screen.getByText(/That panel delivered no completes on the studies in this view/)).toBeInTheDocument()
  })

  it('shows Blocked, not $0, when the supplier rows did not load', () => {
    render(<PanelSupplierView {...props({ blocked: [{ table: 'project_suppliers', message: 'timeout' }] })} />)
    expect(screen.getByText(/Blocked: project_suppliers did not load/)).toBeInTheDocument()
    expect(screen.queryByText(/add up to/)).toBeNull()
  })

  // A route filter decides which surveys are in view, and a survey's route is
  // read from its blast rows as well as its panel rows. With project_blasts
  // unread, "Panel" quietly takes in surveys fielded both ways and overstates,
  // and "Both" shows nothing at all — a failed read dressed up as "none".
  const blastsDown: FinanceLoad['blocked'] = [{ table: 'project_blasts', message: 'timeout' }]

  it('blocks on the blast rows when a route is picked, because the route decides who is in view', () => {
    render(<PanelSupplierView {...props({ blocked: blastsDown, route: 'panel' })} />)
    expect(screen.getAllByText(/Blocked: project_blasts did not load/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/add up to/)).toBeNull()
  })

  it('blocks the drilldown on the same rows, not only the table', () => {
    qs = 'tab=results&by=panel&supplier=social&route=both'
    const { container } = render(<PanelSupplierView {...props({ blocked: blastsDown, route: 'both' })} />)
    const detail = container.querySelector('#panel-supplier-detail') as HTMLElement
    expect(within(detail).getByText(/Blocked: project_blasts did not load/)).toBeInTheDocument()
  })

  it('still draws the figures when no route is picked, and says the outside check could not run', () => {
    render(<PanelSupplierView {...props({ blocked: blastsDown })} />)
    expect(screen.getByText(/add up to \$186/)).toBeInTheDocument()
    expect(screen.queryByText(/Blocked: project_blasts did not load/)).toBeNull()
    // The panel money is still right, but which surveys bought only from panels
    // is not known, so the strip says so instead of claiming a check it skipped.
    expect(screen.getByText(/The blast rows did not load, so which studies bought from panels alone is not known/)).toBeInTheDocument()
  })
})

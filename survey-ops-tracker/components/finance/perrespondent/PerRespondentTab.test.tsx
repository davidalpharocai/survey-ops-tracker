import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { DrillOpts, FinanceExport, FinanceTabProps } from '../tabs/types'
import { reconcile, type DrillSpec } from '@/lib/finance/drill'
import { buildIndex, type FinProject } from '@/lib/finance/hub'
import {
  DEFAULT_FILTER, describe as describeFilter, itemsOf, populationFor, serializeFilter,
} from '@/lib/finance/filters'
import type { FinanceLoad } from '@/lib/finance/load'
import type { FinBlastDated, FinSupplierRow } from '@/lib/finance/savings'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams('tab=per-respondent'),
  usePathname: () => '/finance',
}))

import { PerRespondentTab } from '../tabs/PerRespondentTab'

const TODAY = '2026-09-28'

const P = (id: string, o: Partial<FinProject> = {}): FinProject => ({
  id, project_code: id.toUpperCase(), project_name: null, client: null, client_id: 'acc-a',
  project_type: 'PS', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-07-15', launch_date: null, submitted_date: null,
  n_target: 80, n_collected: 100, n_actual: 80, ...o,
})

// Nine panel surveys (enough to call a floor), three blast surveys (too few),
// one over-delivered repeat survey, and a survey fielded both ways with no split.
const panel = Array.from({ length: 9 }, (_, i) => P(`p${i}`, { n_actual: 70 + i, deliver_date: `2026-07-${10 + i}` }))
const blast = [0, 1, 2].map(i => P(`b${i}`, { project_type: 'B2B', n_collected: 10, n_actual: 8, n_target: 8 }))
const mixed = P('m1', { project_type: 'B2B', n_collected: 120, n_actual: 100, n_target: 100 })
const first = P('first', { deliver_date: '2026-01-02' })
const projects = [...panel, ...blast, mixed, first]
const suppliers: FinSupplierRow[] = [
  ...panel.map(p => ({ project_id: p.id, cpi: 1, n_collected: 100, launch_id: `w-${p.id}`, supplier_id: 'prime' })),
  { project_id: 'm1', cpi: 1, n_collected: 100, launch_id: 'w-m1', supplier_id: 'prime' },
  { project_id: 'first', cpi: 1, n_collected: 100, launch_id: 'w-first', supplier_id: 'prime' },
]
const blasts: FinBlastDated[] = [
  ...blast.map(p => ({ project_id: p.id, bid: 50, completes: 10, people: 1000, cost_per_send: 0.02, channel: 'sms', blast_at: '2026-07-01' })),
  { project_id: 'm1', bid: 50, completes: 20, people: 1000, cost_per_send: 0.02, channel: 'sms', blast_at: '2026-07-01' },
]
const rates = new Map<string, number>([['p0', 1.5], ['p1', 9], ['p2', 0]])

function loadOf(blocked: FinanceLoad['blocked'] = [], pricesReturned = 3): FinanceLoad {
  return {
    raw: {
      projects, blasts, suppliers, launches: [], costs: [], financials: [], rates, segments: [],
      accounts: [{ id: 'acc-a', name: 'Acme' }], contacts: [], terms: [],
    },
    blocked,
    integrity: { pricesReturned } as FinanceLoad['integrity'],
  } as unknown as FinanceLoad
}

function props(load = loadOf()) {
  const ix = buildIndex(load.raw.blasts, load.raw.suppliers, load.raw.costs)
  const items = itemsOf(load.raw.projects, load.raw.blasts, load.raw.suppliers, load.raw.costs, ix)
  const population = populationFor(items, 'per-respondent', DEFAULT_FILTER, TODAY)
  const openDrill = vi.fn<(spec: DrillSpec, opts?: DrillOpts) => void>()
  const registerExport = vi.fn<(x: FinanceExport | null) => void>()
  const p: FinanceTabProps = {
    tab: 'per-respondent',
    load, ix, items, population, side: [],
    filter: DEFAULT_FILTER,
    today: TODAY,
    scope: describeFilter(DEFAULT_FILTER, { tab: 'per-respondent', today: TODAY, count: population.length }),
    accountName: () => 'Acme',
    openDrill,
    hrefFor: ({ tab, ...patch }) => {
      const q = serializeFilter({ ...DEFAULT_FILTER, ...patch })
      if (tab && tab !== 'results') q.set('tab', tab)
      if (!tab) q.set('tab', 'per-respondent')
      const s = q.toString()
      return s ? `/finance?${s}` : '/finance'
    },
    registerExport,
  }
  return { p, openDrill, registerExport }
}

describe('PerRespondentTab', () => {
  it('shows the guidance and one card per route, never a blended one', () => {
    const { p } = props()
    render(<PerRespondentTab {...p} />)
    expect(screen.getByText(/What one respondent costs us, by route/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Panel (PureSpectrum)' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Blast (B2B email and text)' })).toBeInTheDocument()
    // The blast card has three surveys: its floor is not called.
    const blastCard = screen.getByRole('region', { name: 'Blast (B2B email and text)' })
    expect(within(blastCard).getByText(/Too few studies here to call: a quote floor needs/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Panel (PureSpectrum)' })).getByText(/^Quote at least/)).toBeInTheDocument()
  })

  it('registers the per-route survey rows behind Tile 4, once, and not again on a re-render that changes nothing', () => {
    const { p, registerExport } = props()
    const { rerender } = render(<PerRespondentTab {...p} />)
    expect(registerExport).toHaveBeenCalledTimes(1)
    const x = registerExport.mock.calls[0][0]!
    expect(x.name).toBe('finance-per-respondent-surveys')
    expect(x.rows.filter(r => r.route === 'panel')).toHaveLength(9)
    expect(x.rows.filter(r => r.route === 'blast')).toHaveLength(3)
    rerender(<PerRespondentTab {...p} scope={{ ...p.scope }} />)
    expect(registerExport).toHaveBeenCalledTimes(1)
  })

  it('opens a route drill that reconciles, from the card’s own button', () => {
    const { p, openDrill } = props()
    render(<PerRespondentTab {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the 9 studies →' }))
    const spec = openDrill.mock.calls[0][0]
    expect(spec.key).toBe('per-respondent-panel')
    expect(reconcile(spec).ok).toBe(true)
  })

  it('links out with real anchors: Improve for the unsplit survey, Results for the panels', () => {
    const { p } = props()
    render(<PerRespondentTab {...p} />)
    expect(screen.getByText(/1 study fielded both ways/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See what to record on Improve →' }).getAttribute('href')).toBe('/finance?tab=improve')
    expect(screen.getByRole('link', { name: 'See panels →' }).getAttribute('href')).toBe('/finance?by=panel')
  })

  it('draws SAVE COST and EARN MORE as two lists and never offers to bill over-delivery', () => {
    const { p } = props()
    const { container } = render(<PerRespondentTab {...p} />)
    expect(screen.getByRole('region', { name: 'Save cost' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Earn more' })).toBeInTheDocument()
    expect(screen.getAllByText('Sell a range on repeat work').length).toBeGreaterThan(0)
    expect(container.textContent ?? '').not.toMatch(/\bbill (it|them|the over)/i)
    expect(container.textContent ?? '').not.toMatch(/grand total/i)
  })

  it('opens the rejected rules from a real link to #rejected-rules', () => {
    const { p } = props()
    render(<PerRespondentTab {...p} />)
    const link = screen.getByRole('link', { name: '3 rules tested and rejected →' })
    expect(link.getAttribute('href')).toBe('/finance?tab=per-respondent#rejected-rules')
    expect(screen.queryByText('Rules tested and rejected')).toBeNull()
    fireEvent.click(link)
    expect(screen.getByText('Rules tested and rejected')).toBeInTheDocument()
    expect(screen.getByText('Cap spend at target ÷ expected QA yield')).toBeInTheDocument()
  })

  it('shows a failed field-cost read as Blocked on both tiles, never as $0', () => {
    const { p } = props(loadOf([{ table: 'project_blasts', message: 'timeout' }]))
    render(<PerRespondentTab {...p} />)
    expect(screen.getAllByText(/Blocked: project_blasts did not load/)).toHaveLength(2)
  })

  it('replaces EARN MORE with the reason when prices did not load, and keeps SAVE COST', () => {
    const { p } = props(loadOf([{ table: 'project_financials', message: 'denied' }]))
    render(<PerRespondentTab {...p} />)
    const earn = screen.getByRole('region', { name: 'Earn more' })
    expect(within(earn).getByRole('alert').textContent).toContain('Blocked: project_financials did not load')
    expect(within(earn).getByRole('alert').textContent).toContain('missing, not zero')
    expect(screen.getByRole('region', { name: 'Save cost' })).toBeInTheDocument()
  })

  it('says on the cost card too that the price comparison is missing, not just quietly drops it', () => {
    const { p } = props(loadOf([{ table: 'project_financials', message: 'denied' }]))
    render(<PerRespondentTab {...p} />)
    const card = screen.getByRole('region', { name: 'Panel (PureSpectrum)' })
    // The floor is still shown — it is a cost figure — but the line that
    // compares it with what clients were quoted names why it is not there.
    expect(within(card).getByText(/^Quote at least/)).toBeInTheDocument()
    expect(within(card).queryByText(/quoted below the floor/)).toBeNull()
    const note = within(card).getByRole('alert')
    expect(note.textContent).toContain('Blocked: project_financials did not load')
    expect(note.textContent).toContain('no panel study here can be checked against the floor')
    // And the tile's closing sentence says it as well.
    expect(screen.getByText(/Client prices are missing, not zero, so no study in view can be checked against the floor/))
      .toBeInTheDocument()
  })

  it('says nothing about missing prices when the prices are there', () => {
    const { p } = props()
    const { container } = render(<PerRespondentTab {...p} />)
    expect(container.textContent ?? '').not.toMatch(/Client prices are missing/)
    const card = within(screen.getByRole('region', { name: 'Panel (PureSpectrum)' }))
    expect(card.getByText(/priced above \$0 in view/)).toBeInTheDocument()
  })
})

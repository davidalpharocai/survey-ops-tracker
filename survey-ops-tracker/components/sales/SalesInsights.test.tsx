import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { SalesProjectRow } from '@/lib/sales/insights'

/**
 * The sales Insights page end to end, on fixture rows.
 *
 * lib/sales/insights.test.ts proves the adapter and lib/insights/model.test.ts
 * proves every figure, so what is left for this file is what the SCREEN can get
 * wrong: drawing figures it is not entitled to draw, showing a salesperson
 * something internal, or printing money on a page that has none.
 *
 * next/navigation is mocked because this is a client component reading the URL
 * filter; the App Router context is not part of any question here.
 */

const replace = vi.fn()
let qs = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(qs),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...rest}>{children}</a>,
}))

import { SalesInsights } from './SalesInsights'

let seq = 0
const P = (o: Partial<SalesProjectRow> = {}): SalesProjectRow => ({
  id: `p${++seq}`,
  project_code: `PR${String(seq).padStart(5, '0')}`,
  project_name: `Study ${seq}`,
  client: 'Acme',
  client_id: 'acme',
  status: 'Open',
  phase: 'Active',
  board_column: 'Delivery',
  project_type: 'PS',
  submitted_date: '2026-08-28',
  launch_date: null,
  due_date: '2026-09-20',
  deliver_date: '2026-09-10',
  n_target: null,
  n_target_max: null,
  n_collected: 0,
  n_actual: 150,
  series_id: null,
  rerun_number: 1,
  is_placeholder: false,
  greenlit_at: null,
  cancelled_at: null,
  ...o,
})

function book(): SalesProjectRow[] {
  seq = 0
  return [
    ...Array.from({ length: 12 }, (_, i) => P({ deliver_date: `2026-09-${String(i + 2).padStart(2, '0')}` })),
    // An empty auto-spawned rerun wave parked in Delivery — 18 of these sit on
    // real books, and counting one is the whole reason migration 130 exists.
    P({ is_placeholder: true, n_actual: null, n_collected: null, deliver_date: '2026-09-03', due_date: null, submitted_date: null }),
    P({ status: 'Open', board_column: 'Fielding', deliver_date: null, due_date: '2026-09-20', n_target: 100, n_collected: 40, n_actual: null }),
    P({ status: 'Hold', board_column: 'Submitted', deliver_date: null, n_actual: null }),
  ]
}

const ACCOUNTS = { acme: 'Acme Capital' }

const show = (rows: SalesProjectRow[] = book(), owner: string | null = 'Alex Pinsky') =>
  render(<SalesInsights rows={rows} accounts={ACCOUNTS} owner={owner} today="2026-09-30" />)

beforeEach(() => { qs = 'range=all'; replace.mockClear() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the page draws only when it may', () => {
  // Without is_placeholder every empty rerun shell in Delivery counts as
  // delivered. Overstating a salesperson's own delivered work is worse than
  // showing nothing, so nothing is what it shows.
  it('refuses to draw a single figure when the view lacks is_placeholder', () => {
    const rows = book().map(r => {
      const copy = { ...r }
      delete (copy as unknown as Record<string, unknown>).is_placeholder
      return copy
    })
    show(rows)
    expect(screen.getByRole('alert').textContent).toMatch(/not ready yet/)
    expect(screen.getByRole('alert').textContent).toMatch(/130_sales_projects_is_placeholder\.sql/)
    expect(screen.queryByText('Studies delivered')).toBeNull()
  })

  it('names what a reader should do about it, not just that it is broken', () => {
    const rows = book().map(r => {
      const copy = { ...r }
      delete (copy as unknown as Record<string, unknown>).is_placeholder
      return copy
    })
    show(rows)
    expect(screen.getByRole('alert').textContent).toMatch(/administrator/)
  })

  it('draws the dashboard when the column is there', () => {
    show()
    expect(screen.getByText('Studies delivered')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('what the page may never show', () => {
  // The page reads sales_projects, which carries no money column at all — but
  // the thing that would break that is a future edit, not today's data, which
  // is exactly what a test is for.
  it('prints no dollar figure anywhere', () => {
    const { container } = show()
    expect(container.textContent).not.toMatch(/\$/)
  })

  // Who internally ran a study is an operations question. It is also absent
  // from the sales view, so rendering the analyst's slice would draw one grey
  // "No captain" bar across the whole book.
  it('says nothing about captains or internal workload', () => {
    const { container } = show()
    expect(container.textContent).not.toMatch(/captain/i)
    expect(container.textContent).not.toMatch(/workload/i)
  })

  it('shows no internal target, budget or spend wording', () => {
    const { container } = show()
    expect(container.textContent).not.toMatch(/budget|spend|margin|internal target/i)
  })
})

describe('what it says about the book', () => {
  it('leads with the salesperson, not the company', () => {
    show()
    expect(screen.getByText(/^Alex Pinsky delivered/)).toBeTruthy()
  })

  it('does not count the empty rerun wave as delivered, and says it left it out', () => {
    const { container } = show()
    expect(screen.getByText(/^Alex Pinsky delivered 12 studies/)).toBeTruthy()
    expect(container.textContent).toMatch(/Left out of every figure above: 1 empty rerun placeholder/)
  })

  it('states the omission of the internal slices rather than leaving a gap', () => {
    const { container } = show()
    expect(container.textContent).toMatch(/not shown here/)
  })

  it('counts open work separately from delivered work', () => {
    show()
    // One Fielding study is in flight; the held one is counted apart from it.
    expect(screen.getByText('In flight')).toBeTruthy()
    expect(screen.getByText('Being scoped')).toBeTruthy()
  })

  it('links a largest delivery to the sales study page, not the analyst one', () => {
    show()
    const link = screen.getAllByRole('link').find(a => /^PR\d+$/.test(a.textContent ?? ''))
    expect(link?.getAttribute('href')).toMatch(/^\/sales\/surveys\//)
  })

  it('falls back to "Your book" when the identity has no name', () => {
    show(book(), null)
    expect(screen.getByText(/^Your book delivered/)).toBeTruthy()
  })
})

describe('the filters', () => {
  // Queried by id rather than by label text: each label also wraps its (i)
  // tooltip, which carries its own aria-label, so a label lookup matches two
  // elements. That is the house pattern, not a defect — see the analyst
  // FilterBar, which is built the same way.
  it('offers dates, type and account — and no captain control', () => {
    const { container } = show()
    expect(container.querySelector('#sales-insights-range')).toBeTruthy()
    expect(container.querySelector('#sales-insights-type')).toBeTruthy()
    expect(container.querySelector('#sales-insights-account')).toBeTruthy()
    expect(container.querySelectorAll('select')).toHaveLength(3)
  })

  // A captain left in the URL would filter every figure on the page with
  // nothing on screen saying so.
  it('ignores a captain pasted into the URL', () => {
    qs = 'range=all&captain=someone'
    const { container } = show()
    expect(screen.getByText(/^Alex Pinsky delivered 12 studies/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/captain/i)
  })
})

/**
 * Repeat work on screen.
 *
 * Before this tile existed, the only rerun signal on the page was the "Rerun
 * (older type)" bar in the by-type chart — the legacy typing artifact. On live
 * data that bar was 6 delivered studies while the real repeat population was
 * 111 of 388, so the page understated repeat business by a factor of eighteen
 * while appearing to report it.
 */
describe('repeat work', () => {
  const tile = () =>
    screen.getByText('Repeat work').parentElement?.parentElement?.textContent ?? ''

  const wave = (over: Partial<SalesProjectRow> = {}) =>
    P({ series_id: 's1', rerun_number: 2, ...over })

  it('counts reruns of PS and B2B studies, which the type chart hides inside their own bars', () => {
    show([
      ...Array.from({ length: 3 }, (_, i) => wave({ project_type: 'PS', deliver_date: `2026-09-0${i + 1}` })),
      wave({ project_type: 'B2B', deliver_date: '2026-09-05' }),
      P({ project_type: 'PS', deliver_date: '2026-09-06' }),
    ])
    const t = tile()
    expect(t).toMatch(/3 PS, 1 B2B/)
    expect(t).toMatch(/80% of what you delivered/)
  })

  it('says so plainly when there is no repeat work, rather than printing a bare 0', () => {
    show()
    expect(tile()).toMatch(/None of the delivered studies here is a repeat wave/)
  })

  // The legacy type is the lost information: it says a study is a rerun and
  // nothing about what it was a rerun of.
  it('does not guess a base type for a study filed under the legacy Rerun type', () => {
    show([P({ project_type: 'Rerun', deliver_date: '2026-09-02' })])
    expect(tile()).toMatch(/no base type recorded/)
  })

  it('still shows no dollar figure anywhere', () => {
    const { container } = show([wave({ project_type: 'PS', deliver_date: '2026-09-02' })])
    expect(container.textContent).not.toMatch(/\$/)
  })
})

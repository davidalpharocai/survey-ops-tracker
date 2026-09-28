import { describe, it, expect } from 'vitest'
import { DEFAULT_FILTER, itemsOf, type FinanceFilter, type FinanceTab } from '@/lib/finance/filters'
import { buildIndex, type FinBlast, type FinProject } from '@/lib/finance/hub'
import type { Blocked, FinCostFull } from '@/lib/finance/load'
import { buildBannerModel, listMonths } from './banner'

/**
 * The banner's dates are COMPUTED from coverage (David, decision 8): he is
 * backfilling client prices toward 1 June, and the line has to move by itself.
 * These fixtures build a book month by month and check that the words follow
 * the data — including after a "backfill" — and that nothing is typed in.
 */

const TODAY = '2026-09-27'
let n = 0
const P = (o: Partial<FinProject>): FinProject => ({
  id: `p${++n}`, project_code: `PR${String(n).padStart(5, '0')}`, project_name: 'S', client: 'BAM', client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: null, launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 100, ...o,
})
// One blast per survey in these fixtures, so the survey's id makes a unique row id.
const blast = (project_id: string, dollars: number): FinBlast & { id: string; created_at: string } =>
  ({ id: `b-${project_id}`, project_id, bid: dollars, completes: 1, people: 0, cost_per_send: 0, channel: 'email', created_at: '2026-09-15T12:00:00Z' })

/** One month: `k` delivered surveys, the first `costed` with a blast, the
 *  first `priced` with a rate, the first `budgeted` with a budget. */
function month(key: string, k: number, costed: number, priced: number, budgeted: number) {
  const ps = Array.from({ length: k }, (_, i) => P({ deliver_date: `${key}-1${i}`, budget: i < budgeted ? 500 : null }))
  return {
    ps,
    blasts: ps.slice(0, costed).map(p => blast(p.id, 100)),
    rates: ps.slice(0, priced).map(p => [p.id, 10] as [string, number]),
  }
}

function book(opts: { junPriced?: number; julPriced?: number } = {}) {
  n = 0
  const ms = [
    month('2026-05', 4, 1, 0, 0), // 25% costed — before costs were reliable
    month('2026-06', 4, 3, opts.junPriced ?? 0, 0),
    month('2026-07', 4, 4, opts.julPriced ?? 0, 0),
    month('2026-08', 4, 4, 2, 1),
    month('2026-09', 4, 4, 2, 1),
  ]
  const undated = P({ deliver_date: null })
  const live = P({ board_column: 'Fielding', deliver_date: '2026-10-15' })
  const projects = [...ms.flatMap(m => m.ps), undated, live]
  const blasts = ms.flatMap(m => m.blasts)
  const rates = new Map(ms.flatMap(m => m.rates))
  const costs: FinCostFull[] = []
  const ix = buildIndex(blasts, [], costs)
  const items = itemsOf(projects, blasts, [], costs, ix)
  return { items, ix, raw: { rates, blasts, suppliers: [], costs } }
}

const model = (
  b: ReturnType<typeof book>,
  o: { tab?: FinanceTab; filter?: FinanceFilter; blocked?: Blocked[]; pricesReturned?: number } = {},
) => buildBannerModel({
  tab: o.tab ?? 'results', filter: o.filter ?? DEFAULT_FILTER, today: TODAY,
  items: b.items, raw: b.raw, ix: b.ix, blocked: o.blocked ?? [], pricesReturned: o.pricesReturned ?? b.raw.rates.size,
})
const ALL: FinanceFilter = { ...DEFAULT_FILTER, range: { preset: 'all', from: null, to: null } }

describe('the reliability dates come from coverage, not from the copy', () => {
  it('names the first month from which each field stays over its bar', () => {
    const m = model(book())
    expect(m.dates.cost.month).toBe('2026-06')
    expect(m.dates.price.month).toBe('2026-08')
    expect(m.dates.budget.month).toBe('2026-08')
    expect(m.reliability.join(' ')).toContain('Costs are reliable from Jun 2026.')
    expect(m.reliability.join(' ')).toContain('Client prices and budgets are entered regularly from Aug 2026.')
  })

  it('moves the price date by itself when prices are backfilled', () => {
    const before = model(book())
    expect(before.priceGap).toContain('Jun and Jul 2026')
    // David backfills one price in June and one in July: 1 of 4 is the 25% bar.
    const after = model(book({ junPriced: 1, julPriced: 1 }))
    expect(after.dates.price.month).toBe('2026-06')
    expect(after.reliability.join(' ')).toContain('Client prices are entered regularly from Jun 2026')
    // …and the gap line clears itself.
    expect(after.priceGap).toBeNull()
  })

  it('keeps raising the gap while any reliable-cost month is under the price bar', () => {
    const half = model(book({ junPriced: 1 }))
    expect(half.priceGap).toMatch(/still thin in Jul 2026: 0 of 4 delivered surveys/)
    expect(half.priceGap).toContain('25%')
  })

  it('says so when no month is reliable yet, instead of naming one', () => {
    n = 0
    const ps = [P({ deliver_date: '2026-06-10' }), P({ deliver_date: '2026-06-11' }), P({ deliver_date: '2026-06-12' })]
    const ix = buildIndex([], [], [])
    const m = buildBannerModel({
      tab: 'results', filter: DEFAULT_FILTER, today: TODAY, items: itemsOf(ps, [], [], [], ix),
      raw: { rates: new Map(), blasts: [], suppliers: [], costs: [] }, ix, blocked: [], pricesReturned: 1,
    })
    expect(m.dates.cost.month).toBeNull()
    expect(m.reliability[0]).toBe('Costs are not yet recorded on most delivered surveys in any month.')
    expect(m.tone).toBe('amber')
  })
})

describe('the view', () => {
  it('counts the delivered surveys in view, and says the price-against-cost figures cover only some', () => {
    const m = model(book())
    // Since 1 June: 16 delivered (Jun–Sep), 15 costed, 4 priced.
    expect(m.view[0]).toBe('In this view 15 of 16 delivered surveys (94%) carry a recorded cost, and 4 carry a client price.')
    expect(m.view[1]).toMatch(/^So the price-against-cost figures cover 4 surveys holding 27% of the spend/)
    expect(m.tone).toBe('plain')
    expect(m.mixed).toBeNull()
  })

  it('turns amber and says why when the view reaches before costs were reliable', () => {
    const m = model(book(), { filter: ALL })
    expect(m.tone).toBe('amber')
    // May's 4 surveys plus the undated one.
    expect(m.mixed).toMatch(/^This view mixes two eras\. It adds 5 delivered surveys from before Jun 2026 or with no date: 24% of the surveys/)
    expect(m.mixed).toContain('1 of them carries any cost, so coverage and medians read worse than the business did.')
    expect(m.offerDefault).toBe(true)
    // The undated survey only reaches an unbounded view, and the sentence says so.
    expect(model(book()).view.join(' ')).toContain('1 delivered survey has no date and appears in no date range.')
  })

  it('does not apply the date on This week, and never goes amber there', () => {
    const m = model(book(), { tab: 'this-week', filter: ALL })
    expect(m.view).toEqual(['The date filter does not apply on this tab: live work matters whenever it launched.'])
    expect(m.tone).toBe('plain')
  })

  it('never states a price fact when prices did not load', () => {
    const blocked: Blocked[] = [{ table: 'project_financials', message: 'permission denied' }]
    const m = model(book(), { blocked })
    expect(m.pricesUnavailable).toBe(true)
    expect(m.reliability.join(' ')).toContain('Client prices did not load')
    expect(m.priceGap).toBeNull()
    expect(m.view.join(' ')).not.toContain('client price')
    const none = model(book(), { pricesReturned: 0 })
    expect(none.reliability.join(' ')).toContain('No client prices came back')
  })

  it('names a missing cost table as a floor', () => {
    const m = model(book(), { blocked: [{ table: 'project_blasts', message: 'timeout' }] })
    expect(m.view.join(' ')).toContain('Floor only: project_blasts did not load')
  })
})

describe('the (i)', () => {
  it('explains each date month by month, from the data', () => {
    const m = model(book())
    expect(m.help).toContain('Why Jun 2026 for costs: 25% of delivered surveys carried a recorded cost in May 2026 and 75% in Jun 2026.')
    expect(m.help).toContain('Client prices by month: Jun 0%, Jul 0%, Aug 50%, Sep 50%')
    // Every blast in the book (May's one included), not only those in view.
    expect(m.help).toContain('Many field records were entered in bulk: 16 of 16 blast rows were written in Sep 2026.')
  })
})

describe('listMonths', () => {
  it('reads like a sentence', () => {
    expect(listMonths(['2026-06'])).toBe('Jun 2026')
    expect(listMonths(['2026-06', '2026-07'])).toBe('Jun and Jul 2026')
    expect(listMonths(['2026-06', '2026-07', '2026-08'])).toBe('Jun, Jul and Aug 2026')
    expect(listMonths(['2025-12', '2026-01'])).toBe('Dec 2025 and Jan 2026')
  })
})

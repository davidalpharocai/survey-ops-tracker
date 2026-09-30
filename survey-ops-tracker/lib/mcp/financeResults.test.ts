import { describe, it, expect, vi } from 'vitest'
import { financeResults, FINANCE_REFUSAL, MAX_ROWS, cents, type FinanceResultsDeps } from './financeResults'
import { buildResultsModel, partsText, resultsInputOf } from '@/lib/finance/results'
import { DEFAULT_FILTER, type FinanceFilter } from '@/lib/finance/filters'
import { fixtureLoad, TODAY } from '@/lib/finance/results.fixture'
import { TOOLS } from './registry'

/**
 * The connector's finance_results tool against the finance page's own model,
 * on the same book. "Parity" here means the tool returns exactly what the page
 * shows — every Tile 1 figure, every month and every Tile 2 row to the cent,
 * and the same verdict words — and that a caller without finance access gets
 * nothing at all.
 */

// Noon Eastern on the fixture's "today", so todayET lands on it.
const NOW = new Date(`${TODAY}T16:00:00Z`)

function deps(o: Partial<FinanceResultsDeps> = {}): FinanceResultsDeps & {
  load: ReturnType<typeof vi.fn>; resolveAccount: ReturnType<typeof vi.fn>
} {
  return {
    canViewFinancials: vi.fn(async () => true),
    load: vi.fn(async () => fixtureLoad()),
    resolveAccount: vi.fn(async (ref: string) =>
      ref.toLowerCase() === 'coatue' ? { id: 'coa', name: 'Coatue' }
        : ref.toLowerCase() === 'b' ? { ambiguous: [{ code: 'Cl00001', name: 'BAM' }, { code: 'Cl00002', name: 'BofA' }] }
          : null),
    now: () => NOW,
    ...o,
  } as never
}

const model = (f: FinanceFilter, by: Parameters<typeof resultsInputOf>[3] = 'account') =>
  buildResultsModel(resultsInputOf(fixtureLoad(), f, TODAY, by))

type Out = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('finance_results is for finance holders only', () => {
  it('refuses a caller without view_financials before reading anything', async () => {
    const d = deps({ canViewFinancials: vi.fn(async () => false) })
    const out = await financeResults({ account: 'Coatue' }, { userId: 'analyst-1' }, d)
    expect(out).toEqual({ error: FINANCE_REFUSAL, restricted: true })
    expect(d.load).not.toHaveBeenCalled()
    expect(d.resolveAccount).not.toHaveBeenCalled()
  })

  it('refuses a caller with no user id at all (the real gate never defaults open)', async () => {
    const out = await financeResults({}, {}, { ...deps(), canViewFinancials: async ctx => !!ctx.userId })
    expect(out.error).toBe(FINANCE_REFUSAL)
  })

  it('is registered as a read tool that takes the page filters', () => {
    const t = TOOLS.find(x => x.name === 'finance_results')
    expect(t?.kind).toBe('read')
    expect(Object.keys(t!.schema).sort()).toEqual(['account', 'from', 'group_by', 'range', 'route', 'to'])
  })
})

describe('finance_results returns what the page shows, to the cent', () => {
  it('Tile 1, the coverage line, the months, Tile 2 and the verdict — default view', async () => {
    const out = await financeResults({}, { userId: 'david' }, deps()) as Out
    const m = model(DEFAULT_FILTER)
    expect(out.ok).toBe(true)
    expect(out.scope).toBe(m.scope.chip)
    expect(out.tile1.margin_set_surveys).toBe(m.tile1.surveys)
    expect(out.tile1.client_price).toBe(cents(m.tile1.clientPrice))
    expect(out.tile1.our_cost).toBe(cents(m.tile1.ourCost))
    expect(out.tile1.we_keep).toBe(cents(m.tile1.kept))
    expect(out.tile1.paid_work.we_keep).toBe(cents(m.tile1.paid.kept))
    expect(out.tile1.given_away_at_0).toEqual({ surveys: m.tile1.free.surveys, cost: cents(m.tile1.free.cost) })
    expect(out.tile1.budget_set_at.surveys_in_median).toBe(m.tile1.budget.n)
    expect(out.tile1.spent_more_than_half_their_price).toBe(m.tile1.spentOverGoal)
    // And the hand-computed book, so both cannot be wrong together.
    expect(out.tile1.client_price).toBe(86540)
    expect(out.tile1.our_cost).toBe(46021)
    expect(out.tile1.we_keep).toBe(40519)

    expect(out.coverage.text).toBe(partsText(m.coverage.parts))
    expect(out.coverage.delivered_spend).toBe(cents(m.coverage.deliveredSpend))
    expect(out.coverage.no_price).toEqual({ surveys: 1, spend: 2100 })
    expect(out.spend_lines.map((l: Out) => l.amount)).toEqual(m.waterfall.lines.map(l => cents(l.amount)))
    expect(out.not_in_figures.text).toBe(partsText(m.notIn.parts))

    expect(out.months).toHaveLength(m.months.length)
    out.months.forEach((row: Out, i: number) => {
      const mm = m.months[i]
      expect(row.month).toBe(mm.key)
      expect(row.client_price).toBe(cents(mm.price))
      expect(row.our_cost).toBe(cents(mm.cost))
      expect(row.spend_with_no_price).toBe(cents(mm.spendNoPrice))
      expect(row.margin_surveys).toBe(mm.surveys)
    })

    expect(out.verdict).toBe(partsText(m.verdict))
    expect(out.tile2.group_by).toBe('account')
    expect(out.tile2.verdict).toBe(partsText(m.tile2.verdict))
    expect(out.tile2.rows.map((r: Out) => [r.group, r.client_price, r.our_cost, r.we_keep]))
      .toEqual(m.tile2.rows.map(r => [r.label, cents(r.revenue), cents(r.cost), cents(r.kept)]))
    // A blended account prints no per-respondent figure, and says why in its route rows.
    const bam = out.tile2.rows.find((r: Out) => r.group === 'BAM')
    expect(bam.price_per_billed_n).toBeNull()
    expect(bam.routes.length).toBe(3)
  })

  it('resolves an account by name, and applies the route and range the same way the page does', async () => {
    const f: FinanceFilter = { range: { preset: 'all', from: null, to: null }, account: 'coa', route: 'blast' }
    const out = await financeResults({ account: 'Coatue', route: 'blast', range: 'all', group_by: 'month' }, { userId: 'david' }, deps()) as Out
    const m = model(f, 'month')
    expect(out.filter.account).toEqual({ id: 'coa', name: 'Coatue' })
    expect(out.scope).toBe(m.scope.chip)
    expect(out.tile1.client_price).toBe(cents(m.tile1.clientPrice))
    expect(out.tile2.rows.map((r: Out) => r.client_price)).toEqual(m.tile2.rows.map(r => cents(r.revenue)))
  })

  it('turns from/to into a custom range', async () => {
    const out = await financeResults({ from: '2026-08-01', to: '2026-08-31' }, { userId: 'david' }, deps()) as Out
    const m = model({ ...DEFAULT_FILTER, range: { preset: 'custom', from: '2026-08-01', to: '2026-08-31' } })
    expect(out.filter.range).toBe('custom')
    expect(out.filter.dates).toBe('1 Aug–31 Aug 2026')
    expect(out.tile1.client_price).toBe(cents(m.tile1.clientPrice))
    expect(out.months.map((x: Out) => x.month)).toEqual(['2026-08'])
  })

  it('returns the three-way ledger for group_by survey, with its tags', async () => {
    const out = await financeResults({ group_by: 'survey' }, { userId: 'david' }, deps()) as Out
    const m = model(DEFAULT_FILTER, 'survey')
    expect(out.tile2.total_rows).toBe(m.ledger.length)
    expect(out.tile2.truncated).toBe(m.ledger.length > MAX_ROWS)
    expect(out.tile2.rows[0]).toMatchObject({ survey: 'LOSS', we_keep: -1400, tags: ['LOST MONEY', 'OVER BUDGET'] })
    const free = out.tile2.rows.find((r: Out) => r.survey === 'FREE')
    expect(free.we_keep_pct).toBe('given away')
    expect(free.spend_per_price_cents).toBe('given away')
    const unpriced = out.tile2.rows.find((r: Out) => r.survey === 'UNPRICED')
    expect(unpriced).toMatchObject({ client_price: null, price_status: 'no price', tags: ['NO PRICE'] })
  })
})

describe('finance_results returns the panel supplier view, not an apology', () => {
  /** The tool used to answer group_by 'panel' with an empty list and a note
   *  pointing at the page, so a caller that reads `rows` first could report "no
   *  panel suppliers" for a book with six figures of panel spend. It now builds
   *  the page's own panel model over the same population. */
  it('splits the Panel spend line by supplier, and adds back to it', async () => {
    const out = await financeResults({ group_by: 'panel' }, { userId: 'david' }, deps()) as Out
    const panelLine = out.spend_lines.find((l: Out) => l.line === 'Panel (PureSpectrum)')
    expect(out.tile2.group_by).toBe('panel')
    expect(out.tile2.rows.length).toBeGreaterThan(0)
    expect(out.tile2.panel_spend).toBe(panelLine.amount)
    expect(cents(out.tile2.rows.reduce((t: number, r: Out) => t + (r.spend ?? 0), 0))).toBe(panelLine.amount)
    // Two panels bought in this view; the fixture's rows carry no supplier name,
    // so they read as "Unnamed panel" rather than as no panel at all.
    expect(out.tile2.total_rows).toBe(2)
    expect(out.tile2.rows[0]).toMatchObject({ surveys: 4, spend: 5741 })
    expect(out.tile2.rows[1]).toMatchObject({ surveys: 1, spend: 260 })
  })

  it('carries no client price or margin, because clients pay per study and not per panel', async () => {
    const out = await financeResults({ group_by: 'panel' }, { userId: 'david' }, deps()) as Out
    for (const r of out.tile2.rows) {
      expect(r.client_price).toBeUndefined()
      expect(r.we_keep).toBeUndefined()
      expect(r.price_per_complete).not.toBeUndefined()
    }
    expect(out.tile2.note).toContain('no client price or margin by panel')
  })
})

describe('finance_results never reports a figure it could not compute', () => {
  it('names a blocked table instead of returning numbers', async () => {
    const out = await financeResults({}, { userId: 'david' }, deps({ load: vi.fn(async () => fixtureLoad({ blocked: ['project_costs'] })) }))
    expect(out.error).toContain('Blocked: project_costs did not load')
    expect(out.tile1).toBeUndefined()
  })
  it('names a failed clients read, which would otherwise let demo money in silently', async () => {
    const out = await financeResults({}, { userId: 'david' }, deps({ load: vi.fn(async () => fixtureLoad({ blocked: ['clients'] })) }))
    expect(out.error).toContain('Blocked: clients did not load')
    expect(out.tile1).toBeUndefined()
  })
  it('treats no prices returned as missing, not zero', async () => {
    const out = await financeResults({}, { userId: 'david' }, deps({ load: vi.fn(async () => fixtureLoad({ prices: false })) }))
    expect(out.error).toContain('project_financials returned no prices')
    expect(out.tile1).toBeUndefined()
  })
  it('asks which account when a name is ambiguous, and says so when there is none', async () => {
    const d = deps()
    const amb = await financeResults({ account: 'b' }, { userId: 'david' }, d)
    expect(amb.candidates).toHaveLength(2)
    expect(d.load).not.toHaveBeenCalled()
    const none = await financeResults({ account: 'nobody' }, { userId: 'david' }, deps())
    expect(none.error).toBe('No account found matching "nobody".')
  })
  it('rejects a malformed date rather than guessing', async () => {
    const out = await financeResults({ from: '08/01/2026' }, { userId: 'david' }, deps())
    expect(out.error).toContain('YYYY-MM-DD')
    const backwards = await financeResults({ from: '2026-09-01', to: '2026-08-01' }, { userId: 'david' }, deps())
    expect(backwards.error).toContain('after')
  })
})

import { describe, it, expect } from 'vitest'
import {
  marginOf, foregone, moneyLost, buildIndex, legsOf, spendOf,
  type FinBlast, type FinCost, type FinProject, type FinSegment, type FinSupplier,
} from './hub'
import {
  accountPnl, budgetVariance, exceptions, FINANCE_BADGES, liveExposure, LIFECYCLES, monthTable,
  surveyPnl, unpricedSpend,
} from './analysis'
import { cpqrWithCoverage } from './cpqr'
import {
  breachRows, cpqrRows, exposureRows, foregoneRows, leverRows, marginRows, overTargetRows,
  scrubRows, unpricedRows,
} from './drills'
import { reconcile, routeSpendOfIds, spendOfIds } from './drill'
import { buildFinanceCsv, FIN_COLUMNS } from './exportFinance'
import {
  DEFAULT_FILTER, itemsOf, LEVER_RULE, populationByRule, populationFor, sideBucketFor, viewPopulations,
  type FinanceFilter, type FinanceTab, type FinItem,
} from './filters'
import {
  billedNOf, overDeliveredOf, revenueDetail, segmentPriceDiffers, segmentsDisagree, shortfallOf,
  type RevenueSubject,
} from './revenue'
import { billableN, creditRevenue } from './credits'
import { billedFor, invoicedBillable, overage } from '@/lib/utils/pricing'

/**
 * TESTS ON THE JOINTS, NOT THE UNITS.
 *
 * The old suite passed 150 of 150 in lib/finance while the page disagreed with
 * itself by $7,338: every formula was tested alone, and nothing checked that
 * two of them agreed. This file checks the places where they meet —
 *
 *   1. the margin set's client price, cost and "we keep" are the SAME to the
 *      cent in every consumer: the hub, the per-survey P&L, the margin drill,
 *      the month table, the account table, the CSV export, the project page's
 *      pricing math and the credit valuation;
 *   2. every drill's rows reconcile to the figure that opened it, checked
 *      against a total and an id list computed by a different function;
 *   3. both hold under every filter state, through the per-tab populations;
 *   4. the classifier decides which surveys any of it sees.
 *
 * The book below is small but carries every shape that has broken a figure on
 * real data: over-delivery past a sold range, a short survey, a $0 trial, a
 * segmented survey with a price override and a recovered reward, a Buyers /
 * Sellers survey whose segments split unevenly around a full delivery, a loss,
 * a placeholder that holds real data and one that is empty, an undated survey,
 * priced work with no cost, priced work with no delivered N, a segment still
 * missing its delivered N, unpriced spend, and cancelled, live, held and
 * scoping work.
 *
 * Every segmented survey is billed on the SURVEY (David, 2026-09-27): its one
 * rate, its N actual, its cap. Segments never split, cap or block the bill.
 */

const TODAY = '2026-09-24'

const P = (o: Partial<FinProject> & { id: string }): FinProject => ({
  project_code: o.id.toUpperCase(), project_name: 'Survey', client: 'label', client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: null, launch_date: null, submitted_date: null,
  n_target: null, n_target_max: null, n_collected: null, n_actual: null,
  is_placeholder: false, budget: null, ...o,
})
const SEG = (project_id: string, id: string, o: Partial<FinSegment>): FinSegment => ({
  id, project_id, n_target: null, n_target_max: null, n_actual: null, price_per_n: null, ...o,
})
const blast = (project_id: string, bid: number, completes: number, people = 0, channel = 'email', cost_per_send = 0): FinBlast =>
  ({ project_id, bid, completes, people, cost_per_send, channel })
const panel = (project_id: string, cpi: number, n: number, supplier_id = 'prime'): FinSupplier =>
  ({ project_id, cpi, n_collected: n, supplier_id, launch_id: `w-${project_id}` })

const projects: FinProject[] = [
  // 130 delivered against a range of 100–120: bills 120, never 130.
  P({ id: 'over', deliver_date: '2026-07-10', n_target: 100, n_target_max: 120, n_actual: 130, n_collected: 160, budget: 7000 }),
  // 900 delivered of 1,000 sold, on a $3 panel rate.
  P({ id: 'short', client_id: 'coa', project_type: 'PS', deliver_date: '2026-08-15', n_target: 1000, n_actual: 900, n_collected: 1300, budget: 1500 }),
  // Given away at $0: $0 of revenue, its cost real, never in a ratio.
  P({ id: 'free', client_id: 'ubs', project_type: 'PS', deliver_date: '2026-09-03', n_target: 500, n_actual: 520, n_collected: 600 }),
  // Two segments: one with its own $150 price, one inheriting $100. The bill
  // is the survey's — 90 of 90 at the survey's $100 — so the $150 is a note,
  // segment A's 60-of-50 is not over-delivery and segment B's 30-of-40 is not a
  // shortfall. A recovered reward comes off the cost.
  P({
    id: 'seg', deliver_date: '2026-09-10', n_target: 90, n_actual: 90, n_collected: 110,
    segments: [
      SEG('seg', 'seg-a', { n_target: 50, n_target_max: 50, n_actual: 60, price_per_n: 150 }),
      SEG('seg', 'seg-b', { n_target: 40, n_actual: 30 }),
    ],
  }),
  // Priced above $0 and still lost money.
  P({ id: 'loss', client_id: 'sig', project_type: 'PS', deliver_date: '2026-08-20', n_target: 100, n_actual: 100, n_collected: 120 }),
  // A placeholder that holds real data is real work (PR00352 / PR00344).
  P({ id: 'ph-data', is_placeholder: true, deliver_date: '2026-09-12', n_target: 50, n_actual: 50, n_collected: 50 }),
  // No date at all: in All time, out of any bounded range.
  P({ id: 'undated', client_id: 'coa', n_target: 10, n_actual: 10, n_collected: 12 }),
  // Priced, delivered, no cost recorded: excluded, or it reads as 100% kept.
  P({ id: 'priced-nocost', client_id: 'coa', deliver_date: '2026-09-01', n_target: 20, n_actual: 20 }),
  // Priced, costed, but no delivered N yet: blocked, never billed on collected.
  P({ id: 'priced-no-n', deliver_date: '2026-09-05', n_target: 40, n_collected: 45 }),
  // Buyers 100 sold / 120 delivered, Sellers 100 sold / 80 delivered, survey
  // 200 of 200. Billed 200 at $20; nothing over, nothing short, in every
  // consumer. Segment by segment it used to read 180 billed, 20 over, 20 short.
  P({
    id: 'buysell', deliver_date: '2026-09-11', n_target: 200, n_actual: 200, n_collected: 230,
    segments: [
      SEG('buysell', 'bs-buy', { label: 'Buyers', n_target: 100, n_actual: 120 }),
      SEG('buysell', 'bs-sell', { label: 'Sellers', n_target: 100, n_actual: 80 }),
    ],
  }),
  // A segment with no delivered N (PR00231). It used to be blocked; the bill
  // uses the survey's N actual, 280 of 600 at $3, and the segments are a note.
  // 280 is only the counted segment's N, so every PER-RESPONDENT figure (CPQR,
  // scrub, over-delivery at cost, cost per N) leaves it out and lists it.
  P({
    id: 'partial', project_type: 'PS', deliver_date: '2026-09-06', n_target: 600, n_actual: 280, n_collected: 900,
    segments: [
      SEG('partial', 'part-c', { n_target: 300, n_actual: 280 }),
      SEG('partial', 'part-d', { n_target: 300, n_actual: null }),
    ],
  }),
  // Costed and delivered with no price at all.
  P({ id: 'unpriced', deliver_date: '2026-08-02', n_target: 30, n_actual: 30, n_collected: 35 }),
  // An empty rerun shell on the Delivery column: excluded everywhere.
  P({ id: 'ph-empty', is_placeholder: true, deliver_date: '2026-09-20', n_target: 100 }),
  P({ id: 'cancelled', client_id: 'coa', board_column: 'Fielding', status: 'Cancelled' }),
  // Live, launched in March, past its budget and its target.
  P({ id: 'live', board_column: 'Fielding', status: 'Open', launch_date: '2026-03-01', n_target: 50, n_collected: 70, budget: 1000 }),
  // Live and due NEXT WEEK. A to-date range capped at today dropped this kind
  // of survey — 31 of the 46 live on 2026-09-27 — from every "delivered and
  // live" figure.
  P({ id: 'live-next', board_column: 'Fielding', status: 'Open', deliver_date: '2026-10-01', n_target: 100, n_collected: 40 }),
  P({ id: 'hold', board_column: 'Fielding', status: 'Hold' }),
  P({ id: 'scoping', board_column: 'Submitted', status: 'Open', phase: 'Scoping', submitted_date: '2026-09-20', n_target: 300 }),
]

const blasts: FinBlast[] = [
  blast('over', 50, 160, 1000, 'sms', 0.02), // $8,000 of reward + $20 of sends
  blast('seg', 40, 110), // $4,400, email so no send cost
  blast('buysell', 10, 230), // $2,300
  blast('undated', 30, 12),
  blast('priced-no-n', 50, 45),
  blast('unpriced', 60, 35),
  blast('cancelled', 10, 5),
  blast('live', 30, 70),
  blast('live-next', 25, 40),
  blast('hold', 10, 3),
]
const suppliers: FinSupplier[] = [
  panel('short', 1.37, 1300),
  panel('free', 1.1, 600),
  panel('loss', 20, 120),
  panel('partial', 1, 900),
]
const costs: FinCost[] = [
  { project_id: 'seg', amount: -200, kind: 'sms_email_blast', description: 'Recovered blast incentives' },
  { project_id: 'ph-data', amount: 400, kind: 'contacts_export' },
]
const rates = new Map<string, number>([
  ['over', 150], ['short', 3], ['free', 0], ['seg', 100], ['loss', 10], ['ph-data', 20],
  ['undated', 120], ['priced-nocost', 50], ['priced-no-n', 150], ['partial', 3], ['buysell', 20],
  ['ph-empty', 100], ['cancelled', 100], ['live', 150], ['scoping', 22],
])
const accounts = new Map([['bam', 'BAM'], ['coa', 'Coatue'], ['ubs', 'UBS'], ['sig', 'SIG']])

const ix = buildIndex(blasts, suppliers, costs)
const items = itemsOf(projects, blasts, suppliers, costs, ix)
const F = (o: Partial<FinanceFilter> = {}): FinanceFilter => ({ ...DEFAULT_FILTER, ...o })
const ALL = { preset: 'all' as const, from: null, to: null }
const pop = (tab: FinanceTab, f: FinanceFilter) => populationFor(items, tab, f, TODAY).map(i => i.p)

/** The project page hands the bill exactly this
 *  (components/project/PricingWidget.tsx): the survey's own N fields, and its
 *  segments with any price override — the notes read them, the bill does not. */
function widgetSurvey(p: FinProject): RevenueSubject {
  return {
    n_target: p.n_target,
    n_target_max: p.n_target_max ?? null,
    n_actual: p.n_actual,
    segments: (p.segments ?? []).map(s => ({
      n_target: s.n_target, n_target_max: s.n_target_max ?? null, n_actual: s.n_actual,
      price_per_n: s.price_per_n ?? null,
    })),
  }
}

/** Parse one numeric column out of the export, so the FILE is checked, not
 *  the rows handed to it. */
function csvColumn(csv: string, header: string): number[] {
  const lines = csv.split('\r\n')
  const cols = lines[0].split(',')
  const at = cols.indexOf(header)
  expect(at, `export has a "${header}" column`).toBeGreaterThanOrEqual(0)
  return lines.slice(1).map(l => Number(l.split(',')[at] || 0))
}

const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)
const cents = (x: number) => Math.round(x * 100)

/** Every consumer's view of one population's margin set, side by side. */
function everyConsumer(rows: FinProject[]) {
  const hub = marginOf(rows, rates, blasts, suppliers, costs)
  const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, accounts)
  const inMargin = pnl.filter(r => r.inMargin)
  const drill = marginRows(pnl)
  const months = monthTable(rows, rates, blasts, suppliers, costs)
  const acc = accountPnl(pnl)
  const byId = new Map(rows.map(p => [p.id, p]))
  const csv = buildFinanceCsv(inMargin, FIN_COLUMNS, byId)
  const one = (id: string) => byId.get(id) as FinProject
  return {
    hub,
    ids: [...hub.ids].sort(),
    revenue: {
      hub: hub.revenue,
      pnl: sum(inMargin.map(r => r.revenue ?? 0)),
      drill: sum(drill.map(r => Number(r.revenue ?? 0))),
      monthTotal: months.total.margin.revenue,
      monthRows: sum([...months.periods, ...(months.undated ? [months.undated] : [])].map(m => m.margin.revenue)),
      accounts: sum(acc.map(a => a.revenue)),
      accountRoutes: sum(acc.flatMap(a => a.routes.map(r => r.revenue))),
      export: sum(csvColumn(csv, 'Revenue')),
      projectPage: sum(hub.ids.map(id => invoicedBillable(widgetSurvey(one(id)), rates.get(id) ?? null) ?? NaN)),
      credits: sum(hub.ids.map(id => creditRevenue(one(id), rates.get(id), new Map()).revenue ?? NaN)),
      revenueTs: sum(hub.ids.map(id => revenueDetail(one(id), rates.get(id)).revenue ?? NaN)),
    },
    cost: {
      hub: hub.cost,
      pnl: sum(inMargin.map(r => r.cost)),
      drill: sum(drill.map(r => Number(r.cost))),
      monthTotal: months.total.margin.cost,
      accounts: sum(acc.map(a => a.cost)),
      export: sum(csvColumn(csv, 'Total cost')),
      rawRows: spendOfIds(hub.ids, blasts, suppliers, costs),
    },
    kept: {
      hub: hub.margin,
      pnl: sum(inMargin.map(r => r.margin ?? 0)),
      drill: sum(drill.map(r => r.contribution)),
      monthTotal: months.total.margin.kept,
      accounts: sum(acc.map(a => a.margin)),
      export: sum(csvColumn(csv, 'Margin $')),
    },
    setIds: {
      pnl: inMargin.map(r => r.id).sort(),
      drill: drill.map(r => r.id).sort(),
      months: [...new Set([...months.periods, ...(months.undated ? [months.undated] : [])]
        .flatMap(m => m.ids))].filter(id => inMargin.some(r => r.id === id)).sort(),
    },
  }
}

describe('the margin set, by hand', () => {
  it('bills the survey rate × min(the survey N actual, top of its range), and nothing else', () => {
    const c = everyConsumer(pop('results', F()))
    // over 150×120 + short 3×900 + free 0 + seg 100×90 (the survey's rate, not
    // the $150 segment price) + loss 10×100 + ph-data 20×50 + partial 3×280 +
    // buysell 20×200
    const revenue = 18000 + 2700 + 0 + 9000 + 1000 + 1000 + 840 + 4000
    expect(c.hub.revenue).toBe(revenue)
    // over 8,020 + short 1,781 + free 660 + seg 4,200 (4,400 less a $200
    // recovery) + loss 2,400 + ph-data 400 + partial 900 + buysell 2,300
    const cost = 8020 + 1781 + 660 + 4200 + 2400 + 400 + 900 + 2300
    expect(c.hub.cost).toBeCloseTo(cost, 6)
    expect(c.hub.margin).toBeCloseTo(revenue - cost, 6)
    expect(c.ids).toEqual(['buysell', 'free', 'loss', 'over', 'partial', 'ph-data', 'seg', 'short'])
    // On paid work the $0 trial's cost leaves the ratio.
    expect(c.hub.paid.surveys).toBe(7)
    expect(c.hub.paid.pct).toBeCloseTo((revenue - (cost - 660)) / revenue, 9)
    expect(c.hub.free).toMatchObject({ surveys: 1, ids: ['free'] })
  })

  it('keeps out what does not belong, and says where each one went', () => {
    const c = everyConsumer(pop('results', F()))
    expect(c.hub.pricedNoCostIds).toEqual(['priced-nocost'])
    // A segment missing its count no longer blocks a survey: only the survey
    // with no delivered N of its own is one field from the margin set.
    expect(c.hub.pricedBlockedIds.sort()).toEqual(['priced-no-n'])
    expect(c.hub.surveysNoPrice).toBe(1)
    expect(c.hub.spendNoPrice).toBe(2100)
    // The empty shell, the undated survey (a range is set) and every
    // undelivered class never reach the margin set.
    for (const id of ['ph-empty', 'undated', 'cancelled', 'live', 'hold', 'scoping']) {
      expect(c.ids).not.toContain(id)
    }
  })
})

describe('one revenue figure, to the cent, in every consumer', () => {
  const STATES: [string, FinanceFilter][] = [
    ['since 1 June', F()],
    ['all time', F({ range: ALL })],
    ['this month', F({ range: { preset: 'this-month', from: null, to: null } })],
    ['last month', F({ range: { preset: 'last-month', from: null, to: null } })],
    ['this quarter', F({ range: { preset: 'this-quarter', from: null, to: null } })],
    ['custom July', F({ range: { preset: 'custom', from: '2026-07-01', to: '2026-07-31' } })],
    ['BAM', F({ account: 'bam' })],
    ['Coatue, all time', F({ range: ALL, account: 'coa' })],
    ['blast', F({ route: 'blast' })],
    ['panel', F({ route: 'panel' })],
    ['no field rows', F({ route: 'none' })],
    ['blast, all time', F({ range: ALL, route: 'blast' })],
    ['BAM panel, all time', F({ range: ALL, account: 'bam', route: 'panel' })],
    ['UBS', F({ account: 'ubs' })],
  ]

  for (const [label, f] of STATES) {
    it(`agrees under "${label}"`, () => {
      const c = everyConsumer(pop('results', f))
      for (const [what, figures] of Object.entries({ revenue: c.revenue, cost: c.cost, kept: c.kept })) {
        const want = cents(figures.hub)
        for (const [consumer, v] of Object.entries(figures)) {
          expect(cents(v), `${what}: ${consumer} disagrees with the hub under "${label}"`).toBe(want)
        }
      }
      expect(c.setIds.pnl).toEqual(c.ids)
      expect(c.setIds.drill).toEqual(c.ids)
      expect(c.setIds.months).toEqual(c.ids)
    })
  }

  it('All time adds the undated survey, and only it', () => {
    const since = everyConsumer(pop('results', F()))
    const all = everyConsumer(pop('results', F({ range: ALL })))
    expect(all.ids.filter(id => !since.ids.includes(id))).toEqual(['undated'])
    expect(all.hub.revenue - since.hub.revenue).toBe(1200)
  })

  it('the month rows and the Undated row add up to the Total row', () => {
    const m = monthTable(pop('results', F({ range: ALL })), rates, blasts, suppliers, costs)
    const rows = [...m.periods, ...(m.undated ? [m.undated] : [])]
    expect(cents(sum(rows.map(r => r.spend)))).toBe(cents(m.total.spend))
    expect(cents(sum(rows.map(r => r.margin.kept)))).toBe(cents(m.total.margin.kept))
    expect(m.undated?.ids).toEqual(['undated'])
  })
})

describe('every drill reconciles to the figure that opened it', () => {
  const rows = pop('results', F({ range: ALL }))
  const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, accounts)
  const ok = (r: ReturnType<typeof reconcile>) => {
    expect(r.missingIds, 'ids the figure counted and the drill dropped').toEqual([])
    expect(r.extraIds, 'rows the figure never counted').toEqual([])
    expect(r.sumAgrees, `rows add to ${r.rowSum}, figure says ${r.expectedTotal}`).toBe(true)
    expect(r.ok).toBe(true)
  }

  it('margin: the drill rows against marginOf', () => {
    const m = marginOf(rows, rates, blasts, suppliers, costs)
    ok(reconcile({ rows: marginRows(pnl), expectedTotal: m.margin, expectedIds: m.ids }))
  })

  it('foregone: the per-survey shortfalls against foregone()', () => {
    const g = foregone(rows, rates)
    // short: 100 × $3; partial: the survey's 280 of 600, 320 short at $3. Not
    // seg (90 of 90) and not buysell (200 of 200): a segment short while
    // another is over is not a shortfall on the invoice.
    expect(g.dollars).toBe(300 + 960)
    expect(g.ids.sort()).toEqual(['partial', 'short'])
    ok(reconcile({ rows: foregoneRows(pnl), expectedTotal: g.dollars, expectedIds: g.ids }))
  })

  it('scrub and over-delivery: the drill rows against moneyLost()', () => {
    const l = moneyLost(rows, blasts, suppliers, costs)
    ok(reconcile({ rows: scrubRows(pnl), expectedTotal: l.scrub.dollars, expectedIds: l.scrub.ids }))
    ok(reconcile({ rows: overTargetRows(pnl), expectedTotal: l.overTarget.dollars, expectedIds: l.overTarget.ids }))
    // Over the TOP of the SURVEY's range — the rule that caps the bill: 'over'
    // delivered 10 past 120 and 'free' 20 past 500. Not 'seg' (segment A's 60
    // of 50 inside a survey of 90 of 90) and not 'buysell' (Buyers 120 of 100
    // inside 200 of 200): the invoice never saw the segments.
    expect(l.overTarget.ids.sort()).toEqual(['free', 'over'])
    expect(l.overTarget.n).toBe(30)
    // 'partial' is in neither: its 900 bought less its 280 would be one
    // uncounted segment booked as scrub. It is listed apart, with its money.
    expect(l.scrub.ids).not.toContain('partial')
    expect(l.partialRollUp).toEqual({ surveys: 1, spend: 900, collected: 900, ids: ['partial'] })
    // over's 10 at its own cost per complete: $8,020 over 160 paid completes.
    const overRow = overTargetRows(pnl).find(r => r.id === 'over')!
    expect(overRow.contribution).toBeCloseTo(10 * (8020 / 160), 9)
  })

  it('billed N + over-delivered N = delivered N on every export row, segmented or not', () => {
    const csv = buildFinanceCsv(pnl, FIN_COLUMNS, new Map(rows.map(p => [p.id, p])))
    const lines = csv.split('\r\n')
    const cols = lines[0].split(',')
    const at = (h: string) => cols.indexOf(h)
    let checked = 0
    for (const line of lines.slice(1)) {
      const c = line.split(',')
      const [billed, over, actual] = ['Billed N', 'Over-target N', 'N actual (post-QA)'].map(h => c[at(h)])
      if (billed === '' || over === '' || actual === '') continue
      expect(Number(billed) + Number(over), `row ${c[0]}`).toBe(Number(actual))
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(8)
    // seg: 90 billed, 0 over, 90 delivered, 0 short — on the survey. Segment by
    // segment it read 80 billed, 10 over and 10 short.
    const seg = pnl.find(r => r.id === 'seg')!
    expect([seg.billableN, seg.overN, seg.actual, seg.shortN]).toEqual([90, 0, 90, 0])
  })

  it('the project page states the same over-delivery as the hub, survey by survey', () => {
    for (const r of pnl.filter(x => x.overN != null)) {
      const p = rows.find(x => x.id === r.id)!
      expect(overage(widgetSurvey(p), rates.get(p.id) ?? null).n, r.id).toBe(r.overN)
    }
  })

  it('CPQR: each route card against its route spend summed off the raw rows', () => {
    // The card and the drill rows both come from contributingLegs, so the old
    // check (rows against c.spend) could never fail. routeSpendOfIds never
    // calls legsOf, spendOf or contributingLegs.
    const { rates: cards } = cpqrWithCoverage(rows, blasts, suppliers, costs)
    expect(cards.length).toBeGreaterThan(0)
    for (const c of cards) {
      const independent = routeSpendOfIds(c.ids, c.route, blasts, suppliers, costs)
      expect(cents(independent)).toBe(cents(c.spend))
      ok(reconcile({ rows: cpqrRows(pnl, c.route), expectedTotal: independent, expectedIds: c.ids }))
    }
  })

  it('CPQR on a survey fielded both ways: the check turns red on the old whole-bill bug', () => {
    // A mixed survey with its delivered split recorded and its flat cost routed.
    const mixed = P({
      id: 'mix', deliver_date: '2026-09-15', n_target: 200, n_actual: 200, n_collected: 220,
      n_actual_panel: 150, n_actual_blast: 50, n_actual_split_method: 'transaction_id',
    })
    const single = P({ id: 'solo', project_type: 'PS', deliver_date: '2026-09-16', n_target: 100, n_actual: 90, n_collected: 100 })
    const mb = [blast('mix', 40, 60)]
    const ms = [panel('mix', 2, 160), panel('solo', 3, 100)]
    const mc: FinCost[] = [
      { project_id: 'mix', amount: 500, kind: 'contacts_export', route: 'blast' },
      { project_id: 'mix', amount: -100, kind: 'sms_email_blast', route: 'blast' },
      { project_id: 'solo', amount: 50, kind: 'other' },
    ]
    const book = [mixed, single]
    // The partition invariant, on every survey: nothing lost, nothing doubled.
    for (const p of book) {
      const l = legsOf(p, mb, ms, mc)
      expect(cents(l.legs.reduce((t, x) => t + x.spend, 0) + l.unrouted)).toBe(cents(spendOf(p, mb, ms, mc).total))
    }
    const mpnl = surveyPnl(book, new Map(), mb, ms, mc, accounts)
    const cards = cpqrWithCoverage(book, mb, ms, mc).rates
    const panelCard = cards.find(c => c.route === 'panel')!
    const blastCard = cards.find(c => c.route === 'blast')!
    // panel: mix 2×160 + solo 3×100 + solo's $50 line. blast: 40×60 + 500 − 100.
    expect(routeSpendOfIds(panelCard.ids, 'panel', mb, ms, mc)).toBe(320 + 300 + 50)
    expect(routeSpendOfIds(blastCard.ids, 'blast', mb, ms, mc)).toBe(2400 + 500 - 100)
    for (const c of cards) {
      ok(reconcile({ rows: cpqrRows(mpnl, c.route), expectedTotal: routeSpendOfIds(c.ids, c.route, mb, ms, mc), expectedIds: c.ids }))
    }
    // The bug 117 closed: a mixed survey's WHOLE bill on its panel row.
    const wrong = cpqrRows(mpnl, 'panel').map(r => (r.id === 'mix' ? { ...r, contribution: mpnl.find(x => x.id === 'mix')!.cost } : r))
    expect(reconcile({ rows: wrong, expectedTotal: routeSpendOfIds(panelCard.ids, 'panel', mb, ms, mc), expectedIds: panelCard.ids }).ok).toBe(false)
  })

  it('budget breaches: against the raw rows less the budgets on the survey records', () => {
    const v = budgetVariance(rows, blasts, suppliers, costs, accounts)
    const budget = new Map(rows.map(p => [p.id, Number(p.budget ?? 0)]))
    const expected = spendOfIds(v.ids, blasts, suppliers, costs) - sum(v.ids.map(id => budget.get(id) ?? 0))
    expect(v.ids.sort()).toEqual(['over', 'short'])
    ok(reconcile({ rows: breachRows(v.breaches), expectedTotal: expected, expectedIds: v.ids }))
  })

  it('unpriced spend: the P&L rows against the hub, which gets there another way', () => {
    // On a delivered population the hub's spendNoPrice and the P&L's unpriced
    // rows are the same money reached by two different code paths.
    const m = marginOf(rows, rates, blasts, suppliers, costs)
    const u = unpricedSpend(pnl)
    ok(reconcile({ rows: unpricedRows(pnl), expectedTotal: m.spendNoPrice, expectedIds: u.accounts.flatMap(a => a.ids) }))
  })

  it('live exposure (This week): against the raw rows, and it ignores the date', () => {
    const live = pop('this-week', F({ range: { preset: 'last-month', from: null, to: null } }))
    const e = liveExposure(live, blasts, suppliers, costs, accounts, { canViewFinancials: true })
    // Launched in March and still spending: the date range does not hide it.
    expect(e.map(x => x.id)).toEqual(['live'])
    const ids = e.map(x => x.id)
    ok(reconcile({ rows: exposureRows(e), expectedTotal: spendOfIds(ids, blasts, suppliers, costs), expectedIds: ids }))
    // Hold sits beside live work, never inside it.
    expect(sideBucketFor(items, 'this-week', F(), TODAY).map(i => i.p.id)).toEqual(['hold'])
    expect(live.map(p => p.id)).not.toContain('hold')
  })

  it('a lever drill built from the lever population reconciles; one filtered down to another view turns RED', () => {
    // The lever population: delivered + live work in the window (All time, so
    // the live survey placed in March is in it).
    const savePop = populationByRule(items, LEVER_RULE, F({ range: ALL }), TODAY).map(i => i.p)
    const savePnl = surveyPnl(savePop, rates, blasts, suppliers, costs, accounts)
    const lever = { ids: ['over', 'seg', 'live'] }
    ok(reconcile({
      rows: leverRows(lever, savePnl),
      expectedTotal: spendOfIds(lever.ids, blasts, suppliers, costs),
      expectedIds: lever.ids,
    }))
    // The old bug: rows taken from a route=panel view. Every id the lever
    // counted is missing, and the strip must say so rather than "0 rows ✓".
    const panelPnl = surveyPnl(pop('results', F({ route: 'panel' })), rates, blasts, suppliers, costs, accounts)
    const wrong = reconcile({
      rows: leverRows(lever, panelPnl),
      expectedTotal: spendOfIds(lever.ids, blasts, suppliers, costs),
      expectedIds: lever.ids,
    })
    expect(wrong.ok).toBe(false)
    expect(wrong.missingIds.sort()).toEqual(['live', 'over', 'seg'])
  })
})

describe('a segmented survey is billed as the invoice bills it (David, 2026-09-27)', () => {
  // "when we bill its just the n actual. we dont break it out usually on the
  // invoice by segment." Buyers 100 sold / 120 delivered, Sellers 100 sold / 80
  // delivered, survey n_actual 200: billed N 200, 0 over-delivered and 0 short
  // in EVERY consumer, and the project page's billed figure agrees to the cent.
  const rows = pop('results', F({ range: ALL }))
  const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, accounts)
  const byId = new Map(rows.map(p => [p.id, p]))
  const p = byId.get('buysell') as FinProject
  const row = pnl.find(r => r.id === 'buysell')!
  const rate = rates.get('buysell')!
  /** One cell of the exported FILE for a survey, not the row handed to it. */
  const csvCell = (id: string, header: string): string => {
    const lines = buildFinanceCsv(pnl.filter(r => r.id === id), FIN_COLUMNS, byId).split('\r\n')
    const at = lines[0].split(',').indexOf(header)
    expect(at, `export has a "${header}" column`).toBeGreaterThanOrEqual(0)
    return lines[1].split(',')[at]
  }

  it('revenue.ts: billed 200 at the survey rate, nothing over, nothing short', () => {
    expect(revenueDetail(p, rate)).toMatchObject({ billedN: 200, revenue: 4000, reason: 'ok', nSource: 'survey' })
    expect(billedNOf(p)).toBe(200)
    expect(overDeliveredOf(p)).toBe(0)
    expect(shortfallOf(p, rate)).toEqual({ n: 0, dollars: 0 })
    expect(segmentsDisagree(p)).toBe(false)
  })

  it('the hub: in the margin set at $4,000, and in neither over-delivery nor foregone', () => {
    const m = marginOf(rows, rates, blasts, suppliers, costs)
    expect(m.ids).toContain('buysell')
    const l = moneyLost(rows, blasts, suppliers, costs)
    expect(l.overTarget.ids).not.toContain('buysell')
    // Its 30 scrubbed completes are real, and are the only N it lost.
    expect(l.scrub.ids).toContain('buysell')
    expect(foregone(rows, rates).ids).not.toContain('buysell')
  })

  it('the per-survey P&L, its drills, the month table and the account table', () => {
    expect(row).toMatchObject({
      actual: 200, billableN: 200, overN: 0, shortN: 0, shortValue: null,
      revenue: 4000, margin: 4000 - 2300, inMargin: true, segmentsDisagree: false,
    })
    expect(overTargetRows(pnl).map(r => r.id)).not.toContain('buysell')
    expect(foregoneRows(pnl).map(r => r.id)).not.toContain('buysell')
    expect(marginRows(pnl).find(r => r.id === 'buysell')?.contribution).toBe(4000 - 2300)
    const one = [p]
    expect(monthTable(one, rates, blasts, suppliers, costs).total.margin.revenue).toBe(4000)
    expect(accountPnl(surveyPnl(one, rates, blasts, suppliers, costs, accounts))[0].revenue).toBe(4000)
    // The CPQR card divides by the same 200.
    expect(row.cpqrLegs.map(l => l.delivered)).toEqual([200])
  })

  it('the CSV export writes 200 billed, 0 over and 0 short', () => {
    expect(csvCell('buysell', 'Billed N')).toBe('200')
    expect(csvCell('buysell', 'Over-target N')).toBe('0')
    expect(csvCell('buysell', 'Shortfall N')).toBe('0')
    expect(csvCell('buysell', 'N actual (post-QA)')).toBe('200')
    expect(csvCell('buysell', 'Revenue')).toBe('4000')
    expect(csvCell('buysell', 'Segment check')).toBe('Segments add up')
  })

  it('the credit valuation reads the same billed N and revenue', () => {
    expect(billableN(p)).toBe(200)
    expect(creditRevenue(p, rate, new Map()).revenue).toBe(4000)
  })

  it("the project page's billed figure agrees with the hub to the cent", () => {
    const s = widgetSurvey(p)
    expect(billedFor(s, rate)).toMatchObject({ billedN: 200, revenue: 4000, reason: 'ok' })
    expect(cents(invoicedBillable(s, rate) as number)).toBe(cents(row.revenue as number))
    expect(cents(invoicedBillable(s, rate) as number)).toBe(cents(marginRows(pnl).find(r => r.id === 'buysell')!.revenue as number))
    expect(overage(s, rate)).toEqual({ n: 0, dollars: 0 })
  })

  it('would fail on the old per-segment arithmetic, so it is testing something', () => {
    // Σ min(segment delivered, segment sold) = 100 + 80 = 180 billed, 20 over
    // (Buyers) and 20 short (Sellers): what the page used to say.
    const segs = p.segments ?? []
    const perSegment = segs.reduce((t, s) => t + Math.min(Number(s.n_actual), Number(s.n_target)), 0)
    expect(perSegment).toBe(180)
    expect(row.billableN).not.toBe(perSegment)
  })

  it('a segment priced differently changes no figure, and is a note', () => {
    const seg = byId.get('seg') as FinProject
    expect(segmentPriceDiffers(seg, rates.get('seg'))).toBe(true)
    expect(pnl.find(r => r.id === 'seg')).toMatchObject({ revenue: 9000, rate: 100, segmentPriceDiffers: true })
    expect(invoicedBillable(widgetSurvey(seg), rates.get('seg') ?? null)).toBe(9000)
    expect(csvCell('seg', 'Price status')).toBe('Priced; a segment is priced differently and the bill uses the study rate')
  })

  it('segment counts that do not add up block nothing on the bill, and are a note (PR00231)', () => {
    const partial = byId.get('partial') as FinProject
    expect(segmentsDisagree(partial)).toBe(true)
    expect(pnl.find(r => r.id === 'partial')).toMatchObject({
      revenue: 840, billableN: 280, inMargin: true, segmentsDisagree: true, segmentsMissingN: 1, partialRollUp: true,
    })
    expect(invoicedBillable(widgetSurvey(partial), rates.get('partial') ?? null)).toBe(840)
    expect(csvCell('partial', 'Segment check')).toBe('1 of 2 segments has no N actual; the study N actual adds up only the others; CPQR and Scrub N left blank')
    const worklist = exceptions(pnl, budgetVariance(rows, blasts, suppliers, costs, accounts), { book: new Map() }, { canViewFinancials: false })
    expect(worklist.find(e => e.id === 'partial')?.badges).toContain('segment-counts')
  })

  it('a partial segment roll-up is left out of EVERY per-respondent figure, and each one names it', () => {
    // The reviewer's live finding (28 Sep): PR00231 counted at its one
    // segment's N moved the panel CPQR card, the scrub, the month table's panel
    // cost per N and the top of the worklist. Each consumer is checked here,
    // against the same survey, so none of them can quietly admit it again.
    const cards = cpqrWithCoverage(rows, blasts, suppliers, costs)
    const panelCard = cards.rates.find(c => c.route === 'panel')!
    expect(panelCard.ids).not.toContain('partial')
    expect(panelCard.partialHeldOut).toBe(1)
    expect(cards.partialRollUp).toEqual({ surveys: 1, spend: 900, collected: 900, ids: ['partial'] })
    expect(cpqrRows(pnl, 'panel').map(r => r.id)).not.toContain('partial')
    const row = pnl.find(r => r.id === 'partial')!
    expect(row.cpqr).toBeNull()
    expect(row.cpqrLegs).toEqual([])
    expect(scrubRows(pnl).map(r => r.id)).not.toContain('partial')
    expect(moneyLost(rows, blasts, suppliers, costs).partialRollUp.ids).toEqual(['partial'])
    expect(csvCell('partial', 'Scrub N')).toBe('')
    expect(csvCell('partial', 'CPQR')).toBe('')
    const sep = monthTable(rows, rates, blasts, suppliers, costs).periods.find(p => p.key === '2026-09')!
    expect(sep.nPartial).toBe(1)
    // In September's delivered N (it is what was billed) and not in its cost per N.
    const panelSep = pnl.filter(r => r.lifecycle === 'delivered' && r.date?.startsWith('2026-09') && r.route === 'panel' && r.cost > 0 && r.actual != null && !r.partialRollUp)
    expect(sep.byRoute.panel.costedN).toBe(sum(panelSep.map(r => r.actual as number)))
    expect(cents(sep.byRoute.panel.costedSpend)).toBe(cents(sum(panelSep.map(r => r.cost))))
    // The bill is untouched: revenue, billed N and the margin set keep it.
    expect(marginOf(rows, rates, blasts, suppliers, costs).ids).toContain('partial')
    expect(revenueDetail(byId.get('partial') as FinProject, rates.get('partial'))).toMatchObject({ revenue: 840, billedN: 280 })
  })

  it('a TYPED survey N actual whose segments disagree stays in every per-respondent figure', () => {
    // PR00257 / PR00288 / PR00230 shape: 500 typed on the survey, the counted
    // segment says 342. One small book of its own so the totals above stand.
    const typed = P({
      id: 'typed', project_type: 'PS', deliver_date: '2026-09-08', n_target: 500, n_actual: 500, n_collected: 700,
      segments: [
        SEG('typed', 't-a', { n_target: 250, n_actual: 342 }),
        SEG('typed', 't-b', { n_target: 250, n_actual: null }),
      ],
    })
    const ts = [panel('typed', 1, 700)]
    const tpnl = surveyPnl([typed], new Map(), [], ts, [], accounts)
    const card = cpqrWithCoverage([typed], [], ts, []).rates[0]
    expect(card).toMatchObject({ ids: ['typed'], qualified: 500, partialHeldOut: 0 })
    expect(tpnl[0]).toMatchObject({ cpqr: 700 / 500, partialRollUp: false, segmentsDisagree: true })
    const l = moneyLost([typed], [], ts, [])
    expect(l.scrub).toMatchObject({ ids: ['typed'], n: 200 })
    expect(reconcile({ rows: scrubRows(tpnl), expectedTotal: l.scrub.dollars, expectedIds: l.scrub.ids }).ok).toBe(true)
    expect(monthTable([typed], new Map(), [], ts, []).total).toMatchObject({ costedN: 500, nPartial: 0 })
  })

  it('a blank survey N actual rolls up from a full set of segment counts, on every consumer', () => {
    const rolled = P({
      id: 'rolled', deliver_date: '2026-09-12', n_target: 200, n_actual: null, n_collected: 230,
      segments: [
        SEG('rolled', 'r-buy', { n_target: 100, n_actual: 120 }),
        SEG('rolled', 'r-sell', { n_target: 100, n_actual: 80 }),
      ],
    })
    const rr = new Map([['rolled', 20]])
    const rb = [blast('rolled', 10, 230)]
    expect(revenueDetail(rolled, 20)).toMatchObject({ revenue: 4000, billedN: 200, nSource: 'segments' })
    const r = surveyPnl([rolled], rr, rb, [], [], accounts)[0]
    expect(r).toMatchObject({ actual: 200, actualSource: 'segments', billableN: 200, overN: 0, shortN: 0, revenue: 4000 })
    expect(marginOf([rolled], rr, rb, [], []).revenue).toBe(4000)
    expect(invoicedBillable(widgetSurvey(rolled), 20)).toBe(4000)
    expect(buildFinanceCsv([r], FIN_COLUMNS).split('\r\n')[1]).toContain('Study N actual blank; rolled up from the segments')
  })
})

describe('the populations the page actually builds', () => {
  const ids = (xs: FinItem[]) => xs.map(i => i.p.id)
  const ok = (r: ReturnType<typeof reconcile>) =>
    expect(r.ok, `missing ${r.missingIds} · extra ${r.extraIds} · rows ${r.rowSum} against ${r.expectedTotal}`).toBe(true)
  const view = (f: FinanceFilter, x: Partial<Parameters<typeof viewPopulations>[3]> = {}) =>
    viewPopulations(items, f, TODAY, { classes: ['delivered'], ...x })

  it('are the tested rule populations, under every filter state', () => {
    for (const f of [F(), F({ range: ALL }), F({ account: 'coa' }), F({ route: 'blast' }),
      F({ range: { preset: 'this-month', from: null, to: null } }), F({ range: { preset: 'last-month', from: null, to: null } })]) {
      const v = view(f)
      expect(ids(v.rows)).toEqual(ids(populationFor(items, 'results', f, TODAY)))
      expect(ids(v.savePop)).toEqual(ids(populationByRule(items, LEVER_RULE, f, TODAY)))
      expect(ids(v.liveRows.filter(i => i.cls === 'active'))).toEqual(ids(populationFor(items, 'this-week', f, TODAY)))
      expect(ids(v.liveRows.filter(i => i.cls === 'hold'))).toEqual(ids(sideBucketFor(items, 'this-week', f, TODAY)))
    }
  })

  it('keep live work due after today in the default view', () => {
    const v = view(F())
    // The savings levers and the lifecycle chips are built from these.
    expect(ids(v.savePop)).toContain('live-next')
    expect(ids(v.rowsAnyLife)).toContain('live-next')
    // The live survey placed in March is before the window, as it should be.
    expect(ids(v.savePop)).not.toContain('live')
    // And the lever figures reconcile on that population.
    const savePop = v.savePop.map(i => i.p)
    const savePnl = surveyPnl(savePop, rates, blasts, suppliers, costs, accounts)
    const lever = { ids: ['over', 'live-next'] }
    ok(reconcile({ rows: leverRows(lever, savePnl), expectedTotal: spendOfIds(lever.ids, blasts, suppliers, costs), expectedIds: lever.ids }))
  })

  it('the lifecycle chips select one class, or all of them', () => {
    expect(ids(view(F({ range: ALL }), { classes: ['cancelled'] }).rows)).toEqual(['cancelled'])
    expect(ids(view(F({ range: ALL }), { classes: LIFECYCLES }).rows)).toEqual(ids(view(F({ range: ALL })).rowsAnyLife))
  })

  it('apply the type and contact on top, and the pickers count without their own filter', () => {
    const v = view(F({ range: ALL, account: 'coa' }), { type: 'PS' })
    expect(ids(v.rows).sort()).toEqual(['short'])
    // The account picker counts every account under the type; the contact
    // picker counts the account without a contact.
    expect(ids(v.rowsNoAccount).sort()).toEqual(['free', 'loss', 'partial', 'short'])
    const withContact = view(F({ range: ALL, account: 'coa' }), { contactId: 'NONE' })
    expect(ids(withContact.rows).sort()).toEqual(['priced-nocost', 'short', 'undated'])
    expect(ids(withContact.rowsNoContact).sort()).toEqual(['priced-nocost', 'short', 'undated'])
  })
})

describe('a reader without the finance capability', () => {
  const rows = pop('results', F({ range: ALL }))
  const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, accounts)
  const v = budgetVariance(rows, blasts, suppliers, costs, accounts)

  it('gets a worklist with no row that exists because of a price or a budget', () => {
    const med = new Map(cpqrWithCoverage(rows, blasts, suppliers, costs).rates.map(c => [c.route, c.median] as const))
    const holder = exceptions(pnl, v, { book: med }, { canViewFinancials: true })
    expect(holder.some(e => e.badges.some(b => FINANCE_BADGES.includes(b)))).toBe(true)
    const analyst = exceptions(pnl, v, { book: med }, { canViewFinancials: false })
    for (const e of analyst) {
      expect(e.badges.filter(b => FINANCE_BADGES.includes(b)), e.id).toEqual([])
      expect(e.items.filter(i => FINANCE_BADGES.includes(i.badge)), e.id).toEqual([])
    }
  })

  it('sees live exposure past target only, with no budget on the row or in the words', () => {
    const live = pop('this-week', F())
    const e = liveExposure(live, blasts, suppliers, costs, accounts, { canViewFinancials: false })
    expect(e.map(x => x.id)).toEqual(['live'])
    expect(e[0].budget).toBeNull()
    expect(e[0].reasons).toEqual(['20 completes past target'])
    // The holder sees the ceiling as well.
    const h = liveExposure(live, blasts, suppliers, costs, accounts, { canViewFinancials: true })
    expect(h[0].reasons[0]).toBe('210% of its ceiling')
  })
})

describe('the classifier decides what any figure can see', () => {
  it('a placeholder with data is delivered work; an empty one is nowhere', () => {
    const all = items.map(i => i.p.id)
    expect(all).toContain('ph-data')
    expect(all).not.toContain('ph-empty')
    expect(items.find(i => i.p.id === 'ph-data')?.cls).toBe('delivered')
  })

  it('cancelled, held and scoping work never enters a live or delivered total', () => {
    for (const tab of ['results', 'per-respondent', 'improve', 'this-week'] as FinanceTab[]) {
      const ids = pop(tab, F({ range: ALL })).map(p => p.id)
      for (const id of ['cancelled', 'hold', 'scoping', 'ph-empty']) expect(ids).not.toContain(id)
    }
  })

  it('cancelled spend is reported apart from the margin, never inside it', () => {
    // The hub is handed every class here, as the page's "all" view does.
    const m = marginOf(projects, rates, blasts, suppliers, costs)
    expect(m.cancelledCost).toBe(50)
    expect(m.ids).not.toContain('cancelled')
    expect(cents(m.marginAfterCancelled)).toBe(cents(m.margin - 50))
  })
})

import { describe, it, expect } from 'vitest'
import {
  inLifecycle, lifecycleCounts, parseLifecycle, budgetVariance, liveExposure, holds,
  surveyPnl, accountPnl, exceptions, monthly, monthTable, bidLadder, backlog, unpricedSpend,
  budgetVsPrice,
} from './analysis'
import type { FinBlast, FinCost, FinProject, FinSupplier, Route } from './hub'

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'BAM', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, ...o,
})
const B = (project_id: string, bid: number, completes: number, people = 0): FinBlast =>
  ({ project_id, bid, completes, people, cost_per_send: 0, channel: 'sms' })
const S = (project_id: string, cpi: number, n_collected: number): FinSupplier =>
  ({ project_id, cpi, n_collected })
const ACC = new Map([['acc1', 'BAM'], ['acc2', 'DE Shaw']])
const NONE = { breaches: [], overrun: 0, underSurveys: 0, headroom: 0, measurable: 0, noCost: 0, ids: [] }
/** A reader with the finance capability — what every case here is written
 *  from, unless it says otherwise. */
const FIN = { canViewFinancials: true }
const ANALYST = { canViewFinancials: false }

describe('lifecycle: the classifier, read by the page', () => {
  it('counts every survey exactly once, in the classifier\'s classes', () => {
    const rows = [
      P({ id: 'a' }),
      P({ id: 'b', board_column: 'Fielding', status: 'Cancelled' }),
      P({ id: 'c', board_column: 'Fielding', status: 'Open' }),
      P({ id: 'd', board_column: 'Data QA', status: 'Closed' }),
      P({ id: 'e', board_column: 'Fielding', status: 'Hold' }),
      P({ id: 'f', board_column: 'Submitted', status: 'Open', phase: 'Scoping' }),
    ]
    const c = lifecycleCounts(rows, [], [], [])
    expect(c.reduce((t, x) => t + x.surveys, 0)).toBe(6)
    const by = Object.fromEntries(c.map(x => [x.key, x.surveys]))
    expect(by).toEqual({ delivered: 1, active: 1, hold: 1, cancelled: 1, archived: 1, scoping: 1 })
  })

  it('never counts an empty rerun placeholder anywhere', () => {
    const c = lifecycleCounts([P({ id: 'x', is_placeholder: true })], [], [], [])
    expect(c.reduce((t, x) => t + x.surveys, 0)).toBe(0)
  })

  it('filters by class, and `all` filters nothing but placeholders', () => {
    expect(inLifecycle('cancelled', 'cancelled')).toBe(true)
    expect(inLifecycle('cancelled', 'delivered')).toBe(false)
    expect(inLifecycle('hold', 'all')).toBe(true)
    expect(inLifecycle('placeholder', 'all')).toBe(false)
  })

  it('reads old URL values, and falls back instead of emptying the page on a bad one', () => {
    expect(parseLifecycle('inflight')).toBe('active')
    expect(parseLifecycle('abandoned')).toBe('archived')
    expect(parseLifecycle('hold')).toBe('hold')
    expect(parseLifecycle('nonsense')).toBe('delivered')
    expect(parseLifecycle(null)).toBe('delivered')
  })
})

describe('budgetVariance: gross, never netted', () => {
  it('reports overrun and headroom SEPARATELY', () => {
    const rows = [
      P({ id: 'over', budget: 100 }),
      P({ id: 'under', budget: 500 }),
    ]
    const v = budgetVariance(rows, [B('over', 1, 150), B('under', 1, 100)], [], [], ACC)
    expect(v.overrun).toBe(50)
    expect(v.headroom).toBe(400)
    expect(v).toMatchObject({ measurable: 2, underSurveys: 1 })
    expect(v.breaches).toHaveLength(1)
    expect(v.breaches[0]).toMatchObject({ code: 'PR00001', over: 50, pct: 1.5 })
  })

  it('counts a ceiling with no recorded cost as unmeasurable, not as compliant', () => {
    const v = budgetVariance([P({ id: 'x', budget: 100 })], [], [], [], ACC)
    expect(v).toMatchObject({ noCost: 1, measurable: 0, overrun: 0 })
  })

  it('ignores a survey with no ceiling rather than treating 0 as one', () => {
    const v = budgetVariance([P({ id: 'x', budget: null })], [B('x', 1, 10)], [], [], ACC)
    expect(v.measurable).toBe(0)
  })

  it('worst breach first, by ratio not by dollars', () => {
    const rows = [P({ id: 'a', budget: 1000 }), P({ id: 'b', budget: 10 })]
    const v = budgetVariance(rows, [B('a', 1, 1500), B('b', 1, 100)], [], [], ACC)
    expect(v.breaches.map(b => b.id)).toEqual(['b', 'a'])
  })
})

describe('liveExposure: only what is still moving', () => {
  it('flags a live survey past its ceiling', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', budget: 100 })]
    const e = liveExposure(rows, [B('x', 1, 300)], [], [], ACC, FIN)
    expect(e).toHaveLength(1)
    expect(e[0].reasons[0]).toContain('300%')
  })

  it('flags a live survey past its target', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', n_target: 100, n_collected: 250 })]
    const e = liveExposure(rows, [], [S('x', 2, 250)], [], ACC, FIN)
    expect(e[0].overTargetN).toBe(150)
    expect(e[0].overTargetCost).toBeCloseTo(300)
  })

  it('says nothing about delivered work — that is history, not exposure', () => {
    const rows = [P({ id: 'x', board_column: 'Delivery', budget: 10 })]
    expect(liveExposure(rows, [B('x', 1, 300)], [], [], ACC, FIN)).toEqual([])
  })

  it('keeps a survey ON HOLD out of live exposure — it has its own bucket', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Hold', budget: 10 })]
    expect(liveExposure(rows, [B('x', 1, 300)], [], [], ACC, FIN)).toEqual([])
    expect(holds(rows, [B('x', 1, 300)], [], [])).toMatchObject({ surveys: 1, spend: 300, ids: ['x'] })
  })

  it('treats a Scoping-phase survey that is buying respondents as live (PR00443)', () => {
    const rows = [P({ id: 'x', board_column: 'Submitted', status: 'Open', phase: 'Scoping', budget: 10 })]
    expect(liveExposure(rows, [B('x', 1, 300)], [], [], ACC, FIN)).toHaveLength(1)
  })

  it('stays quiet when a live survey is within both limits', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', budget: 1000, n_target: 100, n_collected: 50 })]
    expect(liveExposure(rows, [B('x', 1, 50)], [], [], ACC, FIN)).toEqual([])
  })

  it('gives a reader without the finance capability nothing that reveals a budget', () => {
    // "300% of its ceiling" beside a $300 spend is a $100 budget. For an
    // analyst the budget adds no reason, admits no survey and rides on no row.
    const overBudgetOnly = [P({ id: 'x', board_column: 'Fielding', status: 'Open', budget: 100 })]
    expect(liveExposure(overBudgetOnly, [B('x', 1, 300)], [], [], ACC, ANALYST)).toEqual([])
    const both = [P({ id: 'y', board_column: 'Fielding', status: 'Open', budget: 100, n_target: 100, n_collected: 300 })]
    const e = liveExposure(both, [B('y', 1, 300)], [], [], ACC, ANALYST)
    expect(e).toHaveLength(1)
    expect(e[0].budget).toBeNull()
    expect(e[0].reasons).toEqual(['200 completes past target'])
    expect(e[0].reasons.join(' ')).not.toContain('ceiling')
  })
})

describe('surveyPnl', () => {
  it('computes revenue at min(actual, top of range) and margin against real cost', () => {
    const rows = [P({ id: 'x', n_target: 100, n_actual: 130, n_collected: 130 })]
    const r = surveyPnl(rows, new Map([['x', 50]]), [B('x', 10, 130)], [], [], ACC)[0]
    expect(r).toMatchObject({ billableN: 100, revenue: 5000, cost: 1300, margin: 3700, inMargin: true })
    expect(r.marginPct).toBeCloseTo(0.74)
    expect(r.account).toBe('BAM')
  })

  it('leaves revenue null — never 0 — when unpriced', () => {
    const r = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10 })], new Map(), [B('x', 1, 10)], [], [], ACC)[0]
    expect(r.revenue).toBeNull()
    expect(r.margin).toBeNull()
    expect(r.priced).toBe(false)
    expect(r.cost).toBe(10)
  })

  it('keeps a $0 price as a price — $0 revenue, −cost margin, no ratio', () => {
    const r = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10 })], new Map([['x', 0]]), [B('x', 1, 10)], [], [], ACC)[0]
    expect(r).toMatchObject({ rate: 0, priced: true, free: true, revenue: 0, margin: -10, inMargin: true })
    expect(r.marginPct).toBeNull()
    expect(r.spendPerPrice).toBeNull()
  })

  it('reports whether the survey reconciles rather than dropping it', () => {
    const ok = surveyPnl([P({ id: 'x', n_collected: 10 })], new Map(), [B('x', 1, 10)], [], [], ACC)[0]
    const bad = surveyPnl([P({ id: 'y', n_collected: 100 })], new Map(), [B('y', 1, 10)], [], [], ACC)[0]
    expect(ok.reconciled).toBe(true)
    expect(bad.reconciled).toBe(false)
  })

  it('separates CPC from CPQR on the same row', () => {
    const r = surveyPnl([P({ id: 'x', n_collected: 100, n_actual: 50 })], new Map(), [B('x', 1, 100)], [], [], ACC)[0]
    expect(r.cpc).toBeCloseTo(1)
    expect(r.cpqr).toBeCloseTo(2)
  })

  it('bills a partial segment roll-up on its own N actual, but gives it no CPQR (PR00231)', () => {
    // David, 2026-09-27: the bill is the survey's, so revenue, billed, over and
    // short all read the survey's 50. But 50 is only the counted segment, and
    // the $1,000 bought 1,000 N across both, so $20 a respondent is not a rate.
    const p = P({ id: 'x', n_target: 200, n_collected: 1000, n_actual: 50, segments: [
      { id: 'a', project_id: 'x', n_target: 100, n_actual: 50 },
      { id: 'b', project_id: 'x', n_target: 100, n_actual: null },
    ] })
    const r = surveyPnl([p], new Map([['x', 5]]), [B('x', 1, 1000)], [], [], ACC)[0]
    expect(r).toMatchObject({
      cpqr: null, cpc: 1, actual: 50, actualSource: 'survey', billableN: 50, revenue: 250, inMargin: true,
      segmentsDisagree: true, segmentsMissingN: 1, segments: 2, segmentSum: 50, partialRollUp: true,
      overN: 0, shortN: 150, shortValue: 750,
    })
    expect(r.cpqrLegs).toEqual([])
  })

  it('prices and counts a survey whose TYPED N actual disagrees with its segments, and notes it', () => {
    // The survey says 80; the counted segment says 50. 80 is a statement about
    // the whole survey, so it is the CPQR denominator too.
    const p = P({ id: 'x', n_target: 200, n_collected: 1000, n_actual: 80, segments: [
      { id: 'a', project_id: 'x', n_target: 100, n_actual: 50 },
      { id: 'b', project_id: 'x', n_target: 100, n_actual: null },
    ] })
    const r = surveyPnl([p], new Map([['x', 5]]), [B('x', 1, 1000)], [], [], ACC)[0]
    expect(r).toMatchObject({
      cpqr: 12.5, actual: 80, billableN: 80, revenue: 400,
      segmentsDisagree: true, segmentsMissingN: 1, partialRollUp: false,
    })
    expect(r.cpqrLegs.map(l => l.delivered)).toEqual([80])
  })

  it('bills Buyers/Sellers on the survey: 200 of 200 is 200 billed, 0 over, 0 short', () => {
    const p = P({ id: 'bs', n_target: 200, n_collected: 230, n_actual: 200, segments: [
      { id: 'buy', project_id: 'bs', n_target: 100, n_actual: 120 },
      { id: 'sell', project_id: 'bs', n_target: 100, n_actual: 80 },
    ] })
    const r = surveyPnl([p], new Map([['bs', 20]]), [B('bs', 10, 230)], [], [], ACC)[0]
    expect(r).toMatchObject({
      billableN: 200, overN: 0, shortN: 0, shortValue: null, revenue: 4000,
      segmentsDisagree: false, segmentPriceDiffers: false,
    })
  })

  it('notes a segment priced differently without changing the revenue', () => {
    const p = P({ id: 'sp', n_target: 100, n_collected: 100, n_actual: 100, segments: [
      { id: 'a', project_id: 'sp', n_target: 100, n_actual: 100, price_per_n: 9 },
    ] })
    const r = surveyPnl([p], new Map([['sp', 5]]), [B('sp', 1, 100)], [], [], ACC)[0]
    expect(r).toMatchObject({ revenue: 500, rate: 5, segmentPriceDiffers: true })
  })

  it('leaves empty rerun placeholders out of the P&L', () => {
    expect(surveyPnl([P({ id: 'x', is_placeholder: true })], new Map(), [], [], [], ACC)).toEqual([])
  })
})

describe('accountPnl: price and cost on ONE denominator, split by route', () => {
  it('puts cost per BILLED N beside price per billed N, so they subtract', () => {
    // Paid 150 completes, delivered 100, billed 100 at $100. Cost $3,000.
    // Per billed N: $100 price, $30 cost → we keep $70 = 70%, which the margin
    // column says too. Per PAID complete it would read $20 and suggest 80%.
    const rows = [P({ id: 'a', n_target: 100, n_actual: 100, n_collected: 150 })]
    const pnl = surveyPnl(rows, new Map([['a', 100]]), [B('a', 20, 150)], [], [], ACC)
    const a = accountPnl(pnl)[0]
    expect(a.realisedRate).toBe(100)
    expect(a.costPerBilledN).toBe(30)
    expect(a.costPerComplete).toBe(20)
    expect(a.marginPct).toBeCloseTo((a.realisedRate! - a.costPerBilledN!) / a.realisedRate!)
  })

  it('shows the pricing gap on the same route at the same cost', () => {
    const rows = [
      P({ id: 'a', client_id: 'acc1', n_target: 100, n_actual: 100, n_collected: 100 }),
      P({ id: 'b', client_id: 'acc2', n_target: 100, n_actual: 100, n_collected: 100 }),
    ]
    const pnl = surveyPnl(rows, new Map([['a', 100], ['b', 130]]),
      [B('a', 50, 100), B('b', 50, 100)], [], [], ACC)
    const acc = accountPnl(pnl)
    const bam = acc.find(x => x.account === 'BAM')!
    const ds = acc.find(x => x.account === 'DE Shaw')!
    expect(bam.realisedRate).toBe(100)
    expect(ds.realisedRate).toBe(130)
    expect(bam.costPerBilledN).toBe(ds.costPerBilledN)
    expect(bam.measured).toBe(1)
    expect(bam.routes.map(r => r.route)).toEqual(['blast'])
  })

  it('never blends routes into one per-respondent figure', () => {
    // A $3 panel price averaged with a $150 blast price describes the mix.
    const rows = [
      P({ id: 'blast', n_target: 10, n_actual: 10, n_collected: 10 }),
      P({ id: 'panel', n_target: 1000, n_actual: 1000, n_collected: 1000 }),
    ]
    const pnl = surveyPnl(rows, new Map([['blast', 150], ['panel', 3]]),
      [B('blast', 60, 10)], [S('panel', 1, 1000)], [], ACC)
    const a = accountPnl(pnl)[0]
    expect(a.realisedRate).toBeNull()
    expect(a.costPerBilledN).toBeNull()
    const blast = a.routes.find(r => r.route === 'blast')!
    const panel = a.routes.find(r => r.route === 'panel')!
    expect(blast).toMatchObject({ realisedRate: 150, costPerBilledN: 60 })
    expect(panel).toMatchObject({ realisedRate: 3, costPerBilledN: 1 })
    // ...and the route rows add back to the account.
    expect(blast.revenue + panel.revenue).toBe(a.revenue)
    expect(blast.cost + panel.cost).toBe(a.cost)
  })

  it('counts unpriced spend per account even when nothing is measurable', () => {
    const pnl = surveyPnl([P({ id: 'a', client_id: 'acc1' })], new Map(), [B('a', 10, 10)], [], [], ACC)
    const bam = accountPnl(pnl)[0]
    expect(bam).toMatchObject({ surveys: 1, measured: 0, unpricedSpend: 100, totalSpend: 100 })
    expect(bam.realisedRate).toBeNull()
  })
})

describe('exceptions: one row per survey, every badge, ranked in dollars', () => {
  const med = new Map<Route, number>([['blast', 10]])

  it('names a loss-making survey with its dollars and a verb', () => {
    const pnl = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10, n_collected: 10 })],
      new Map([['x', 1]]), [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, NONE, med, FIN)
    expect(e[0].kind).toBe('lost-money')
    expect(e[0].headline).toContain('$90')
    expect(e[0].verb).toBe('Re-price the next wave')
  })

  it('files a $0 survey as given away, not as a loss', () => {
    const pnl = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10, n_collected: 10 })],
      new Map([['x', 0]]), [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, NONE, new Map(), FIN)
    expect(e[0].badges).toEqual(['given-away'])
  })

  it('shows a loss that sits under a ceiling, and the overrun beside it — never one hiding the other', () => {
    // The old dedup kept the larger amount per survey, so a loss-maker whose
    // overrun exceeded its loss showed only as "over budget" (PR00362).
    const rows = [P({ id: 'x', budget: 50, n_target: 10, n_actual: 10, n_collected: 10 })]
    const pnl = surveyPnl(rows, new Map([['x', 8]]), [B('x', 10, 10)], [], [], ACC)
    const v = budgetVariance(rows, [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, v, med, FIN)
    expect(e.filter(x => x.id === 'x')).toHaveLength(1)
    expect(e[0].badges).toEqual(['lost-money', 'over-budget'])
    expect(e[0].kind).toBe('lost-money')
    expect(e[0].items).toHaveLength(2)
  })

  it('says an over-budget survey still made money, so the badge cannot be read as a loss', () => {
    const rows = [P({ id: 'x', budget: 50, n_target: 10, n_actual: 10, n_collected: 10 })]
    const pnl = surveyPnl(rows, new Map([['x', 20]]), [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, budgetVariance(rows, [B('x', 10, 10)], [], [], ACC), med, FIN)
    expect(e[0].badges).toEqual(['over-budget'])
    expect(e[0].detail).toContain('still made money')
  })

  it('ranks a cost outlier by TOTAL dollars above typical, not dollars per respondent', () => {
    // Outlier: CPQR $100 vs a $10 median on 100 delivered → $9,000 above typical.
    // Overrun: $50. The outlier must rank first.
    const rows = [
      P({ id: 'out', n_collected: 100, n_actual: 100 }),
      P({ id: 'over', budget: 50, n_collected: 10, n_actual: 10 }),
    ]
    const blasts = [B('out', 100, 100), B('over', 10, 10)]
    const pnl = surveyPnl(rows, new Map(), blasts, [], [], ACC)
    const e = exceptions(pnl, budgetVariance(rows, blasts, [], [], ACC), med, FIN)
    expect(e[0].id).toBe('out')
    expect(e[0].amount).toBeCloseTo(9000)
    expect(e[0].headline).toContain('$9,000 more than a typical blast study')
  })

  it('flags a CPQR outlier only when the survey reconciles', () => {
    const good = surveyPnl([P({ id: 'g', n_collected: 10, n_actual: 1 })], new Map(), [B('g', 100, 10)], [], [], ACC)
    const bad = surveyPnl([P({ id: 'b', n_collected: 999, n_actual: 1 })], new Map(), [B('b', 100, 10)], [], [], ACC)
    expect(exceptions(good, NONE, med, FIN).some(x => x.kind === 'cost-outlier')).toBe(true)
    expect(exceptions(bad, NONE, med, FIN).some(x => x.kind === 'cost-outlier')).toBe(false)
  })

  it('judges against the BOOK median and prints the slice median beside it', () => {
    const pnl = surveyPnl([P({ id: 'g', n_collected: 10, n_actual: 1 })], new Map(), [B('g', 100, 10)], [], [], ACC)
    const e = exceptions(pnl, NONE, { book: med, slice: new Map<Route, number>([['blast', 400]]) }, FIN)
    expect(e[0].kind).toBe('cost-outlier')
    expect(e[0].detail).toContain('book median of $10')
    expect(e[0].detail).toContain('in this view is $400')
  })

  it('notes segment counts that do not add up, as a data note with nothing withheld', () => {
    // A cheap survey, so the only item is the note.
    const p = P({ id: 'x', n_collected: 1000, n_actual: 500, segments: [
      { id: 'a', project_id: 'x', n_target: 100, n_actual: 500 },
      { id: 'b', project_id: 'x', n_target: 100, n_actual: null },
    ] })
    const pnl = surveyPnl([p], new Map(), [B('x', 1, 1000)], [], [], ACC)
    const e = exceptions(pnl, NONE, med, FIN)
    expect(e).toHaveLength(1)
    expect(e[0].kind).toBe('segment-counts')
    expect(e[0].verb).toBe('Make the segment N actuals add up')
    expect(e[0].headline).toBe('PR00001: 1 of 2 segments has no N actual')
    // 500 is the counted segment's sum: the reader is told what that costs them.
    expect(e[0].detail).toContain('Cost per respondent and scrub leave this study out')
    // Nothing is at stake in dollars, so it ranks below anything that is.
    expect(e[0].amount).toBe(0)
    // It is counts, not prices: an analyst gets it too.
    expect(exceptions(pnl, NONE, med, { canViewFinancials: false }).map(x => x.kind)).toEqual(['segment-counts'])
  })

  it('says which way the counts disagree when every segment has one', () => {
    const p = P({ id: 'y', n_collected: 1000, n_actual: 950, segments: [
      { id: 'a', project_id: 'y', n_target: 500, n_actual: 500 },
      { id: 'b', project_id: 'y', n_target: 500, n_actual: 400 },
    ] })
    const e = exceptions(surveyPnl([p], new Map(), [B('y', 1, 1000)], [], [], ACC), NONE, med, FIN)
    expect(e[0].headline).toBe('PR00001: the segments add up to 900 N, the study says 950')
    expect(e[0].detail).toContain("Correct the segments, or the study's N actual")
  })

  it('tells a reader to check the count before acting on a cost outlier whose segments disagree', () => {
    // A TYPED survey N actual (1) that is not the counted segment's 2.
    const p = P({ id: 'g', n_collected: 10, n_actual: 1, segments: [
      { id: 'a', project_id: 'g', n_target: 5, n_actual: 2 },
      { id: 'b', project_id: 'g', n_target: 5, n_actual: null },
    ] })
    const e = exceptions(surveyPnl([p], new Map(), [B('g', 100, 10)], [], [], ACC), NONE, med, FIN)
    expect(e[0].kind).toBe('cost-outlier')
    expect(e[0].badges).toEqual(['cost-outlier', 'segment-counts'])
    expect(e[0].detail).toContain('segment counts do not add up')
  })

  it('never calls a partial segment roll-up a cost outlier (PR00231 led the list on live data)', () => {
    // $1,000 over the one counted segment's 1 reads as $1,000 a respondent — a
    // hundred times the median — and it was the top worklist row. It is a
    // count still to be entered, and only that is on the list.
    const p = P({ id: 'g', n_collected: 10, n_actual: 1, segments: [
      { id: 'a', project_id: 'g', n_target: 5, n_actual: 1 },
      { id: 'b', project_id: 'g', n_target: 5, n_actual: null },
    ] })
    const e = exceptions(surveyPnl([p], new Map(), [B('g', 100, 10)], [], [], ACC), NONE, med, FIN)
    expect(e).toHaveLength(1)
    expect(e[0].badges).toEqual(['segment-counts'])
    expect(e[0].amount).toBe(0)
  })

  it('builds a reader without the finance capability a list with no row because of a price or a budget', () => {
    // Hiding the badge but keeping the row told an analyst which surveys went
    // over budget: the row, its rank, its verb and the count all remained.
    const rows = [
      P({ id: 'over', budget: 50, n_target: 10, n_actual: 10, n_collected: 10 }),
      P({ id: 'loss', n_target: 10, n_actual: 10, n_collected: 10 }),
      P({ id: 'out', n_collected: 100, n_actual: 100 }),
    ]
    const blasts = [B('over', 10, 10), B('loss', 10, 10), B('out', 100, 100)]
    const pnl = surveyPnl(rows, new Map([['over', 20], ['loss', 1]]), blasts, [], [], ACC)
    const v = budgetVariance(rows, blasts, [], [], ACC)
    expect(exceptions(pnl, v, med, FIN).map(x => x.id).sort()).toEqual(['loss', 'out', 'over'])
    const e = exceptions(pnl, v, med, ANALYST)
    expect(e.map(x => x.id)).toEqual(['out'])
    expect(e.flatMap(x => x.badges)).toEqual(['cost-outlier'])
    expect(e.some(x => /budget/i.test(x.verb + x.headline + x.detail))).toBe(false)
  })
})

describe('budgetVsPrice: cents per $1 of client price', () => {
  it('measures budget ÷ price on paid work and counts spend past the goal', () => {
    const rows = [
      P({ id: 'a', budget: 600, n_target: 100, n_actual: 100 }), // price $1,000, cost $700
      P({ id: 'b', budget: 400, n_target: 100, n_actual: 100 }), // price $1,000, cost $300
      P({ id: 'free', budget: 100, n_target: 100, n_actual: 100 }), // $0, cost $200 — no ratio
    ]
    const pnl = surveyPnl(rows, new Map([['a', 10], ['b', 10], ['free', 0]]),
      [B('a', 7, 100), B('b', 3, 100), B('free', 2, 100)], [], [], ACC)
    const r = budgetVsPrice(pnl)
    expect(r.n).toBe(2)
    // A true median: with two values it is their mean (0.6 and 0.4). The old
    // nearest-rank pick returned the upper one, 0.6, and this test said so.
    expect(r.medianPerDollar).toBeCloseTo(0.5, 12)
    expect(r.atOrUnderGoal).toBe(1)
    expect(r.pricedAboveZero).toBe(2)
    expect(r.spentOverGoal).toBe(1)
    // a spent $700 against a $600 budget and still made money; the free survey
    // went over its budget and did not.
    expect(r).toMatchObject({ overBudget: 2, overBudgetMadeMoney: 1 })
  })

  it('takes the middle value when the count is odd', () => {
    const rows = [
      P({ id: 'a', budget: 200, n_target: 100, n_actual: 100 }),
      P({ id: 'b', budget: 900, n_target: 100, n_actual: 100 }),
      P({ id: 'c', budget: 500, n_target: 100, n_actual: 100 }),
    ]
    const pnl = surveyPnl(rows, new Map([['a', 10], ['b', 10], ['c', 10]]),
      [B('a', 1, 100), B('b', 1, 100), B('c', 1, 100)], [], [], ACC)
    expect(budgetVsPrice(pnl).medianPerDollar).toBeCloseTo(0.5, 12)
  })
})

describe('monthly: the ledger filling in is not growth', () => {
  it('computes cost per N on the COSTED subset only', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-08-01', n_actual: 100, n_collected: 100 }),
      P({ id: 'b', deliver_date: '2026-08-02', n_actual: 900, n_collected: 900 }),
    ]
    const m = monthly(rows, new Map(), [B('a', 2, 100)], [], [])
    expect(m).toHaveLength(1)
    expect(m[0]).toMatchObject({ key: '2026-08', n: 1000, costedN: 100, spend: 200 })
    expect(m[0].costPerN).toBeCloseTo(2)
    expect(m[0].coverage).toBeCloseTo(0.5)
  })

  it('keeps a survey with no delivered N out of the denominator AND the numerator', () => {
    // It used to add its spend on top and 0 below, inflating $/N.
    const rows = [
      P({ id: 'a', deliver_date: '2026-06-01', n_actual: 100 }),
      P({ id: 'b', deliver_date: '2026-06-02', n_actual: null }),
    ]
    const m = monthly(rows, new Map(), [B('a', 2, 100), B('b', 5, 100)], [], [])
    expect(m[0].costPerN).toBeCloseTo(2)
    expect(m[0].nMissing).toBe(1)
  })

  it('keeps a partial segment roll-up out of cost per N, and counts it (PR00231)', () => {
    // On live data it lifted August's panel cost per N from $1.44 to $1.81.
    const rows = [
      P({ id: 'a', deliver_date: '2026-08-01', n_actual: 100, n_collected: 100 }),
      P({ id: 'q', deliver_date: '2026-08-02', n_actual: 40, n_collected: 900, segments: [
        { id: 's1', project_id: 'q', n_target: 50, n_actual: 40 },
        { id: 's2', project_id: 'q', n_target: 800, n_actual: null },
      ] }),
    ]
    const t = monthTable(rows, new Map(), [], [S('a', 1, 100), S('q', 1, 900)], [])
    const aug = t.periods[0]
    // The survey's figure is still in the delivered N — it is what was billed.
    expect(aug).toMatchObject({ n: 140, nPartial: 1, nMissing: 0, costedN: 100, costedSpend: 100, spend: 1000 })
    expect(aug.byRoute.panel.costPerN).toBeCloseTo(1)
    expect(aug.costPerN).toBeCloseTo(1)
    expect(t.total.nPartial).toBe(1)
  })

  it('splits cost per N by route instead of blending routes 60× apart', () => {
    const rows = [
      P({ id: 'b', deliver_date: '2026-07-01', n_actual: 10 }),
      P({ id: 'p', deliver_date: '2026-07-02', n_actual: 1000 }),
    ]
    const m = monthly(rows, new Map(), [B('b', 60, 10)], [S('p', 1, 1000)], [])
    expect(m[0].byRoute.blast.costPerN).toBeCloseTo(60)
    expect(m[0].byRoute.panel.costPerN).toBeCloseTo(1)
  })

  it('reports null cost per N for a period with no recorded cost, never 0', () => {
    const m = monthly([P({ id: 'a', deliver_date: '2026-03-01', n_actual: 500 })], new Map(), [], [], [])
    expect(m[0].costPerN).toBeNull()
    expect(m[0].n).toBe(500)
  })

  it('buckets by quarter when asked', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-07-15' }),
      P({ id: 'b', deliver_date: '2026-09-30' }),
      P({ id: 'c', deliver_date: '2026-04-01' }),
      P({ id: 'd', deliver_date: '2026-03-31' }),
      P({ id: 'e', deliver_date: '2026-12-31' }),
    ]
    expect(monthly(rows, new Map(), [], [], [], 'quarter').map(x => x.key))
      .toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'])
  })

  it('puts undated surveys in their own row, and a Total row that adds up', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-08-01' }),
      P({ id: 'u', deliver_date: null, launch_date: null, submitted_date: null }),
    ]
    const t = monthTable(rows, new Map(), [B('a', 10, 10), B('u', 5, 10)], [], [])
    expect(t.periods.map(p => p.key)).toEqual(['2026-08'])
    expect(t.undated).toMatchObject({ key: 'undated', surveys: 1, spend: 50 })
    expect(t.total).toMatchObject({ surveys: 2, spend: 150 })
  })

  it('reads revenue and cost off the SAME surveys — the margin set', () => {
    // A priced survey with no cost must not lift the month's margin: the old
    // `revenue` field covered it while spend did not, and June read −132%.
    const rows = [
      P({ id: 'both', deliver_date: '2026-06-01', n_target: 10, n_actual: 10 }),
      P({ id: 'priceOnly', deliver_date: '2026-06-02', n_target: 10, n_actual: 10 }),
      P({ id: 'costOnly', deliver_date: '2026-06-03', n_target: 10, n_actual: 10 }),
    ]
    const m = monthly(rows, new Map([['both', 100], ['priceOnly', 100]]),
      [B('both', 40, 10), B('costOnly', 30, 10)], [], [])
    expect(m[0].margin).toMatchObject({ surveys: 1, revenue: 1000, cost: 400, kept: 600, spendNoPrice: 300 })
  })
})

describe('bidLadder', () => {
  it('compares each project against its OWN lowest bid', () => {
    const rows = [P({ id: 'x' })]
    const blasts = [B('x', 10, 100, 10_000), B('x', 50, 50, 10_000)]
    const l = bidLadder(rows, blasts)!
    expect(l.projects).toBe(1)
    expect(l.base).toMatchObject({ completes: 100, costPer: 10 })
    expect(l.raised).toMatchObject({ completes: 50, costPer: 50 })
    expect(l.base.rate).toBeGreaterThan(l.raised.rate)
    expect(l.premium).toBe(2000)      // (50-10) x 50 completes
    expect(l).toMatchObject({ headToHead: 1, worseAfterRaise: 1 })
  })

  it('ignores a project that only ever ran one bid', () => {
    expect(bidLadder([P({ id: 'x' })], [B('x', 10, 5, 100), B('x', 10, 5, 100)])).toBeNull()
  })

  it('requires 500 sends in BOTH arms before calling a head-to-head', () => {
    const l = bidLadder([P({ id: 'x' })], [B('x', 10, 1, 10_000), B('x', 50, 1, 100)])!
    expect(l.headToHead).toBe(0)
  })
})

describe('backlog', () => {
  it('values live work at the N sold, and says what it cannot see', () => {
    const rows = [
      P({ id: 'a', board_column: 'Fielding', status: 'Open', n_target: 100 }),
      P({ id: 'b', board_column: 'Fielding', status: 'Open', n_target: 100 }),
      P({ id: 'c', board_column: 'Fielding', status: 'Open', n_target: null }),
    ]
    const b = backlog(rows, new Map([['a', 50], ['c', 50]]), [B('a', 1, 20)], [], [])
    expect(b).toMatchObject({ surveys: 1, revenueAtTarget: 5000, spentSoFar: 20, unpriced: 2, noTarget: 1 })
  })

  it('excludes delivered, cancelled, held and scoping work', () => {
    const rows = [
      P({ id: 'a', n_target: 100 }),
      P({ id: 'b', board_column: 'Fielding', status: 'Cancelled', n_target: 100 }),
      P({ id: 'h', board_column: 'Fielding', status: 'Hold', n_target: 100 }),
      P({ id: 's', board_column: 'Submitted', status: 'Open', phase: 'Scoping', n_target: 100 }),
    ]
    const rates = new Map([['a', 50], ['b', 50], ['h', 50], ['s', 50]])
    expect(backlog(rows, rates, [], [], []).surveys).toBe(0)
  })
})

describe('unpricedSpend', () => {
  it('ranks accounts by spend that can never reach a margin', () => {
    const rows = [
      P({ id: 'a', client_id: 'acc1' }), P({ id: 'b', client_id: 'acc1' }),
      P({ id: 'c', client_id: 'acc2' }),
    ]
    const pnl = surveyPnl(rows, new Map([['c', 10]]),
      [B('a', 10, 10), B('b', 20, 10), B('c', 1, 10)], [], [], ACC)
    const u = unpricedSpend(pnl)
    expect(u.total).toBe(300)
    expect(u.share).toBeCloseTo(300 / 310)
    expect(u.accounts[0]).toMatchObject({ account: 'BAM', surveys: 2, spend: 300 })
  })

  it('does not list a $0 trial — it has a price', () => {
    const pnl = surveyPnl([P({ id: 'a' })], new Map([['a', 0]]), [B('a', 10, 10)], [], [], ACC)
    expect(unpricedSpend(pnl).total).toBe(0)
  })

  it('counts a credit line against the spend, which is net', () => {
    const c: FinCost[] = [{ project_id: 'a', amount: -40, route: 'blast' }]
    const pnl = surveyPnl([P({ id: 'a' })], new Map(), [B('a', 10, 10)], [], c, ACC)
    expect(pnl[0]).toMatchObject({ cost: 60, recovered: -40 })
  })
})

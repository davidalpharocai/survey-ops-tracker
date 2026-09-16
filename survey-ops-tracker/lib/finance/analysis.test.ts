import { describe, it, expect } from 'vitest'
import {
  lifecycleOf, inLifecycle, lifecycleCounts, budgetVariance, liveExposure,
  surveyPnl, accountPnl, exceptions, monthly, bidLadder, backlog, unpricedSpend,
} from './analysis'
import type { FinBlast, FinProject, FinSupplier, Route } from './hub'

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

describe('lifecycle', () => {
  it('separates the four states, and puts cancelled ahead of delivered', () => {
    expect(lifecycleOf(P())).toBe('delivered')
    expect(lifecycleOf(P({ board_column: 'Fielding', status: 'Open' }))).toBe('inflight')
    expect(lifecycleOf(P({ status: 'Cancelled' }))).toBe('cancelled')
    // A cancelled survey that reached Delivery is still cancelled — otherwise
    // it would be counted as delivered revenue.
    expect(lifecycleOf(P({ board_column: 'Delivery', cancelled_at: '2026-01-01' }))).toBe('cancelled')
  })

  it('names the bucket nobody had a name for: closed, never delivered', () => {
    // 24 real surveys, 7,526 collected N, $0 recorded cost. Not cancelled —
    // nobody called them off — just closed short of delivery.
    expect(lifecycleOf(P({ board_column: 'Fielding', status: 'Closed' }))).toBe('abandoned')
  })

  it('counts every survey exactly once', () => {
    const rows = [
      P({ id: 'a' }), P({ id: 'b', status: 'Cancelled' }),
      P({ id: 'c', board_column: 'Fielding', status: 'Open' }),
      P({ id: 'd', board_column: 'Data QA', status: 'Closed' }),
    ]
    const c = lifecycleCounts(rows, [], [], [])
    expect(c.reduce((t, x) => t + x.surveys, 0)).toBe(4)
    expect(c.find(x => x.key === 'abandoned')!.surveys).toBe(1)
  })

  it('filters, and `all` filters nothing', () => {
    const p = P({ status: 'Cancelled' })
    expect(inLifecycle(p, 'cancelled')).toBe(true)
    expect(inLifecycle(p, 'delivered')).toBe(false)
    expect(inLifecycle(p, 'all')).toBe(true)
  })
})

describe('budgetVariance: gross, never netted', () => {
  it('reports overrun and headroom SEPARATELY', () => {
    // Netting these reports $0 and the finding vanishes — but headroom on one
    // survey cannot pay for an overrun on another. Production: $31,604 over
    // and $28,961 under, which nets to almost nothing and hides both.
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
    // budget 0 would make every dollar an overrun.
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
  it('flags an in-flight survey past its ceiling', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', budget: 100 })]
    const e = liveExposure(rows, [B('x', 1, 300)], [], [], ACC)
    expect(e).toHaveLength(1)
    expect(e[0].reasons[0]).toContain('300%')
  })

  it('flags an in-flight survey past its target', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', n_target: 100, n_collected: 250 })]
    const e = liveExposure(rows, [], [S('x', 2, 250)], [], ACC)
    expect(e[0].overTargetN).toBe(150)
    expect(e[0].overTargetCost).toBeCloseTo(300)
  })

  it('says nothing about delivered work — that is history, not exposure', () => {
    const rows = [P({ id: 'x', board_column: 'Delivery', budget: 10 })]
    expect(liveExposure(rows, [B('x', 1, 300)], [], [], ACC)).toEqual([])
  })

  it('stays quiet when an in-flight survey is within both limits', () => {
    const rows = [P({ id: 'x', board_column: 'Fielding', status: 'Open', budget: 1000, n_target: 100, n_collected: 50 })]
    expect(liveExposure(rows, [B('x', 1, 50)], [], [], ACC)).toEqual([])
  })
})

describe('surveyPnl', () => {
  it('computes revenue at min(actual, target) and margin against real cost', () => {
    const rows = [P({ id: 'x', n_target: 100, n_actual: 130, n_collected: 130 })]
    const r = surveyPnl(rows, new Map([['x', 50]]), [B('x', 10, 130)], [], [], ACC)[0]
    expect(r).toMatchObject({ billableN: 100, revenue: 5000, cost: 1300, margin: 3700 })
    expect(r.marginPct).toBeCloseTo(0.74)
    expect(r.account).toBe('BAM')
  })

  it('leaves revenue null — never 0 — when unpriced', () => {
    const r = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10 })], new Map(), [B('x', 1, 10)], [], [], ACC)[0]
    expect(r.revenue).toBeNull()
    expect(r.margin).toBeNull()
    expect(r.cost).toBe(10)
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
})

describe('accountPnl: the pricing gap', () => {
  it('shows realised rate and unit cost on the SAME surveys', () => {
    // The BAM finding in miniature: same unit cost, lower realised rate.
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
    expect(bam.costPerComplete).toBe(ds.costPerComplete)
    expect(bam.measured).toBe(1)
  })

  it('counts unpriced spend per account even when nothing is measurable', () => {
    const pnl = surveyPnl([P({ id: 'a', client_id: 'acc1' })], new Map(), [B('a', 10, 10)], [], [], ACC)
    const bam = accountPnl(pnl)[0]
    expect(bam).toMatchObject({ surveys: 1, measured: 0, unpricedSpend: 100, totalSpend: 100 })
    expect(bam.realisedRate).toBeNull()
  })
})

describe('exceptions', () => {
  const med = new Map<Route, number>([['blast', 10]])

  it('names a loss-making survey with its dollars', () => {
    const pnl = surveyPnl([P({ id: 'x', n_target: 10, n_actual: 10, n_collected: 10 })],
      new Map([['x', 1]]), [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, { breaches: [], overrun: 0, underSurveys: 0, headroom: 0, measurable: 0, noCost: 0, ids: [] }, med)
    expect(e[0].kind).toBe('loss')
    expect(e[0].headline).toContain('$90')
  })

  it('flags a CPQR outlier only when the survey reconciles', () => {
    // An unreconciled survey has a wrong CPQR, so flagging it sends someone to
    // investigate a record-keeping gap dressed as a cost problem.
    const good = surveyPnl([P({ id: 'g', n_collected: 10, n_actual: 1 })], new Map(), [B('g', 100, 10)], [], [], ACC)
    const bad = surveyPnl([P({ id: 'b', n_collected: 999, n_actual: 1 })], new Map(), [B('b', 100, 10)], [], [], ACC)
    const none = { breaches: [], overrun: 0, underSurveys: 0, headroom: 0, measurable: 0, noCost: 0, ids: [] }
    expect(exceptions(good, none, med).some(x => x.kind === 'cpqr-outlier')).toBe(true)
    expect(exceptions(bad, none, med).some(x => x.kind === 'cpqr-outlier')).toBe(false)
  })

  it('gives a survey ONE row even when it fails several ways', () => {
    const rows = [P({ id: 'x', budget: 10, n_target: 10, n_actual: 10, n_collected: 10 })]
    const pnl = surveyPnl(rows, new Map([['x', 1]]), [B('x', 10, 10)], [], [], ACC)
    const v = budgetVariance(rows, [B('x', 10, 10)], [], [], ACC)
    const e = exceptions(pnl, v, med)
    expect(e.filter(x => x.id === 'x')).toHaveLength(1)
  })
})

describe('monthly: the ledger filling in is not growth', () => {
  it('computes cost per N on the COSTED subset only', () => {
    // Two surveys in a month: one costed (100 N, $200), one not (900 N, $0).
    // Dividing $200 by 1,000 N reports $0.20 and would show a collapsing cost
    // curve as coverage improves. The honest figure is $2.00 on the 100 N the
    // $200 actually bought.
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

  it('reports null cost per N for a period with no recorded cost, never 0', () => {
    // February to April 2026 are exactly this: real delivered N, $0 recorded.
    const m = monthly([P({ id: 'a', deliver_date: '2026-03-01', n_actual: 500 })], new Map(), [], [], [])
    expect(m[0].costPerN).toBeNull()
    expect(m[0].n).toBe(500)
  })

  it('buckets by quarter when asked', () => {
    const rows = [
      P({ id: 'a', deliver_date: '2026-07-15' }),
      P({ id: 'b', deliver_date: '2026-09-30' }),
      P({ id: 'c', deliver_date: '2026-04-01' }),
    ]
    expect(monthly(rows, new Map(), [], [], [], 'quarter').map(x => x.key))
      .toEqual(['2026-Q2', '2026-Q3'])
  })

  it('drops an undated survey rather than inventing a period for it', () => {
    const rows = [P({ id: 'a', deliver_date: null, launch_date: null, submitted_date: null })]
    expect(monthly(rows, new Map(), [], [], [])).toEqual([])
  })
})

describe('bidLadder', () => {
  it('compares each project against its OWN lowest bid', () => {
    // Raising from $10 to $50 halved the response rate here, which is the
    // shape the production data shows across 53 projects.
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
  it('values in-flight work at target, and says what it cannot see', () => {
    const rows = [
      P({ id: 'a', board_column: 'Fielding', status: 'Open', n_target: 100 }),
      P({ id: 'b', board_column: 'Fielding', status: 'Open', n_target: 100 }),
    ]
    const b = backlog(rows, new Map([['a', 50]]), [B('a', 1, 20)], [], [])
    expect(b).toMatchObject({ surveys: 1, revenueAtTarget: 5000, spentSoFar: 20, unpriced: 1 })
  })

  it('excludes delivered and cancelled work', () => {
    const rows = [P({ id: 'a', n_target: 100 }), P({ id: 'b', status: 'Cancelled', n_target: 100 })]
    expect(backlog(rows, new Map([['a', 50], ['b', 50]]), [], [], []).surveys).toBe(0)
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
})

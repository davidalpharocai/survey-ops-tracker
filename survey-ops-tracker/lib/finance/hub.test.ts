import { describe, it, expect } from 'vitest'
import {
  spendOf, routeOf, routeCosts, legsOf, spendByClient, costBreakdown, COST_LINES,
  coverage, applyFilters, finDate,
  type FinProject, type FinBlast, type FinCost, type FinSupplier,
} from './hub'

/**
 * Guards the finance hub's arithmetic.
 *
 * Almost every test here exists because the corresponding mistake was actually
 * made this week, on real numbers, and reported before being caught: email send
 * cost charged when it should not be, a rate derived from under-recorded
 * surveys, a panel survey priced at blast rates, NULL treated as zero.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'Citadel', client_id: 'c1',
  project_type: 'PS', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, ...o,
})

describe('spendOf', () => {
  it('charges reward and send on SMS', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 25, completes: 4, people: 1000, cost_per_send: 0.02, channel: 'sms' }]
    expect(spendOf(P(), b, [], [])).toMatchObject({ reward: 100, send: 20, total: 120 })
  })

  it('charges NO send on email — the incentive is the whole cost', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 25, completes: 4, people: 1000, cost_per_send: 0.02, channel: 'email' }]
    expect(spendOf(P(), b, [], [])).toMatchObject({ reward: 100, send: 0, total: 100 })
  })

  it('STILL charges send when the channel was never recorded', () => {
    // "Nobody wrote down how this went out" is not evidence that it was free.
    // The SQL says `is distinct from email` for the same reason.
    const b: FinBlast[] = [{ project_id: 'p1', bid: 25, completes: 4, people: 1000, cost_per_send: 0.02, channel: null }]
    expect(spendOf(P(), b, [], []).send).toBe(20)
  })

  it('counts completes we PAID for, not the post-QA number', () => {
    // n_actual is 12-20% smaller than what was paid for. Using it as the
    // denominator inflated one client's cost per complete by ~20%.
    const b: FinBlast[] = [{ project_id: 'p1', bid: 1, completes: 100, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 50 }]
    expect(spendOf(P({ n_actual: 40 }), b, s, []).paidCompletes).toBe(150)
  })

  it('treats a missing figure as zero spend, never as a guess', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: null, completes: null, people: null, cost_per_send: null, channel: null }]
    expect(spendOf(P(), b, [], []).total).toBe(0)
  })
})

describe('routeOf: rows, never the label', () => {
  it('calls a B2B-typed survey with supplier rows a panel survey', () => {
    // PR00425 exactly. project_type is wrong on 11 of 117 projects with rows.
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 995 }]
    expect(routeOf(P({ project_type: 'B2B' }), [], s)).toBe('panel')
  })

  it('recognises a mixed survey rather than picking a side', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 1, completes: 1, people: 1, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 1 }]
    expect(routeOf(P(), b, s)).toBe('both')
  })
})

describe('routeCosts', () => {
  it('excludes surveys whose recorded completes do not cover their N', () => {
    // THE CIRCULARITY GUARD. A rate from an under-recorded survey has too small
    // a denominator; the first version of this number came out ~40% high.
    const rows = [P({ id: 'ok', n_collected: 10 }), P({ id: 'holed', n_collected: 1000 })]
    const b: FinBlast[] = [
      { project_id: 'ok', bid: 50, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' },
      { project_id: 'holed', bid: 50, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' },
    ]
    expect(routeCosts(rows, b, [], []).find(r => r.route === 'blast')).toMatchObject({ n: 1, median: 50 })
  })

  // 117 CHANGED THIS DELIBERATELY. It used to assert `toEqual([])` — a mixed
  // survey contributed to neither rate, on the grounds that "a blended survey
  // cannot attribute its own dollars to one side". That was true of CPQR, which
  // divides by a post-QA figure no row records per route. It was never true
  // here: this rate divides spend by completes we PAID FOR, and a blast row
  // carries its own bid and completes while a supplier row carries its own CPI
  // and collected. The money was always attributable; it was being discarded.
  it('partitions a mixed-route survey into one leg per route', () => {
    const rows = [P({ id: 'm', n_collected: 2 })]
    const b: FinBlast[] = [{ project_id: 'm', bid: 50, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'm', cpi: 1, n_collected: 1 }]
    const out = routeCosts(rows, b, s, [])
    expect(out.find(r => r.route === 'blast')).toMatchObject({ n: 1, median: 50 })
    expect(out.find(r => r.route === 'panel')).toMatchObject({ n: 1, median: 1 })
  })

  // …but ONLY when every dollar can be placed. A flat cost line naming no route
  // is the one thing a mixed survey cannot split, and on PR00425 that line is
  // 64% of the bill — so it blocks both legs rather than being smeared across
  // them.
  it('drops a mixed survey whose flat cost names no route', () => {
    const rows = [P({ id: 'm', n_collected: 2 })]
    const b: FinBlast[] = [{ project_id: 'm', bid: 50, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'm', cpi: 1, n_collected: 1 }]
    const c: FinCost[] = [{ project_id: 'm', amount: 900, route: null }]
    expect(routeCosts(rows, b, s, c)).toEqual([])
  })

  it('prices a mixed survey once its flat cost is routed', () => {
    const rows = [P({ id: 'm', n_collected: 2 })]
    const b: FinBlast[] = [{ project_id: 'm', bid: 50, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'm', cpi: 1, n_collected: 1 }]
    const c: FinCost[] = [{ project_id: 'm', amount: 900, route: 'blast' }]
    const out = routeCosts(rows, b, s, c)
    // The list purchase lands wholly on the side that bought it: $950 for the
    // one blast complete, $1 for the one panel complete. Pro rata would have put
    // $450 on a panel leg that bought none of it.
    expect(out.find(r => r.route === 'blast')).toMatchObject({ n: 1, median: 950 })
    expect(out.find(r => r.route === 'panel')).toMatchObject({ n: 1, median: 1 })
  })

  it('reports the spread, not just a median', () => {
    const rows = Array.from({ length: 8 }, (_, k) => P({ id: `b${k}`, n_collected: 10 }))
    const b: FinBlast[] = rows.map(r => ({
      project_id: r.id, bid: 50, completes: 10, people: 0, cost_per_send: 0, channel: 'sms',
    }))
    const blast = routeCosts(rows, b, [], []).find(r => r.route === 'blast')
    expect(blast?.n).toBe(8)
    expect(blast).toHaveProperty('p25')
    expect(blast).toHaveProperty('p75')
  })
})

describe('spendByClient', () => {
  it('reports how many surveys are actually costed, not just the total', () => {
    // A $0 survey is $0 because nothing was logged, not because nothing was
    // spent. Any total drawn from this set is a floor and must say so.
    const rows = [P({ id: 'a', client: 'BAM' }), P({ id: 'b', client: 'BAM' })]
    const b: FinBlast[] = [{ project_id: 'a', bid: 10, completes: 5, people: 0, cost_per_send: 0, channel: 'sms' }]
    const r = spendByClient(rows, b, [], [])
    expect(r.total).toBe(50)
    expect(r.clients[0]).toMatchObject({ client: 'BAM', surveys: 2, costed: 1 })
    expect(r.coverage).toEqual({ costed: 1, of: 2 })
  })
})

describe('recovered rewards are their own line — David, 2026-09-24', () => {
  it('splits a credit out of "other" and keeps the net total the trigger stores', () => {
    // A recovered incentive is a NEGATIVE cost line. Folded into "other" it
    // turned that line negative and drew it as a positive bar.
    const b: FinBlast[] = [{ project_id: 'p1', bid: 100, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' }]
    const c: FinCost[] = [
      { project_id: 'p1', amount: 50, route: 'blast' },
      { project_id: 'p1', amount: -300, route: 'blast' },
    ]
    expect(spendOf(P(), b, [], c)).toMatchObject({ reward: 1000, other: 50, recovered: -300, total: 750 })
  })

  it('breaks cost down into gross rewards, recovered, net and the rest', () => {
    const rows = [P({ id: 'a' }), P({ id: 'b' })]
    const b: FinBlast[] = [
      { project_id: 'a', bid: 100, completes: 10, people: 1000, cost_per_send: 0.02, channel: 'sms' },
      { project_id: 'b', bid: 50, completes: 4, people: 0, cost_per_send: 0, channel: 'email' },
    ]
    const s: FinSupplier[] = [{ project_id: 'b', cpi: 2, n_collected: 100 }]
    const c: FinCost[] = [{ project_id: 'a', amount: -250, route: 'blast' }, { project_id: 'b', amount: 40 }]
    const k = costBreakdown(rows, b, s, c)
    expect(k).toMatchObject({
      panel: 200, rewardsGross: 1200, recovered: -250, rewardsNet: 950, sends: 20, other: 40,
      recoveredSurveys: 1, recoveredLines: 1,
    })
    expect(k.total).toBe(200 + 1200 - 250 + 20 + 40)
    // The total equals the sum of every survey's own net spend, to the cent.
    const net = rows.reduce((t, p) => t + spendOf(p, b, s, c).total, 0)
    expect(k.total).toBeCloseTo(net, 10)
  })

  it('labels every line once, recovered included, for every consumer', () => {
    expect(COST_LINES.map(l => l.key)).toEqual(['panel', 'rewardsGross', 'recovered', 'sends', 'other', 'total'])
    expect(COST_LINES.find(l => l.key === 'recovered')!.label).toBe('Rewards recovered')
  })

  it('carries the credit on the route leg it belongs to', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 10, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' }]
    const c: FinCost[] = [{ project_id: 'p1', amount: -30, route: 'blast' }]
    const { legs } = legsOf(P({ n_actual: 10, n_collected: 10 }), b, [], c)
    expect(legs[0]).toMatchObject({ route: 'blast', spend: 70, recovered: -30 })
  })

  it('blocks a mixed survey whose credit names no route, rather than dropping it from both legs', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 10, completes: 5, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 5 }]
    const c: FinCost[] = [{ project_id: 'p1', amount: -20, route: null }]
    expect(legsOf(P({ n_actual: 10 }), b, s, c).reason).toBe('unrouted-cost')
  })
})

describe('legsOf: a segmented survey whose segments do not add up', () => {
  it('partitions the money but gives no delivered N when the survey N actual is only the partial roll-up (PR00231)', () => {
    // 342 is the one counted segment; the $9,000 covers both. Cost per complete
    // still has its leg (it never reads `delivered`); CPQR gets no denominator.
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 9000 }]
    const p = P({
      n_actual: 342, n_collected: 9000,
      segments: [
        { id: 'a', project_id: 'p1', n_target: 400, n_actual: 342 },
        { id: 'b', project_id: 'p1', n_target: 4600, n_actual: null },
      ],
    })
    const l = legsOf(p, [], s, [])
    expect(l.legs[0]).toMatchObject({ route: 'panel', spend: 9000, paid: 9000, delivered: null })
    expect(l.reason).toBe('ok')
    expect(l.splitReason).toBe('partial-n-actual')
    // Cost per complete bought is real on it, and keeps it.
    expect(routeCosts([p], [], s, [])).toEqual([{ route: 'panel', p25: 1, median: 1, p75: 1, n: 1 }])
  })

  it('divides by a TYPED survey N actual whose segments do not add up', () => {
    // The survey says 400; the one counted segment says 342. 400 is somebody's
    // statement about the whole survey (the invoice reads it), so it stands.
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 900 }]
    const p = P({
      n_actual: 400, n_collected: 900,
      segments: [
        { id: 'a', project_id: 'p1', n_target: 400, n_actual: 342 },
        { id: 'b', project_id: 'p1', n_target: 400, n_actual: null },
      ],
    })
    const l = legsOf(p, [], s, [])
    expect(l.legs[0]).toMatchObject({ delivered: 400 })
    expect(l.splitReason).toBe('ok')
  })

  it('blocks the delivered split of a MIXED survey whose N actual is a partial roll-up', () => {
    const b: FinBlast[] = [{ project_id: 'p1', bid: 10, completes: 50, people: 0, cost_per_send: 0, channel: 'sms' }]
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 500 }]
    const p = P({
      n_actual: 100, n_collected: 550, n_actual_panel: 80, n_actual_blast: 20, n_actual_split_method: 'transaction_id',
      segments: [
        { id: 'a', project_id: 'p1', n_target: 100, n_actual: 100 },
        { id: 'b', project_id: 'p1', n_target: 400, n_actual: null },
      ],
    })
    const l = legsOf(p, b, s, [])
    expect(l.legs.map(x => x.delivered)).toEqual([null, null])
    expect(l.splitReason).toBe('partial-n-actual')
  })

  it('uses the segments total only when the survey N actual is blank and every segment has one', () => {
    const s: FinSupplier[] = [{ project_id: 'p1', cpi: 1, n_collected: 300 }]
    const full = P({ n_actual: null, n_collected: 300, segments: [
      { id: 'a', project_id: 'p1', n_target: 100, n_actual: 120 },
      { id: 'b', project_id: 'p1', n_target: 100, n_actual: 80 },
    ] })
    expect(legsOf(full, [], s, []).legs[0].delivered).toBe(200)
    const half = P({ n_actual: null, n_collected: 300, segments: [
      { id: 'a', project_id: 'p1', n_target: 100, n_actual: 120 },
      { id: 'b', project_id: 'p1', n_target: 100, n_actual: null },
    ] })
    const l = legsOf(half, [], s, [])
    expect(l.legs[0].delivered).toBeNull()
    expect(l.splitReason).toBe('no-n-actual')
  })
})

describe('coverage: the caveat travels with the numbers', () => {
  it('does not count an empty rerun placeholder as an uncosted delivered survey', () => {
    // 20 such shells dragged July cost coverage from 85% to 73%.
    const rows = [P({ id: 'a' }), P({ id: 'shell', is_placeholder: true })]
    const b: FinBlast[] = [{ project_id: 'a', bid: 1, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }]
    expect(coverage(rows, b, [], [])).toMatchObject({ delivered: 1, deliveredCosted: 1, deliveredPct: 100 })
  })

  it('counts delivered surveys with no recorded cost', () => {
    const rows = [P({ id: 'a' }), P({ id: 'b' }), P({ id: 'c', board_column: 'Fielding' })]
    const b: FinBlast[] = [{ project_id: 'a', bid: 1, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' }]
    expect(coverage(rows, b, [], [])).toMatchObject({ delivered: 2, deliveredCosted: 1, deliveredPct: 50 })
  })

  it('counts completes no recorded source accounts for', () => {
    const rows = [P({ id: 'a', n_collected: 1000 })]
    const b: FinBlast[] = [{ project_id: 'a', bid: 1, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' }]
    expect(coverage(rows, b, [], [])).toMatchObject({ unreconciled: 1, unattributedCompletes: 990 })
  })
})

describe('filters', () => {
  const rows = [
    P({ id: 'a', deliver_date: '2026-06-15', project_type: 'PS', client: 'BAM', client_id: 'bam' }),
    P({ id: 'b', deliver_date: '2026-09-01', project_type: 'B2B', client: 'Coatue', client_id: 'coa' }),
    P({ id: 'c', deliver_date: null, launch_date: '2026-07-01', project_type: 'PS', client: 'BAM - James Cook', client_id: 'bam' }),
  ]
  const route = () => 'panel' as const

  it('falls back through deliver, launch, submitted for the date', () => {
    expect(finDate(rows[2])).toBe('2026-07-01')
  })

  it('filters by range, type and account', () => {
    expect(applyFilters(rows, { from: '2026-07-01' }, route).map(r => r.id)).toEqual(['b', 'c'])
    expect(applyFilters(rows, { type: 'PS' }, route).map(r => r.id)).toEqual(['a', 'c'])
    expect(applyFilters(rows, { accountId: 'coa' }, route).map(r => r.id)).toEqual(['b'])
    // Through the KEY, so row c joins BAM despite wearing a different label.
    expect(applyFilters(rows, { accountId: 'bam' }, route).map(r => r.id)).toEqual(['a', 'c'])
  })

  it('drops an undated survey from a dated range rather than guessing it in', () => {
    const undated = [P({ id: 'z', deliver_date: null, launch_date: null, submitted_date: null })]
    expect(applyFilters(undated, { from: '2026-01-01' }, route)).toEqual([])
  })
})

/**
 * 117: the partition.
 *
 * legsOf is the only place a survey's money is split by route, and everything
 * downstream adds up legs rather than reaching for spendOf().total. These guard
 * the invariant that makes that safe — if a leg can be produced whose parts do
 * not add back to the whole, the same dollar can be counted on both cards.
 */
describe('legsOf', () => {
  const MIX = (o: Partial<FinProject> = {}) => P({
    id: 'm', n_collected: 1019, n_actual: 252,
    n_actual_panel: 236, n_actual_blast: 16, n_actual_split_method: 'measured', ...o,
  })
  // PR00425, to scale: 11 SMS blasts (24 completes, $245 reward + $2,485.10
  // send), PureSpectrum (995 collected, $2,085.70) and an $8,697.85 ZoomInfo
  // list that bought exactly the 124,255 sends the blasts used.
  const B: FinBlast[] = [{ project_id: 'm', bid: 245 / 24, completes: 24, people: 124255, cost_per_send: 0.02, channel: 'sms' }]
  const S: FinSupplier[] = [{ project_id: 'm', cpi: 2085.70 / 995, n_collected: 995 }]
  const ZOOM = (route: string | null): FinCost[] => [{ project_id: 'm', amount: 8697.85, route }]

  it('gives a single-route survey ONE leg carrying its entire bill', () => {
    // The no-op guarantee: everything downstream that used spendOf().total on a
    // single-route survey must get the identical number from one leg, flat cost
    // lines included, routed or not. 126 of 133 costed surveys take this path.
    const p = P({ id: 'p1', n_collected: 10, n_actual: 8 })
    const b: FinBlast[] = [{ project_id: 'p1', bid: 25, completes: 10, people: 100, cost_per_send: 0.02, channel: 'sms' }]
    const c: FinCost[] = [{ project_id: 'p1', amount: 500, route: null }]
    const { legs, unrouted, reason } = legsOf(p, b, [], c)
    expect(reason).toBe('ok')
    expect(unrouted).toBe(0)
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ route: 'blast', paid: 10, delivered: 8, collected: 10 })
    expect(legs[0].spend).toBeCloseTo(spendOf(p, b, [], c).total, 6)
  })

  it('splits a mixed survey so the parts add back to the whole', () => {
    const p = MIX()
    const c = ZOOM('blast')
    const { legs, unrouted } = legsOf(p, B, S, c)
    const sp = spendOf(p, B, S, c)
    expect(legs).toHaveLength(2)
    // THE INVARIANT. Without it the same dollar reaches both cards.
    expect(legs.reduce((t, l) => t + l.spend, 0) + unrouted).toBeCloseTo(sp.total, 6)
    expect(legs.reduce((t, l) => t + l.paid, 0)).toBe(sp.paidCompletes)
    expect(legs.reduce((t, l) => t + (l.delivered ?? 0), 0)).toBe(252)

    const panel = legs.find(l => l.route === 'panel')!
    const blast = legs.find(l => l.route === 'blast')!
    expect(panel.spend).toBeCloseTo(2085.70, 2)
    expect(panel.delivered).toBe(236)
    // The list purchase lands wholly on the blasts that used it: $2,730.10 of
    // field cost plus $8,697.85 of contacts. Pro rata by delivered N would have
    // charged the panel side $8,145 of a list it never touched.
    expect(blast.spend).toBeCloseTo(11427.95, 2)
    expect(blast.delivered).toBe(16)
  })

  it('refuses to split at all while a flat cost names no route', () => {
    // 64% of PR00425's bill. Admitting the survey without placing it prices the
    // blast leg at $170.63 against a truth of $714.25 — four times too cheap,
    // pooled beside single-route surveys that DO carry their flat costs.
    const { legs, unrouted, reason } = legsOf(MIX(), B, S, ZOOM(null))
    expect(legs).toEqual([])
    expect(reason).toBe('unrouted-cost')
    expect(unrouted).toBeCloseTo(8697.85, 2)
  })

  it('still partitions the MONEY when the delivered split is unknown', () => {
    // Cost per complete needs no delivered figure, so a mixed survey nobody has
    // joined the deliverable for still prices per complete. Only CPQR refuses.
    const { legs, splitReason } = legsOf(
      MIX({ n_actual_panel: null, n_actual_blast: null, n_actual_split_method: null }), B, S, ZOOM('blast'))
    expect(legs).toHaveLength(2)
    expect(legs.every(l => l.delivered == null)).toBe(true)
    expect(splitReason).toBe('no-split')
    expect(legs.reduce((t, l) => t + l.spend, 0)).toBeCloseTo(13513.65, 2)
  })

  it('treats a split that no longer sums to n_actual as absent', () => {
    // n_actual moves on its own. A split that stops agreeing is stale, and stale
    // is worse than missing because it looks answered.
    const { legs, splitReason } = legsOf(MIX({ n_actual: 300 }), B, S, ZOOM('blast'))
    expect(legs.every(l => l.delivered == null)).toBe(true)
    expect(splitReason).toBe('split-mismatch')
  })

  it('stores an estimated split but refuses to price it', () => {
    const { legs, splitReason } = legsOf(
      MIX({ n_actual_split_method: 'estimated' }), B, S, ZOOM('blast'))
    expect(legs.every(l => l.delivered == null)).toBe(true)
    expect(splitReason).toBe('estimated')
  })

  it('allows a leg that delivered nothing', () => {
    // A route we spent on that produced no usable interview is a real outcome,
    // not a data error. Its spend still has to land somewhere.
    const { legs } = legsOf(
      MIX({ n_actual_panel: 252, n_actual_blast: 0 }), B, S, ZOOM('blast'))
    expect(legs.find(l => l.route === 'blast')).toMatchObject({ delivered: 0 })
    expect(legs.find(l => l.route === 'panel')).toMatchObject({ delivered: 252 })
  })
})

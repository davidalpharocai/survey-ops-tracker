import { describe, it, expect } from 'vitest'
import {
  buildInsightsModel, compareFigures, drillRows, itemsOf, measure, median, medianBounds, undatedIn,
  CYCLE_DAYS_GOAL, MIN_COMPARE_N, ON_TIME_GOAL, type InsightsInput,
} from './model'
// The real label thinner the charts use, so the claims below about what the
// axis can print are measured rather than asserted.
import { fitAxisLabels, textWidth } from '@/components/charts/scale'
import { mostSince, buildHeadline } from './headline'
import { DEFAULT_FILTER, NO_CAPTAIN, type InsightsFilter } from './filters'
import type { InsightsProject } from './load'
import type { FieldRowCounts } from '@/lib/finance/lifecycle'

/**
 * Fixtures carry the cases that broke earlier dashboards: an empty rerun
 * placeholder sitting in Delivery, a delivered survey with no deliver date, one
 * with no due date, dates that run backwards, a survey delivered on its due
 * date, a Hold, a Scoping survey already buying respondents, a legacy archived
 * row that never reached Delivery.
 */

const TODAY = '2026-09-27'
let seq = 0
const P = (o: Partial<InsightsProject> = {}): InsightsProject => ({
  id: `p${++seq}`,
  project_code: `PR${String(seq).padStart(5, '0')}`,
  project_name: `Survey ${seq}`,
  client: 'Acme',
  client_id: 'acme',
  status: 'Closed',
  phase: 'Active',
  board_column: 'Delivery',
  project_type: 'PS',
  submitted_date: null,
  launch_date: null,
  due_date: null,
  deliver_date: null,
  n_target: null,
  n_target_max: null,
  n_collected: 0,
  n_actual: null,
  is_placeholder: false,
  cancelled_at: null,
  series_id: null,
  rerun_number: 1,
  captain: { id: 'alex', name: 'Alex', initials: 'AL' },
  ...o,
})
const LIVE = (o: Partial<InsightsProject> = {}) => P({ status: 'Open', board_column: 'Fielding', ...o })
const F = (o: Partial<InsightsFilter> = {}): InsightsFilter => ({ ...DEFAULT_FILTER, ...o })
const ACCOUNTS = new Map([['acme', 'Acme Capital'], ['bam', 'BAM']])
const model = (projects: InsightsProject[], o: Partial<InsightsInput> = {}) =>
  buildInsightsModel({ projects, rowCounts: new Map(), accounts: ACCOUNTS, filter: F(), today: TODAY, ...o })
/** n delivered surveys on one day. */
const many = (n: number, o: Partial<InsightsProject>) => Array.from({ length: n }, () => P(o))

describe('date placement: a delivered survey is placed by its deliver date', () => {
  it('counts by deliver_date, not by when it was submitted', () => {
    const m = model([
      P({ submitted_date: '2026-08-20', deliver_date: '2026-09-02' }),
      P({ submitted_date: '2026-09-01', deliver_date: '2026-08-31' }),
    ])
    expect(m.cur.delivered).toBe(1)
    expect(m.months.find(x => x.key === '2026-08')?.total).toBe(1)
    expect(m.months.find(x => x.key === '2026-09')?.total).toBe(1)
  })
  it('leaves an undated delivery out of a bounded range, says so, and counts it in All time', () => {
    const ps = [P({ deliver_date: '2026-09-02' }), P({ deliver_date: null })]
    const bounded = model(ps)
    expect(bounded.cur.delivered).toBe(1)
    expect(bounded.undatedDelivered).toBe(1)
    const all = model(ps, { filter: F({ range: { preset: 'all', from: null, to: null } }) })
    expect(all.cur.delivered).toBe(2)
    // …but no monthly chart can place it.
    expect(all.months.reduce((s, x) => s + x.total, 0)).toBe(1)
  })
  it('"delivered" means the Delivery column — an archived row that never got there is not delivered', () => {
    const m = model([
      P({ deliver_date: '2026-09-02' }),
      P({ board_column: 'Fielding', status: 'Closed', deliver_date: '2026-09-03' }),
    ])
    expect(m.cur.delivered).toBe(1)
  })
  it('a delivery in a later month than the range is not counted', () => {
    const m = model([P({ deliver_date: '2026-09-02' })], { filter: F({ range: { preset: 'last-month', from: null, to: null } }) })
    expect(m.cur.delivered).toBe(0)
  })
})

describe('empty placeholders are excluded everywhere', () => {
  it('drops a placeholder with no rows and no N, and counts it', () => {
    const m = model([
      P({ is_placeholder: true, deliver_date: '2026-09-02' }),
      P({ deliver_date: '2026-09-02' }),
    ])
    expect(m.cur.delivered).toBe(1)
    expect(m.excluded.placeholders).toBe(1)
  })
  it('keeps a placeholder that holds data — its rows or its N are real', () => {
    const withRows = P({ is_placeholder: true, deliver_date: '2026-09-02' })
    const withN = P({ is_placeholder: true, deliver_date: '2026-09-03', n_actual: 40 })
    const rowCounts = new Map<string, FieldRowCounts>([[withRows.id, { blasts: 1, suppliers: 0, costs: 0 }]])
    const m = model([withRows, withN], { rowCounts })
    expect(m.cur.delivered).toBe(2)
    expect(m.excluded.placeholders).toBe(0)
  })
  it('drops internal projects', () => {
    const m = model([P({ project_type: 'Internal', deliver_date: '2026-09-02' })])
    expect(m.cur.delivered).toBe(0)
    expect(m.excluded.internal).toBe(1)
  })
})

describe('the on-time rule', () => {
  it('on or before the due date is on time; after it is late; no due date is left out and counted', () => {
    const { items } = itemsOf([
      P({ due_date: '2026-09-10', deliver_date: '2026-09-10' }),
      P({ due_date: '2026-09-10', deliver_date: '2026-09-09' }),
      P({ due_date: '2026-09-10', deliver_date: '2026-09-11' }),
      P({ due_date: null, deliver_date: '2026-09-11' }),
    ], null)
    const m = measure(items)
    expect(m.judged).toBe(3)
    expect(m.onTime).toBe(2)
    expect(m.late).toBe(1)
    expect(m.noDue).toBe(1)
    expect(m.onTimePct).toBeCloseTo(2 / 3)
  })
  it('has no percentage when nothing can be judged', () => {
    expect(measure(itemsOf([P({ deliver_date: '2026-09-11' })], null).items).onTimePct).toBeNull()
  })
})

describe('cycle time: submitted to delivered, median', () => {
  it('takes the median of whole calendar days', () => {
    expect(median([3, 9, 5])).toBe(5)
    expect(median([2, 4, 6, 10])).toBe(5)
    expect(median([])).toBeNull()
    const { items } = itemsOf([
      P({ submitted_date: '2026-09-01', deliver_date: '2026-09-04' }), // 3
      P({ submitted_date: '2026-09-01', deliver_date: '2026-09-11' }), // 10
      P({ submitted_date: '2026-09-01', deliver_date: '2026-09-08' }), // 7
    ], null)
    expect(measure(items).cycleMedian).toBe(7)
  })
  it('leaves out dates that run backwards and missing dates, and counts each', () => {
    const { items } = itemsOf([
      P({ submitted_date: '2026-09-10', deliver_date: '2026-09-01' }),
      P({ submitted_date: null, deliver_date: '2026-09-01' }),
      P({ submitted_date: '2026-09-01', deliver_date: '2026-09-05' }),
    ], null)
    const m = measure(items)
    expect(m.cycleN).toBe(1)
    expect(m.cycleBackwards).toBe(1)
    expect(m.cycleMissing).toBe(1)
    expect(m.cycleMedian).toBe(4)
  })
})

describe('respondents', () => {
  it('sums n_actual and counts the surveys with none — a missing count is not zero', () => {
    const m = model([
      P({ deliver_date: '2026-09-02', n_actual: 300 }),
      P({ deliver_date: '2026-09-03', n_actual: 0 }),
      P({ deliver_date: '2026-09-04', n_actual: null, n_collected: 250 }),
    ])
    expect(m.cur.respondents).toBe(300)
    expect(m.cur.withN).toBe(2)
    expect(m.cur.withoutN).toBe(1)
  })
})

describe('previous-period comparison, only when both sides have n >= 10', () => {
  it('states the move when both periods are big enough', () => {
    const m = model([...many(12, { deliver_date: '2026-09-05' }), ...many(10, { deliver_date: '2026-08-05' })])
    expect(m.prevLabel).toBe('1–27 Aug 2026')
    expect(m.compare.delivered.state).toBe('up')
    expect(m.compare.delivered.text).toBe('Up from 10 in 1–27 Aug 2026')
    expect(m.compare.delivered.tone).toBe('good')
  })
  it('says "too few to compare" when either side is under the threshold', () => {
    const m = model([...many(12, { deliver_date: '2026-09-05' }), ...many(MIN_COMPARE_N - 1, { deliver_date: '2026-08-05' })])
    expect(m.compare.delivered.state).toBe('too-few')
    expect(m.compare.delivered.text).toMatch(/^Too few to compare/)
    const m2 = model([...many(9, { deliver_date: '2026-09-05' }), ...many(30, { deliver_date: '2026-08-05' })])
    expect(m2.compare.delivered.state).toBe('too-few')
  })
  it('a later day of last month is not in the previous period for "this month"', () => {
    // 28 Aug is after the 27th, so it is outside 1–27 Aug.
    const m = model([...many(12, { deliver_date: '2026-09-05' }), ...many(12, { deliver_date: '2026-08-28' })])
    expect(m.prev?.delivered).toBe(0)
  })
  it('lower is better for cycle time', () => {
    const c = compareFigures({ value: 5, n: 12 }, { value: 8, n: 12 }, { fmt: String, better: 'lower', prevLabel: 'Aug' })
    expect(c.state).toBe('down')
    expect(c.tone).toBe('good')
  })
  it('equal as printed is "same"', () => {
    const c = compareFigures({ value: 0.912, n: 20 }, { value: 0.908, n: 20 }, { fmt: v => `${Math.round(v * 100)}%`, better: 'higher', prevLabel: 'Aug' })
    expect(c.state).toBe('same')
  })
  it('All time has nothing to compare with', () => {
    const m = model(many(12, { deliver_date: '2026-09-05' }), { filter: F({ range: { preset: 'all', from: null, to: null } }) })
    expect(m.compare.delivered.state).toBe('none')
  })
})

describe('reruns, filters and options', () => {
  it('a rerun is a series member, a later wave, or the older Rerun type', () => {
    const m = model([
      P({ deliver_date: '2026-09-02', series_id: 's1' }),
      P({ deliver_date: '2026-09-02', rerun_number: 3 }),
      P({ deliver_date: '2026-09-02', project_type: 'Rerun' }),
      P({ deliver_date: '2026-09-02' }),
    ])
    expect(m.cur.reruns).toBe(3)
  })
  it('type, captain and account filters apply; option counts ignore their own filter', () => {
    const ps = [
      P({ deliver_date: '2026-09-02', project_type: 'PS', client_id: 'acme' }),
      P({ deliver_date: '2026-09-02', project_type: 'B2B', client_id: 'bam', captain: { id: 'sam', name: 'Sam', initials: 'SA' } }),
      P({ deliver_date: '2026-09-02', project_type: null, client_id: 'bam', captain: null }),
    ]
    expect(model(ps, { filter: F({ type: 'B2B' }) }).cur.delivered).toBe(1)
    expect(model(ps, { filter: F({ type: 'none' }) }).cur.delivered).toBe(1)
    expect(model(ps, { filter: F({ captain: NO_CAPTAIN }) }).cur.delivered).toBe(1)
    const m = model(ps, { filter: F({ account: 'bam' }) })
    expect(m.cur.delivered).toBe(2)
    expect(m.accountName).toBe('BAM')
    expect(m.options.accounts.find(o => o.id === 'acme')?.count).toBe(1)
    expect(m.options.types.find(o => o.id === 'B2B')?.count).toBe(1)
    expect(m.options.types.find(o => o.id === 'PS')?.count).toBe(0)
  })
})

describe('right now', () => {
  it('in flight is live work only: hold and scoping sit beside it, and field rows beat a stale Scoping phase', () => {
    const scopingBuying = LIVE({ phase: 'Scoping', board_column: 'Submitted' })
    const m = model([
      LIVE(),
      LIVE({ status: 'Hold' }),
      LIVE({ phase: 'Scoping', board_column: 'Submitted' }),
      scopingBuying,
      LIVE({ status: 'Cancelled' }),
    ], { rowCounts: new Map([[scopingBuying.id, { blasts: 2, suppliers: 0, costs: 0 }]]) })
    expect(m.now.inFlight).toBe(2)
    expect(m.now.hold).toBe(1)
    expect(m.now.scoping).toBe(1)
  })
  it('overdue is strictly past the due date; due soon is today to six days out, like the List', () => {
    const m = model([
      LIVE({ due_date: '2026-09-26' }),
      LIVE({ due_date: TODAY }),
      LIVE({ due_date: '2026-10-03' }),
      LIVE({ due_date: '2026-10-04' }),
    ])
    expect(m.now.overdue).toBe(1)
    expect(m.now.dueSoon).toBe(2)
  })
  it('collection is measured against the minimum target', () => {
    const m = model([
      LIVE({ n_target: 100, n_target_max: 120, n_collected: 50 }),
      LIVE({ n_target: 100, n_collected: 100 }),
    ])
    expect(m.now.targetMin).toBe(200)
    expect(m.now.targetMax).toBe(220)
    expect(m.now.collectionPct).toBeCloseTo(0.75)
    expect(m.now.behind).toBe(1)
  })
  it('a survey with no target adds nothing to the collection share, and is counted as left out', () => {
    const m = model([
      LIVE({ n_target: 100, n_collected: 50 }),
      LIVE({ n_target: null, n_collected: 75 }),
      LIVE({ n_target: null, n_collected: 0 }),
    ])
    expect(m.now.collected).toBe(50)
    expect(m.now.targetMin).toBe(100)
    expect(m.now.collectionPct).toBeCloseTo(0.5)
    expect(m.now.untargeted).toBe(2)
    expect(m.now.untargetedCollected).toBe(75)
  })
  it('the on-hold and scoping drills list exactly the counts beside the tile', () => {
    const m = model([LIVE(), LIVE({ status: 'Hold' }), LIVE({ status: 'Hold', due_date: '2026-09-01' }), LIVE({ phase: 'Scoping', board_column: 'Submitted' })])
    expect(drillRows(m.items, m.filter, { kind: 'open', cls: 'hold' }, TODAY, ACCOUNTS)).toHaveLength(m.now.hold)
    expect(m.now.hold).toBe(2)
    expect(drillRows(m.items, m.filter, { kind: 'open', cls: 'scoping' }, TODAY, ACCOUNTS)).toHaveLength(m.now.scoping)
    expect(m.now.scoping).toBe(1)
  })
})

describe('drills list exactly the surveys the mark counted', () => {
  it('a month column drill matches the month total', () => {
    const ps = [...many(3, { deliver_date: '2026-08-05' }), P({ deliver_date: '2026-08-31', project_type: 'B2B' }),
      P({ deliver_date: '2026-09-01' }), P({ is_placeholder: true, deliver_date: '2026-08-10' })]
    const m = model(ps)
    const aug = m.months.find(x => x.key === '2026-08')!
    const rows = drillRows(m.items, m.filter, { kind: 'delivered', month: '2026-08' }, TODAY, ACCOUNTS)
    expect(rows).toHaveLength(aug.total)
    expect(aug.total).toBe(4)
    expect(aug.byType).toEqual({ PS: 3, B2B: 1 })
  })
  it('a captain bar drill matches the bar', () => {
    const ps = [...many(2, { deliver_date: '2026-09-05' }), P({ deliver_date: '2026-09-06', captain: null })]
    const m = model(ps)
    const none = m.byCaptain.find(g => g.key === NO_CAPTAIN)!
    expect(drillRows(m.items, m.filter, { kind: 'delivered', captain: NO_CAPTAIN }, TODAY, ACCOUNTS)).toHaveLength(none.count)
  })
})

describe('the headline claims only what the numbers carry', () => {
  it('names the latest earlier month with at least as many', () => {
    const counts = new Map([['2026-06', 14], ['2026-07', 9], ['2026-08', 11]])
    expect(mostSince('2026-09', 12, counts)).toBe('2026-06')
    // The month before had as many: "the most since August" would say nothing.
    expect(mostSince('2026-09', 11, counts)).toBeNull()
    expect(mostSince('2026-09', 20, counts)).toBe('record')
    // Under the threshold, no rank claim at all.
    expect(mostSince('2026-09', MIN_COMPARE_N - 1, new Map([['2026-06', 1]]))).toBeNull()
    // No earlier month on record: nothing to rank against.
    expect(mostSince('2026-09', 30, new Map())).toBeNull()
  })
  it('reads warmly and factually', () => {
    const m = model([
      ...many(12, { deliver_date: '2026-06-10' }),
      ...many(5, { deliver_date: '2026-07-10' }),
      ...many(8, { deliver_date: '2026-08-10' }),
      ...many(12, { deliver_date: '2026-09-10', due_date: '2026-09-12', n_actual: 100 }),
    ])
    expect(m.headline).toBe(
      'The team has delivered 12 studies so far in September, already the most since June. ' +
      'That is 1,200 respondents, and 100% of those with a due date arrived on or before it.')
  })
  it('says "at least" when some counts are missing, and "compared with" for a fall', () => {
    const m = model([
      ...many(11, { deliver_date: '2026-09-10', n_actual: 10 }),
      P({ deliver_date: '2026-09-11' }),
      ...many(20, { deliver_date: '2026-08-10' }),
    ])
    expect(m.headline).toContain('compared with 20 in 1–27 Aug 2026')
    expect(m.headline).toContain('at least 110 respondents')
  })
  it('says so plainly when nothing was delivered', () => {
    expect(model([]).headline).toBe('No studies have been delivered so far in September.')
    expect(model([], { filter: F({ captain: NO_CAPTAIN }) }).headline).toBe('No studies without a captain have been delivered so far in September.')
  })
  it('reads a missing or older type naturally', () => {
    const none = model([P({ deliver_date: '2026-09-10', project_type: null })], { filter: F({ type: 'none' }) })
    expect(none.headline).toBe('The team has delivered 1 study with no type set so far in September.')
    const old = model([P({ deliver_date: '2026-09-10', project_type: 'Rerun' })], { filter: F({ type: 'Rerun' }) })
    expect(old.headline).toBe('The team has delivered 1 study filed under the older Rerun type so far in September.')
  })
  it('names the captain and the account when filtered', () => {
    const m = model([P({ deliver_date: '2026-09-10', client_id: 'bam' })], { filter: F({ captain: 'alex', account: 'bam' }) })
    expect(m.headline).toBe('Alex has delivered 1 study for BAM so far in September.')
  })
  it('keeps the headline input self-contained', () => {
    const h = buildHeadline({
      filter: F({ range: { preset: 'last-month', from: null, to: null } }), today: TODAY,
      range: { from: '2026-08-01', to: '2026-08-31' }, cur: measure([]), prev: null, prevLabel: null,
      compareDelivered: { state: 'none', text: '', tone: 'neutral' },
      allMonthCounts: new Map(), undatedMonths: { byMonth: new Map(), unplaced: 0 },
      captainName: null, accountName: null, typeKey: 'PS', runsToToday: false,
    })
    expect(h).toBe('No PS studies were delivered in August.')
  })
})

describe('undated deliveries: a period missing them is never compared as if complete', () => {
  // A delivered survey with no deliver date, probably from `due` (its due date).
  const undatedDue = (n: number, due: string, o: Partial<InsightsProject> = {}) => many(n, { deliver_date: null, due_date: due, ...o })
  const SINCE = F({ range: { preset: 'since-jun-1', from: null, to: null } })

  it('places an undated delivery by its due, else launch, else submitted date — for the check only', () => {
    const { items } = itemsOf([
      P({ deliver_date: null, due_date: '2026-05-10', launch_date: '2026-05-01', submitted_date: '2026-04-20' }),
      P({ deliver_date: null, launch_date: '2026-05-01', submitted_date: '2026-04-20' }),
      P({ deliver_date: null, submitted_date: '2026-04-20' }),
      P({ deliver_date: null }),
      P({ deliver_date: '2026-05-03', due_date: '2026-05-10' }),
    ], null)
    expect(items.map(i => i.likely)).toEqual(['2026-05-10', '2026-05-01', '2026-04-20', null, null])
    expect(undatedIn(items, { from: '2026-05-01', to: '2026-05-31' })).toHaveLength(2)
    // All time already counts them, so it cannot be missing any.
    expect(undatedIn(items, { from: null, to: null })).toHaveLength(0)
  })

  it('withholds the comparison when the undated ones could change the answer', () => {
    // 12 dated in Feb–May, 12 more delivered then with no deliver date, 20 since June:
    // at its highest the earlier period (24) beats this one (20).
    const m = model([...many(20, { deliver_date: '2026-07-10' }), ...many(12, { deliver_date: '2026-04-10' }), ...undatedDue(12, '2026-04-20')], { filter: SINCE })
    expect(m.prev?.delivered).toBe(12)
    expect(m.undated.inPrev).toBe(12)
    expect(m.compare.delivered.state).toBe('unsure')
    expect(m.compare.delivered.text).toBe(
      'Not compared with 2 Feb–31 May 2026: 12 delivered studies from then have no deliver date — enough to change the answer')
    expect(m.headline).toBe('The team has delivered 20 studies since 1 June.')
  })

  it('states a rise that holds even if every undated survey belongs to the earlier period, with "at least"', () => {
    const m = model([...many(40, { deliver_date: '2026-07-10' }), ...many(12, { deliver_date: '2026-04-10' }), ...undatedDue(5, '2026-04-20')], { filter: SINCE })
    expect(m.compare.delivered.state).toBe('up')
    expect(m.compare.delivered.text).toBe('Up from at least 12 in 2 Feb–31 May 2026')
    expect(m.headline).toBe('The team has delivered 40 studies since 1 June, up from at least 12 in 2 Feb–31 May 2026.')
  })

  it('this period\'s own undated deliveries can turn a fall into a rise, so it is not called a fall', () => {
    // 11 dated this month + 3 undated due this month, against 12 in 1–27 Aug.
    const m = model([...many(11, { deliver_date: '2026-09-05' }), ...undatedDue(3, '2026-09-10'), ...many(12, { deliver_date: '2026-08-05' })])
    expect(m.undated.inRange).toBe(3)
    expect(m.compare.delivered.state).toBe('unsure')
    expect(m.compare.delivered.text).toMatch(/3 delivered studies in your dates have no deliver date/)
    expect(m.headline).toBe('The team has delivered 11 studies so far in September.')
  })

  it('each figure counts only the undated surveys that could move it', () => {
    // The undated ones have no due date and no submitted date: they cannot move
    // on time or cycle time, so those still compare.
    const dated = (d: string) => many(12, { deliver_date: d, due_date: d, submitted_date: '2026-01-01' })
    const m = model([...dated('2026-07-10'), ...dated('2026-04-10'), ...many(30, { deliver_date: null, launch_date: '2026-04-15' })], { filter: SINCE })
    expect(m.compare.delivered.state).toBe('unsure')
    expect(m.compare.onTime.state).toBe('same')
    expect(m.compare.cycle.state).toBe('up')
  })

  it('bounds a median by the unknowns', () => {
    expect(medianBounds([5, 7, 9], 0)).toEqual({ lo: 7, hi: 7 })
    expect(medianBounds([5, 7, 9], 1)).toEqual({ lo: 6, hi: 8 })
    expect(medianBounds([5], 2)).toEqual({ lo: 0, hi: Infinity })
  })

  it('says under a month column how many undated deliveries probably belong to it', () => {
    const m = model([P({ deliver_date: '2026-05-05' }), ...undatedDue(4, '2026-05-20')])
    expect(m.months.find(x => x.key === '2026-05')).toMatchObject({ total: 1, undated: 4 })
  })

  it('"the most since" and "a record" hold only against the undated surveys too', () => {
    const counts = new Map([['2026-06', 14], ['2026-07', 9], ['2026-08', 11]])
    // July at its highest (9 + 4) reaches 12: "the most since June" is no longer certain.
    expect(mostSince('2026-09', 12, counts, { byMonth: new Map([['2026-07', 4]]), unplaced: 0 })).toBeNull()
    // …nor is June certain to have had as many if September may hold 3 more.
    expect(mostSince('2026-09', 12, counts, { byMonth: new Map([['2026-09', 3]]), unplaced: 0 })).toBeNull()
    // A record must survive the surveys with no date at all landing in one month.
    expect(mostSince('2026-09', 20, counts, { byMonth: new Map(), unplaced: 5 })).toBe('record')
    expect(mostSince('2026-09', 20, counts, { byMonth: new Map(), unplaced: 6 })).toBeNull()
    // An earlier month with only undated deliveries still counts as history.
    expect(mostSince('2026-09', 20, new Map([['2026-08', 11]]), { byMonth: new Map([['2026-06', 3], ['2026-07', 3]]), unplaced: 0 })).toBe('record')
  })

  it('a record claim gives way to the comparison when undated surveys could reach it', () => {
    const m = model(
      [...many(14, { deliver_date: '2026-08-10' }), ...many(10, { deliver_date: '2026-07-10' }), ...many(8, { deliver_date: '2026-06-10' }),
        ...many(8, { deliver_date: '2026-05-10' }), ...many(5, { deliver_date: null })],
      { filter: F({ range: { preset: 'last-month', from: null, to: null } }) },
    )
    expect(m.headline).toBe('The team delivered 14 studies in August, up from 10 in 1–31 Jul 2026.')
  })

  it('the undated drills list exactly what the tile counts', () => {
    const ps = [P({ deliver_date: '2026-09-02' }), ...undatedDue(2, '2026-09-10'), ...undatedDue(3, '2026-04-10'), P({ deliver_date: null })]
    const m = model(ps)
    expect(m.undatedDelivered).toBe(6)
    expect(m.undated).toEqual({ inRange: 2, inPrev: 0, unplaced: 1 })
    expect(drillRows(m.items, m.filter, { kind: 'delivered', undated: 'all' }, TODAY, ACCOUNTS)).toHaveLength(m.undatedDelivered)
    expect(drillRows(m.items, m.filter, { kind: 'delivered', undated: 'range' }, TODAY, ACCOUNTS)).toHaveLength(m.undated.inRange)
  })
})

describe('naming the x axis: what a reader can read off a month chart', () => {
  const LAST_12 = F({ range: { preset: 'last-12-months', from: null, to: null } })
  // The two trend charts sit in one half of a md:grid-cols-2 inside a
  // max-w-6xl page, so their card is 534px wide at every viewport past about
  // 1200px, and narrower below that. Both widths are measured here, because
  // they answer different questions.
  //
  // WIDE (the common case): 1152 → halved with a 16px gap → 568 → less the
  // card's border and px-4 → 534. A LineChart spends ~34px on its y tick
  // labels and ~30px on the right, so eleven gaps share ~446px: a ~40px step.
  const WIDE_STEP = (534 - 34 - 30 - 24) / 11
  // NARROW (a 1024px laptop): a 446px card, the same reserves, a ~33px step.
  const NARROW_STEP = (446 - 34 - 30 - 24) / 11
  const FONT = 11
  const SMALL = 10
  const twelve = () => model([P({ deliver_date: '2026-09-02' })], { filter: LAST_12 }).months

  it('draws a narrow month-and-year on the axis and keeps the full month for people', () => {
    const ms = twelve()
    expect(ms).toHaveLength(12)
    expect(ms[0]).toMatchObject({ key: '2025-10', short: 'Oct 25', long: 'October 2025' })
    expect(ms[11]).toMatchObject({ key: '2026-09', short: 'Sep 26', long: 'September 2026' })
  })

  it('a window inside one year drops the year: it is in the date range on every card', () => {
    const ms = model([P({ deliver_date: '2026-09-02' })]).months
    expect(ms.map(x => x.short)).toEqual(['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'])
    // …but the tooltip, the table and the drill heading still say which year.
    expect(ms[5].long).toBe('September 2026')
  })

  it('the narrow form names every month on the wide panel, where the long form cannot', () => {
    const ms = twelve()
    expect(textWidth('Sep 26', FONT)).toBeLessThan(textWidth('Sep 2026', FONT))
    expect(textWidth('Sep 2026', FONT)).toBeLessThan(textWidth('September 2026', FONT))
    const drawn = fitAxisLabels(ms.map(x => x.short), WIDE_STEP, FONT, { minFontSize: SMALL })
    const ifLong = fitAxisLabels(ms.map(x => x.long), WIDE_STEP, FONT, { minFontSize: SMALL })
    // David's case, at the width his screen gives it: all twelve named.
    expect(drawn.picks).toHaveLength(12)
    // …where drawing "September 2026" on the axis would name a third of them.
    expect(ifLong.picks.length).toBeLessThan(drawn.picks.length)
  })

  it('still names both ends and only whole months when the panel is narrower', () => {
    const ms = twelve()
    const drawn = fitAxisLabels(ms.map(x => x.short), NARROW_STEP, FONT, { minFontSize: SMALL })
    expect(drawn.picks.length).toBeLessThan(12)
    expect(drawn.picks[0]).toBe(0)
    expect(drawn.picks[drawn.picks.length - 1]).toBe(11)
    // Evenly spaced between the ends, so a reader can count the ticks between
    // two names instead of re-learning the interval.
    const gaps = drawn.picks.slice(1).map((p, i) => p - drawn.picks[i])
    expect(new Set(gaps.slice(1)).size).toBe(1)
  })

  it('every drawn label carries the year, because a thinned axis drops the January one', () => {
    const ms = twelve()
    // What we do: the year on every label. Nothing the axis prints is
    // ambiguous, whichever labels survive, at either width.
    for (const step of [WIDE_STEP, NARROW_STEP]) {
      for (const i of fitAxisLabels(ms.map(x => x.short), step, FONT, { minFontSize: SMALL }).picks) {
        expect(ms[i].short).toMatch(/^[A-Z][a-z]{2} \d{2}$/)
      }
    }
    // What we do NOT do: mark the year only where it changes. It is narrower,
    // and on the wide panel it costs nothing — but as soon as the axis has to
    // thin, "Jan 26" is no more likely to survive than any other month, and
    // the labels that do survive around it say nothing about their year.
    const atChange = ms.map((x, i) => (i === 0 || x.key.endsWith('-01') ? x.short : x.short.slice(0, 3)))
    const kept = fitAxisLabels(atChange, NARROW_STEP, FONT, { minFontSize: SMALL }).picks
    expect(kept.length).toBeLessThan(12)
    const yearless = kept.filter(i => !/\d{2}$/.test(atChange[i]))
    expect(yearless.length).toBeGreaterThan(0)
  })
})

describe('goals are named once', () => {
  it('exposes the goals the charts draw', () => {
    expect(ON_TIME_GOAL).toBeGreaterThan(0)
    expect(ON_TIME_GOAL).toBeLessThanOrEqual(1)
    expect(CYCLE_DAYS_GOAL).toBeGreaterThan(0)
  })
})

/**
 * WHERE CYCLE TIME STARTS, after migration 128 split "we have it" from "we have
 * agreed what it asks".
 *
 * David asked directly whether the new stage would disturb the analytics. These
 * are the answers to that question, asserted rather than promised: history does
 * not move, new work measures the shorter interval, and a month that mixes the
 * two definitions can be identified instead of silently averaged.
 */
describe('cycleStartOf: the changeover from submitted to greenlit', () => {
  const cycleOf = (p: InsightsProject) => itemsOf([p], null).items[0]

  it('measures from submitted_date when a study predates the stage', () => {
    // greenlit_at is deliberately NOT backfilled, so this is every study that
    // existed before 2026-09-29. The number must be the number it always was.
    const it0 = cycleOf(P({ submitted_date: '2026-09-01', deliver_date: '2026-09-21' }))
    expect(it0.cycleDays).toBe(20)
    expect(it0.cycleFromGreenlit).toBe(false)
  })

  it('measures from greenlit_at once the questions have a recorded approval', () => {
    // The whole point: the fortnight the questionnaire spent with the client is
    // no longer counted as delivery time.
    const it0 = cycleOf(P({
      submitted_date: '2026-09-01', greenlit_at: '2026-09-15', deliver_date: '2026-09-21',
    }))
    expect(it0.cycleDays).toBe(6)
    expect(it0.cycleFromGreenlit).toBe(true)
  })

  it('still reports a backwards pair as a data error, not as a negative cycle', () => {
    // Greenlit AFTER delivery is impossible, and must land in the same bucket
    // the old backwards-dates check used rather than quietly producing -8.
    const it0 = cycleOf(P({
      submitted_date: '2026-09-01', greenlit_at: '2026-09-29', deliver_date: '2026-09-21',
    }))
    expect(it0.cycleDays).toBeNull()
    expect(it0.cycleBackwards).toBe(true)
    expect(it0.cycleFromGreenlit).toBe(false)
  })

  it('lets a mixed month be identified rather than averaged blind', () => {
    const { items } = itemsOf([
      P({ submitted_date: '2026-09-01', deliver_date: '2026-09-21' }),
      P({ submitted_date: '2026-09-01', greenlit_at: '2026-09-15', deliver_date: '2026-09-21' }),
    ], null)
    expect(items.map(i => i.cycleFromGreenlit)).toEqual([false, true])
    // Both still produce a cycle time; the flag is what makes the difference
    // between them legible, and neither is dropped from the median.
    expect(items.every(i => i.cycleDays != null)).toBe(true)
  })
})

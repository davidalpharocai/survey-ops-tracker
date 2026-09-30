import { describe, it, expect } from 'vitest'
import {
  addMonths, buildThisWeekModel, BUY_MULTIPLE, COLLAPSE_AFTER, creditPoolDrill, daysBetween, holdSinceOf, thisWeekDrills,
  VERB_META,
  type Extra, type HoldSince, type SeriesRecord, type ThisWeekInput, type WeekLaunch, type WeekProject,
  type WeekSupplier, type WeekTerm,
} from './thisWeek'
import { buildIndex, type FinBlast, type FinCost } from './hub'
import { DEFAULT_FILTER, itemsOf, populationFor, sideBucketFor, type FinanceFilter } from './filters'
import { reconcile } from './drill'
import type { FinanceTable } from './load'

const TODAY = '2026-09-28'

const P = (o: Partial<WeekProject> = {}): WeekProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'Survey', client: 'BAM', client_id: 'acc1',
  project_type: 'B2B', board_column: 'Fielding', status: 'Open', phase: 'Active',
  deliver_date: '2026-10-15', launch_date: null, submitted_date: null,
  n_target: null, n_collected: 0, n_actual: null, captain_id: 'cap1', ...o,
})
/** A blast worth exactly `dollars` (bid $1 × completes). */
const B = (project_id: string, dollars: number, completes = dollars): FinBlast =>
  ({ project_id, bid: completes > 0 ? dollars / completes : 0, completes, people: 0, cost_per_send: 0, channel: 'email' })
const S = (project_id: string, cpi: number, n_collected: number, launch_id: string | null = null): WeekSupplier =>
  ({ project_id, cpi, n_collected, launch_id })

const ok = <T,>(value: T): Extra<T> => ({ state: 'ok', value })

interface Book {
  projects: WeekProject[]
  blasts?: FinBlast[]
  suppliers?: WeekSupplier[]
  launches?: WeekLaunch[]
  costs?: FinCost[]
  rates?: [string, number][]
  terms?: WeekTerm[]
  series?: Extra<SeriesRecord[]>
  holdSince?: Extra<Map<string, HoldSince>>
  termDollars?: Extra<Map<string, number | null>>
  filter?: FinanceFilter
  blocked?: FinanceTable[]
  priceBlocked?: string | null
}

function input(b: Book): ThisWeekInput {
  const blasts = b.blasts ?? [], suppliers = b.suppliers ?? [], costs = b.costs ?? []
  const ix = buildIndex(blasts, suppliers, costs)
  const items = itemsOf(b.projects, blasts, suppliers, costs, ix)
  const filter = b.filter ?? DEFAULT_FILTER
  return {
    population: populationFor(items, 'this-week', filter, TODAY),
    side: sideBucketFor(items, 'this-week', filter, TODAY),
    items,
    projects: b.projects,
    rates: new Map(b.rates ?? []),
    blasts, suppliers, launches: b.launches ?? [], costs, ix,
    terms: b.terms ?? [],
    filter,
    today: TODAY,
    accountName: id => (id === 'acc1' ? 'BAM' : id === 'acc2' ? 'DE Shaw' : id === 'acc3' ? 'UBS' : '(unknown account)'),
    blocked: b.blocked ?? [],
    priceBlocked: b.priceBlocked ?? null,
    termDollars: b.termDollars ?? ok(new Map()),
    series: b.series ?? ok([]),
    holdSince: b.holdSince ?? ok(new Map()),
    owners: ok(new Map([['cap1', 'Jenna']])),
  }
}
const model = (b: Book) => buildThisWeekModel(input(b))
const rowsOf = (m: ReturnType<typeof model>, verb: string) =>
  verb === 'hold' ? m.hold.rows : m.groups.find(g => g.verb === verb)!.rows
const ids = (m: ReturnType<typeof model>, verb: string) => rowsOf(m, verb).map(r => r.id)

describe('FREEZE THE BID and CONFIRM FINAL N: past half the price', () => {
  // $10 × 100 sold = a $1,000 contract; the 50% goal is $500.
  const priced = (o: Partial<WeekProject>) => P({ n_target: 100, budget: 400, ...o })

  it('does not fire at exactly half the price, and fires a cent past it', () => {
    const at = model({ projects: [priced({ id: 'a' })], blasts: [B('a', 500)], rates: [['a', 10]] })
    expect(ids(at, 'freeze')).toEqual([])
    const past = model({ projects: [priced({ id: 'a' })], blasts: [B('a', 500.01, 100)], rates: [['a', 10]] })
    expect(ids(past, 'freeze')).toEqual(['a'])
    const r = rowsOf(past, 'freeze')[0]
    expect(r.stake).toBeCloseTo(0.01, 6)
    expect(r.happened).toContain('of its $1,000 contract')
    expect(r.happened).toContain('past its $400 budget')
    expect(r.action).toBe('Freeze the bid: no higher reward and no new blast without sign-off.')
    expect(r.owner).toBe('Jenna')
  })

  it('says CONFIRM FINAL N instead once the survey is in QA', () => {
    const m = model({ projects: [priced({ id: 'a', board_column: 'Data QA' })], blasts: [B('a', 710)], rates: [['a', 10]] })
    expect(ids(m, 'freeze')).toEqual([])
    expect(ids(m, 'confirm')).toEqual(['a'])
    expect(rowsOf(m, 'confirm')[0].stake).toBeCloseTo(210, 6)
    expect(rowsOf(m, 'confirm')[0].happened).toContain('buying has stopped')
  })

  it('never calls a $0 price "past half": $0 never divides', () => {
    const m = model({ projects: [priced({ id: 'a' })], blasts: [B('a', 900)], rates: [['a', 0]] })
    expect(ids(m, 'freeze')).toEqual([])
    expect(ids(m, 'price')).toEqual([]) // $0 IS a price
    expect(rowsOf(m, 'budget')).toEqual([]) // it has a budget
    const bullet = buildThisWeekModel(input({ projects: [priced({ id: 'a', budget: null })], blasts: [B('a', 900)], rates: [['a', 0]] }))
    const b = rowsOf(bullet, 'budget')[0]
    expect(b.bullet).toMatchObject({ contract: 0, goal: null, missing: null })
    expect(b.action).toContain('priced at $0')
  })

  it('ranks by dollars at stake', () => {
    const m = model({
      projects: [priced({ id: 'small', project_code: 'PR1' }), priced({ id: 'big', project_code: 'PR2' })],
      blasts: [B('small', 600), B('big', 950)],
      rates: [['small', 10], ['big', 10]],
    })
    expect(ids(m, 'freeze')).toEqual(['big', 'small'])
  })

  it('is blocked, not empty, when prices did not load', () => {
    const m = model({
      projects: [priced({ id: 'a' })], blasts: [B('a', 900)], rates: [['a', 10]],
      priceBlocked: 'Blocked: project_financials returned no prices',
    })
    const g = m.groups.find(x => x.verb === 'freeze')!
    expect(g.rows).toEqual([])
    expect(g.blocked).toEqual(['Blocked: project_financials returned no prices'])
    expect(m.clear).not.toContain('freeze')
    expect(m.header.sentence).toContain('Blocked: project_financials returned no prices')
  })
})

describe('STOP BUYING: past the route’s buy multiple', () => {
  it('panel: not at exactly 1.6× the N sold, yes one past it', () => {
    const at = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 160 })], suppliers: [S('a', 1, 160)] })
    expect(ids(at, 'stop')).toEqual([])
    const past = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 161 })], suppliers: [S('a', 1, 161)] })
    expect(ids(past, 'stop')).toEqual(['a'])
    expect(rowsOf(past, 'stop')[0].stakeText).toContain('1 complete past the multiple')
    expect(BUY_MULTIPLE.panel).toBe(1.6)
  })

  it('blast: 1.4×', () => {
    const at = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 140 })], blasts: [B('a', 140)] })
    expect(ids(at, 'stop')).toEqual([])
    const past = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 141 })], blasts: [B('a', 141)] })
    expect(ids(past, 'stop')).toEqual(['a'])
    expect(rowsOf(past, 'stop')[0].action).toBe('Stop buying: send no more blasts on this study.')
  })

  it('both routes use the more generous panel multiple', () => {
    const m = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 150 })], blasts: [B('a', 75)], suppliers: [S('a', 1, 75)] })
    expect(ids(m, 'stop')).toEqual([])
  })

  it('measures against the top of a sold range', () => {
    const m = model({ projects: [P({ id: 'a', n_target: 100, n_target_max: 120, n_collected: 180 })], suppliers: [S('a', 1, 180)] })
    expect(ids(m, 'stop')).toEqual([]) // 120 × 1.6 = 192
  })

  it('does not fire once buying has stopped (QA)', () => {
    const m = model({ projects: [P({ id: 'a', board_column: 'Data QA', n_target: 100, n_collected: 300 })], suppliers: [S('a', 1, 300)] })
    expect(ids(m, 'stop')).toEqual([])
  })

  it('uses the multiple measured on delivered surveys when there are enough, and says so', () => {
    // Eight delivered panel surveys that each kept 100 of 125 bought: the
    // measured multiple is 1 ÷ 0.8 = 1.25, not the 1.6 default.
    const done = Array.from({ length: 8 }, (_, i) => P({
      id: `d${i}`, project_code: `PR9${i}`, board_column: 'Delivery', status: 'Closed',
      deliver_date: '2026-08-01', n_target: 100, n_collected: 125, n_actual: 100,
    }))
    const doneRows = done.map(p => S(p.id, 1, 125))
    const at = model({ projects: [...done, P({ id: 'a', n_target: 100, n_collected: 125 })], suppliers: [...doneRows, S('a', 1, 125)] })
    expect(ids(at, 'stop')).toEqual([])
    const past = model({ projects: [...done, P({ id: 'a', n_target: 100, n_collected: 126 })], suppliers: [...doneRows, S('a', 1, 126)] })
    expect(ids(past, 'stop')).toEqual(['a'])
    expect(rowsOf(past, 'stop')[0].happened).toContain('past 1.25× (125), the panel buy multiple, measured on 8 delivered panel studies')
    expect(past.groups.find(g => g.verb === 'stop')!.meta.rule).toContain('1.25× panel (measured on 8 delivered panel studies)')
    expect(past.groups.find(g => g.verb === 'stop')!.meta.rule).toContain('1.4× blast (the default')
  })

  it('outranks FREEZE THE BID on the same survey, and still says it is past half its price', () => {
    const m = model({
      projects: [P({ id: 'a', n_target: 100, n_collected: 200, budget: 1 })],
      suppliers: [S('a', 5, 200)], rates: [['a', 10]],
    })
    expect(ids(m, 'stop')).toEqual(['a'])
    expect(ids(m, 'freeze')).toEqual([])
    expect(rowsOf(m, 'stop')[0].happened).toContain('It has also spent')
  })
})

describe('CAP THE WAVE: a live PureSpectrum wave past its own target', () => {
  it('not at the wave target, yes one past it, with the spec’s words', () => {
    const launches = [{ id: 'L1', project_id: 'a', target: 50, label: 'Wave 1' }]
    const at = model({ projects: [P({ id: 'a', n_target: 200 })], suppliers: [S('a', 2, 30, 'L1'), S('a', 2, 20, 'L1')], launches })
    expect(ids(at, 'cap')).toEqual([])
    const past = model({ projects: [P({ id: 'a', n_target: 200 })], suppliers: [S('a', 2, 30, 'L1'), S('a', 2, 21, 'L1')], launches })
    expect(ids(past, 'cap')).toEqual(['a'])
    const r = rowsOf(past, 'cap')[0]
    expect(r.action).toBe('Set the supplier Goal in PureSpectrum; SOCC’s cap is a record, not a limit.')
    expect(r.happened).toContain('Wave 1 collected 51 against a wave target of 50 (+1)')
    expect(r.stake).toBeCloseTo(2, 6)
  })

  it('names the waves it cannot see, is never "clear" while it cannot, and is blocked when launches did not load', () => {
    const m = model({ projects: [P({ id: 'a' })], suppliers: [S('a', 2, 30, 'L1')], launches: [{ id: 'L1', project_id: 'a', target: null }] })
    expect(m.groups.find(g => g.verb === 'cap')!.note).toContain('no wave target')
    expect(m.clear).not.toContain('cap')
    const b = model({ projects: [P({ id: 'a' })], blocked: ['project_launches'] })
    expect(b.groups.find(g => g.verb === 'cap')!.blocked).toEqual(['Blocked: project_launches did not load'])
  })
})

describe('SET A BUDGET and PRICE IT', () => {
  it('SET A BUDGET needs spend: $0 spent is no row, any spend without a budget is', () => {
    expect(ids(model({ projects: [P({ id: 'a' })] }), 'budget')).toEqual([])
    const m = model({ projects: [P({ id: 'a', n_target: 100 })], blasts: [B('a', 10)], rates: [['a', 20]] })
    expect(ids(m, 'budget')).toEqual(['a'])
    // 50% × $20 × 100 — a suggestion, never a rule.
    expect(rowsOf(m, 'budget')[0].action).toContain('Suggested: $1,000')
    expect(rowsOf(m, 'budget')[0].action).toContain('not a rule')
    expect(ids(model({ projects: [P({ id: 'a', budget: 500 })], blasts: [B('a', 10)] }), 'budget')).toEqual([])
  })

  it('PRICE IT: no price, or no target; both present is no row', () => {
    const m = model({
      projects: [P({ id: 'none', n_target: 100 }), P({ id: 'notarget', n_target: null }), P({ id: 'fine', n_target: 100 })],
      rates: [['notarget', 5], ['fine', 5]],
    })
    expect(ids(m, 'price').sort()).toEqual(['none', 'notarget'])
    expect(rowsOf(m, 'price').find(r => r.id === 'notarget')!.action).toBe('Enter the N target on the project page.')
  })

  it('ranks PRICE IT by spend', () => {
    const m = model({
      projects: [P({ id: 'a', project_code: 'A' }), P({ id: 'b', project_code: 'B' })],
      blasts: [B('a', 5), B('b', 50)],
    })
    expect(ids(m, 'price')).toEqual(['b', 'a'])
  })
})

describe('Hold is its own bucket', () => {
  const book: Book = {
    projects: [
      P({ id: 'live', n_target: 100 }),
      P({ id: 'held', status: 'Hold', n_target: 100, n_collected: 40 }),
    ],
    blasts: [B('live', 100), B('held', 900)],
    rates: [['live', 10], ['held', 10]],
  }

  it('never enters a live figure', () => {
    const m = model(book)
    expect(m.header.live).toBe(1)
    expect(m.header.spent).toBe(100)
    expect(m.header.worthAtTarget).toBe(1000)
    expect(m.header.holds).toBe(1)
    expect(m.header.holdSpend).toBe(900)
    // Past half its price, but on hold: RESUME OR CANCEL, never FREEZE.
    expect(ids(m, 'freeze')).toEqual([])
    expect(m.groups.flatMap(g => g.rows).some(r => r.id === 'held')).toBe(false)
    expect(ids(m, 'hold')).toEqual(['held'])
    expect(m.header.sentence).toContain('1 on hold, counted on their own')
  })

  it('stays out even if a caller puts a held survey in the live population', () => {
    const inp = input(book)
    const mixed = buildThisWeekModel({ ...inp, population: [...inp.population, ...inp.side] })
    expect(mixed.header.live).toBe(1)
    expect(mixed.header.spent).toBe(100)
  })

  it('shows days on hold only for a real status change, and "since unknown" otherwise', () => {
    const since = holdSinceOf([
      { project_id: 'a', field: 'status', old_value: 'Open', new_value: 'Hold', changed_by: 'jenna@alpharoc.ai', changed_at: '2026-09-01T15:00:00Z' },
      { project_id: 'b', field: 'status', old_value: 'Open', new_value: 'Hold', changed_by: 'system', changed_at: '2026-09-01T15:00:00Z' },
      { project_id: 'c', field: 'board_column', old_value: 'Fielding', new_value: 'Data QA', changed_by: 'x@y', changed_at: '2026-09-01T15:00:00Z' },
      // A real hold that was later overwritten by a sync stamp: the LATEST change into Hold decides.
      { project_id: 'd', field: 'status', old_value: 'Open', new_value: 'Hold', changed_by: 'x@y', changed_at: '2026-08-01T15:00:00Z' },
      { project_id: 'd', field: 'status', old_value: 'Hold', new_value: 'Open', changed_by: 'x@y', changed_at: '2026-08-05T15:00:00Z' },
      { project_id: 'd', field: 'status', old_value: 'Open', new_value: 'Hold', changed_by: 'system', changed_at: '2026-08-06T15:00:00Z' },
    ], ['a', 'b', 'c', 'd'])
    expect(since.get('a')).toEqual({ since: '2026-09-01', by: 'jenna', why: 'recorded' })
    expect(since.get('b')).toMatchObject({ since: null, why: 'sync-only' })
    expect(since.get('c')).toMatchObject({ since: null, why: 'no-record' })
    expect(since.get('d')).toMatchObject({ since: null, why: 'sync-only' })

    const m = model({ ...book, holdSince: ok(new Map([['held', { since: '2026-09-01', by: 'jenna', why: 'recorded' as const }]])) })
    expect(rowsOf(m, 'hold')[0].happened).toContain('On hold 27 days')
    const u = model({ ...book, holdSince: ok(new Map([['held', { since: null, by: null, why: 'sync-only' as const }]])) })
    expect(rowsOf(u, 'hold')[0].happened).toContain('since unknown')
    const blocked = model({ ...book, holdSince: { state: 'blocked', table: 'project_audit' } })
    expect(rowsOf(blocked, 'hold')[0].happened).toContain('since unknown (project_audit did not load)')
  })

  it('every hold gets a RESUME OR CANCEL row, ranked by spend', () => {
    const m = model({
      projects: [P({ id: 'h1', status: 'Hold', project_code: 'H1' }), P({ id: 'h2', status: 'Hold', project_code: 'H2' })],
      blasts: [B('h1', 10), B('h2', 50)],
    })
    expect(ids(m, 'hold')).toEqual(['h2', 'h1'])
    expect(rowsOf(m, 'hold')[0].action).toContain('Resume H2 or cancel it')
  })
})

describe('Scoping is counted and never in the pipeline', () => {
  it('counts scoping, never values it', () => {
    const m = model({
      projects: [
        P({ id: 'live', n_target: 100 }),
        P({ id: 'quote', phase: 'Scoping', status: 'Open', board_column: 'Submitted', n_target: 1000 }),
      ],
      rates: [['live', 10], ['quote', 100]],
    })
    expect(m.header.scoping).toBe(1)
    expect(m.header.worthAtTarget).toBe(1000)
    expect(m.header.pricedWithTarget).toBe(1)
    expect(m.header.pricedIds).toEqual(['live'])
    expect(m.groups.flatMap(g => g.rows).some(r => r.id === 'quote')).toBe(false)
    expect(m.header.sentence).toContain('Unsold scoping: 1 study, not counted.')
  })
})

describe('Fixtures the contract asks for', () => {
  it('an empty placeholder is nowhere; one holding data is live work', () => {
    const m = model({
      projects: [P({ id: 'shell', is_placeholder: true }), P({ id: 'real', is_placeholder: true })],
      blasts: [B('real', 25)],
    })
    expect(m.header.live).toBe(1)
    expect(m.header.liveIds).toEqual(['real'])
  })

  it('a live survey with no date is still live work (the date does not apply)', () => {
    const m = model({ projects: [P({ id: 'a', deliver_date: null })], filter: { ...DEFAULT_FILTER, range: { preset: 'last-month', from: null, to: null } } })
    expect(m.header.live).toBe(1)
  })

  it('a partial segment N actual changes nothing on a live survey', () => {
    const m = model({
      projects: [P({ id: 'a', n_target: 100, n_actual: 40, segments: [
        { id: 's1', project_id: 'a', n_target: 50, n_actual: 40 },
        { id: 's2', project_id: 'a', n_target: 50, n_actual: null },
      ] })],
      rates: [['a', 10]],
    })
    expect(m.header.worthAtTarget).toBe(1000)
  })

  it('the route filter applies; the date filter does not', () => {
    const book: Book = {
      projects: [P({ id: 'b1' }), P({ id: 'p1' })],
      blasts: [B('b1', 10)], suppliers: [S('p1', 1, 10)],
    }
    expect(model({ ...book, filter: { ...DEFAULT_FILTER, route: 'panel' } }).header.liveIds).toEqual(['p1'])
  })
})

describe('CONVERT THE TRIAL: delivered at $0, nothing paid since', () => {
  const trial = (o: Partial<WeekProject> = {}) =>
    P({ id: 't', client_id: 'acc3', board_column: 'Delivery', status: 'Closed', deliver_date: '2026-09-10', n_actual: 1200, ...o })

  it('lists a $0 trial with no paid survey since, at our cost', () => {
    const m = model({ projects: [trial()], blasts: [B('t', 3430)], rates: [['t', 0]] })
    expect(ids(m, 'trial')).toEqual(['t'])
    const r = rowsOf(m, 'trial')[0]
    expect(r.stake).toBe(3430)
    expect(r.happened).toContain('UBS got 1,200 respondents free on 1 study')
    expect(r.happened).toContain('never bought a priced study')
  })

  it('rolls several trials at one account into one row', () => {
    const m = model({
      projects: [trial(), trial({ id: 't2', project_code: 'PR00002', deliver_date: '2026-09-01', n_actual: 1223 })],
      blasts: [B('t', 1000), B('t2', 2430)], rates: [['t', 0], ['t2', 0]],
    })
    expect(rowsOf(m, 'trial')).toHaveLength(1)
    expect(rowsOf(m, 'trial')[0].id).toBe('t') // the latest
    expect(rowsOf(m, 'trial')[0].also.map(a => a.id)).toEqual(['t2'])
    expect(rowsOf(m, 'trial')[0].happened).toContain('2,423 respondents free on 2 studies')
  })

  it('a paid survey delivered after it, or any live paid work, means it converted', () => {
    const after = P({ id: 'paid', client_id: 'acc3', board_column: 'Delivery', status: 'Closed', deliver_date: '2026-09-20' })
    expect(ids(model({ projects: [trial(), after], rates: [['t', 0], ['paid', 5]] }), 'trial')).toEqual([])
    const live = P({ id: 'paid', client_id: 'acc3', deliver_date: '2026-12-01' })
    expect(ids(model({ projects: [trial(), live], rates: [['t', 0], ['paid', 5]] }), 'trial')).toEqual([])
    const before = P({ id: 'paid', client_id: 'acc3', board_column: 'Delivery', status: 'Closed', deliver_date: '2026-08-01' })
    const m = model({ projects: [trial(), before], rates: [['t', 0], ['paid', 5]] })
    expect(ids(m, 'trial')).toEqual(['t'])
    expect(rowsOf(m, 'trial')[0].happened).toContain('last paid study was delivered 1 Aug')
  })

  it('an unpriced delivered survey is not a trial', () => {
    expect(ids(model({ projects: [trial()], blasts: [B('t', 100)] }), 'trial')).toEqual([])
  })

  it('AlphaROC’s own $0 work is not a trial, and it is not asked to be priced', () => {
    const inp = input({
      projects: [trial({ client_id: 'own' }), P({ id: 'ownlive', client_id: 'own' })],
      blasts: [B('t', 100), B('ownlive', 50)], rates: [['t', 0]],
    })
    const m = buildThisWeekModel({ ...inp, accountName: id => (id === 'own' ? 'AlphaROC' : inp.accountName(id)) })
    expect(rowsOf(m, 'trial')).toEqual([])
    expect(m.groups.find(g => g.verb === 'trial')!.note).toContain('our own work is not a trial')
    expect(rowsOf(m, 'price')).toEqual([])
    expect(m.groups.find(g => g.verb === 'price')!.note).toContain('1 live AlphaROC study is left out')
    expect(ids(m, 'budget')).toEqual(['ownlive']) // it still needs a ceiling
  })
})

describe('TOP UP THE CONTRACT and the credit pools', () => {
  const term: WeekTerm = { id: 'T', client_id: 'acc2', name: '2026 Contract', credits_total: 375, starts_on: '2026-03-30', renews_on: '2027-03-29' }
  const drew = (id: string, credits: number, o: Partial<WeekProject> = {}) =>
    P({ id, project_code: id, client_id: 'acc2', term_id: 'T', credits, board_column: 'Delivery', status: 'Closed', deliver_date: '2026-08-01', n_target: 100, n_actual: 100, ...o })

  it('no row when drawn equals the pool; a row one credit past it', () => {
    const at = model({ projects: [drew('a', 300), drew('b', 75, { board_column: 'Fielding', status: 'Open' })], terms: [term] })
    expect(ids(at, 'topup')).toEqual([])
    expect(at.pools[0]).toMatchObject({ used: 375, over: 0, delivered: 300, live: 75 })
    const past = model({ projects: [drew('a', 300), drew('b', 76, { board_column: 'Fielding', status: 'Open' })], terms: [term] })
    expect(ids(past, 'topup')).toHaveLength(1)
    expect(past.pools[0].over).toBe(1)
  })

  it('never counts credits on held work as drawn', () => {
    const m = model({ projects: [drew('a', 375), drew('h', 50, { board_column: 'Fielding', status: 'Hold' })], terms: [term] })
    expect(m.pools[0]).toMatchObject({ used: 375, hold: 50, over: 0 })
    expect(ids(m, 'topup')).toEqual([])
  })

  it('derives the dollar value from the contract’s own priced surveys, and says so', () => {
    // 20 credits for a delivered $4,000 survey: $200 per credit implied.
    const m = model({
      projects: [drew('a', 385, { credits: 385 }), drew('b', 20, { deliver_date: '2026-09-01', n_target: 20, n_actual: 20 })],
      terms: [term], rates: [['b', 200]],
    })
    const r = rowsOf(m, 'topup')[0]
    expect(r.derived).toBe(true)
    // 385 + 20 = 405 drawn, 30 over; the implied rate is the median of a's (no
    // price, left out) and b's $200.
    expect(m.pools[0].perCredit).toMatchObject({ source: 'implied', value: 200, n: 1 })
    expect(r.stake).toBe(30 * 200)
    expect(r.stakeText).toContain('derived')
    expect(r.stakeText).toContain('implied by 1 priced study')
    expect(r.id).toBe('b') // the most recent survey drawing on it
  })

  it('prefers the contract value on file (client_term_financials) when one exists', () => {
    const m = model({
      projects: [drew('a', 400)], terms: [term],
      termDollars: ok(new Map([['T', 75_000]])),
    })
    expect(m.pools[0].perCredit).toMatchObject({ source: 'agreed', value: 200 })
    expect(rowsOf(m, 'topup')[0].stakeText).toContain('from the contract value on file')
  })

  it('shows queued priced work that carries no credits', () => {
    const m = model({
      projects: [drew('a', 380), P({ id: 'q', project_code: 'PR00478', client_id: 'acc2', n_target: 100 })],
      terms: [term], rates: [['q', 140]],
    })
    expect(m.pools[0].queued).toMatchObject({ ids: ['q'], value: 14_000 })
    expect(rowsOf(m, 'topup')[0].happened).toContain('PR00478 ($14,000 at target) is queued with no credits')
  })

  it('lists queued work under the contract in force, never under two contracts', () => {
    const renewal: WeekTerm = { id: 'T2', client_id: 'acc2', name: '2026 - 2027 Contract', credits_total: null, starts_on: null, renews_on: null }
    const m = model({
      projects: [drew('a', 10), P({ id: 'q', project_code: 'PR00478', client_id: 'acc2', n_target: 100 })],
      terms: [renewal, term], rates: [['q', 140]],
    })
    const byId = new Map(m.pools.map(p => [p.termId, p]))
    expect(byId.get('T')!.queued.ids).toEqual(['q'])
    expect(byId.get('T2')!.queued.ids).toEqual([])
  })

  it('computes the share of the term elapsed', () => {
    const m = model({ projects: [drew('a', 10)], terms: [term] })
    expect(m.pools[0].elapsed).toBeCloseTo(daysBetween('2026-03-30', TODAY) / daysBetween('2026-03-30', '2027-03-29'), 6)
  })

  it('follows the account filter', () => {
    const m = model({ projects: [drew('a', 10)], terms: [term], filter: { ...DEFAULT_FILTER, account: 'acc1' } })
    expect(m.pools).toEqual([])
  })

  it('the pool drill lists delivered and live draws and reconciles against the raw survey list', () => {
    const inp = input({
      projects: [drew('a', 300), drew('b', 80, { board_column: 'Fielding', status: 'Open' }), drew('h', 50, { status: 'Hold', board_column: 'Fielding' })],
      terms: [term],
    })
    const m = buildThisWeekModel(inp)
    const spec = creditPoolDrill(inp, m.pools[0])
    expect(spec.rows.map(r => r.id)).toEqual(['a', 'b'])
    const rec = reconcile(spec)
    expect(rec.ok).toBe(true)
    expect(rec.rowSum).toBe(m.pools[0].used)
  })
})

describe('CHECK THE SERIES: computed from the last DELIVERED wave', () => {
  const series: SeriesRecord = { id: 'S', client_id: 'acc1', survey_name: 'POS Study', cadence_months: 3, paused: false, in_service: true, resume_anchor: null }
  const wave = (id: string, n: number, o: Partial<WeekProject> = {}) =>
    P({ id, project_code: id, series_id: 'S', rerun_number: n, n_target: 80, ...o })
  const delivered = (id: string, n: number, date: string, o: Partial<WeekProject> = {}) =>
    wave(id, n, { board_column: 'Delivery', status: 'Closed', deliver_date: date, n_actual: 80, ...o })

  it('is due from the last delivered wave plus cadence, not from a spawned shell', () => {
    // W2 delivered 23 Jun; due 23 Sep. W3 is an empty shell the spawner made,
    // dated in November — counting it (as rerun_series_status does) would push
    // the due date to February and hide the lapse.
    const m = model({
      projects: [
        delivered('W1', 1, '2026-03-23'),
        delivered('W2', 2, '2026-06-23'),
        wave('W3', 3, { is_placeholder: true, deliver_date: '2026-11-20', rerun_date: '2026-11-15' }),
      ],
      series: ok([series]),
      rates: [['W2', 150]],
    })
    const rows = rowsOf(m, 'series')
    expect(rows).toHaveLength(1)
    expect(rows[0].happened).toContain('last delivered 23 Jun (W2)')
    expect(rows[0].happened).toContain('due 23 Sep, 5 days ago')
    expect(rows[0].happened).toContain('The next wave, W3, is planned for 15 Nov')
    expect(rows[0].id).toBe('W3')
    expect(rows[0].also.map(a => a.id)).toEqual(['W2'])
    expect(rows[0].stake).toBe(150 * 80)
  })

  it('is quiet while the next wave is buying', () => {
    const m = model({
      projects: [delivered('W2', 2, '2026-06-23'), wave('W3', 3)],
      blasts: [B('W3', 10)], series: ok([series]),
    })
    expect(rowsOf(m, 'series')).toEqual([])
  })

  it('flags due within 7 days, not 8', () => {
    const in7 = model({ projects: [delivered('W2', 2, '2026-07-05')], series: ok([series]) }) // due 5 Oct
    expect(rowsOf(in7, 'series')).toHaveLength(1)
    expect(rowsOf(in7, 'series')[0].happened).toContain('in 7 days')
    const in8 = model({ projects: [delivered('W2', 2, '2026-07-06')], series: ok([series]) })
    expect(rowsOf(in8, 'series')).toEqual([])
  })

  it('flags a next wave whose target fell, at its price', () => {
    const m = model({
      projects: [delivered('W2', 2, '2026-08-20'), wave('W3', 3, { n_target: 20 })],
      blasts: [B('W3', 10)], series: ok([series]), rates: [['W3', 150]],
    })
    const r = rowsOf(m, 'series')[0]
    expect(r.happened).toContain('target fell from 80 to 20')
    expect(r.happened).toContain('$12,000 → $3,000 a wave')
    expect(r.stake).toBe(150 * 60)
  })

  it('values a wave at the newest priced wave when neither neighbour is priced, and says so', () => {
    const m = model({
      projects: [delivered('W1', 1, '2026-03-23'), delivered('W2', 2, '2026-06-23')],
      series: ok([series]), rates: [['W1', 100]],
    })
    const r = rowsOf(m, 'series')[0]
    expect(r.stake).toBe(100 * 80)
    expect(r.stakeText).toContain('the price on W1')
  })

  it('ranks unpriced series by how overdue they are', () => {
    const other: SeriesRecord = { ...series, id: 'S2', survey_name: 'Other' }
    const m = model({
      projects: [
        delivered('A2', 2, '2026-06-23'),
        { ...delivered('B2', 2, '2025-12-01'), series_id: 'S2' },
      ],
      series: ok([series, other]),
    })
    expect(ids(m, 'series')).toEqual(['B2', 'A2'])
    expect(rowsOf(m, 'series')[0].action).toContain('pause or end the series')
  })

  it('skips a paused series and names the ones it cannot check', () => {
    expect(rowsOf(model({ projects: [delivered('W2', 2, '2026-01-01')], series: ok([{ ...series, paused: true }]) }), 'series')).toEqual([])
    const m = model({ projects: [delivered('W2', 2, '2026-01-01')], series: ok([{ ...series, cadence_months: null }]) })
    expect(m.groups.find(g => g.verb === 'series')!.note).toContain('no cadence')
  })

  it('starts the clock again from a resume', () => {
    const m = model({ projects: [delivered('W2', 2, '2026-01-10')], series: ok([{ ...series, resume_anchor: '2026-09-01' }]) })
    expect(rowsOf(m, 'series')).toEqual([])
  })

  it('is blocked or pending, never "clear", while its read is not in', () => {
    const b = model({ projects: [], series: { state: 'blocked', table: 'rerun_series' } })
    expect(b.groups.find(g => g.verb === 'series')!.blocked).toEqual(['Blocked: rerun_series did not load'])
    expect(b.clear).not.toContain('series')
    const l = model({ projects: [], series: { state: 'loading' } })
    expect(l.groups.find(g => g.verb === 'series')!.pending).toBeTruthy()
    expect(l.clear).not.toContain('series')
  })

  it('adds months the way Postgres does', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
    expect(addMonths('2026-06-23', 3)).toBe('2026-09-23')
  })
})

describe('Collapse over five', () => {
  const book = (n: number): Book => ({
    projects: Array.from({ length: n }, (_, i) => P({ id: `p${i}`, project_code: `PR${i}` })),
    blasts: Array.from({ length: n }, (_, i) => B(`p${i}`, 10 + i)),
  })
  it('five rows show in full', () => {
    const g = model(book(COLLAPSE_AFTER)).groups.find(x => x.verb === 'price')!
    expect(g).toMatchObject({ collapsed: false, hiddenCount: 0 })
    expect(g.visible).toHaveLength(5)
  })
  it('six rows collapse to five with one hidden, and the full list is kept', () => {
    const g = model(book(COLLAPSE_AFTER + 1)).groups.find(x => x.verb === 'price')!
    expect(g).toMatchObject({ collapsed: true, hiddenCount: 1 })
    expect(g.visible).toHaveLength(5)
    expect(g.rows).toHaveLength(6)
    expect(g.visible[0].id).toBe('p5') // the most spent first
  })
})

describe('Header, verdict, export and drills', () => {
  const book: Book = {
    projects: [
      P({ id: 'a', project_code: 'PR00448', n_target: 100, budget: 300 }),
      P({ id: 'b', project_code: 'PR00449' }),
      P({ id: 'h', project_code: 'PR00450', status: 'Hold' }),
    ],
    blasts: [B('a', 880), B('b', 50), B('h', 20)],
    rates: [['a', 10]],
  }

  it('writes the header from the figures', () => {
    const m = model(book)
    expect(m.header.sentence).toBe(
      '2 live studies · $930 spent so far · 1 has a price and a target, worth $1,000 if each lands on target · ' +
      'the other 1 has no price or no target · 1 on hold, counted on their own. Unsold scoping: 0 studies, not counted.')
  })

  it('ends in a verdict with a verb', () => {
    const m = model(book)
    expect(m.verdict).toContain('1 live study still buying has spent more than half its price. Freeze the bid on PR00448 today: it has spent 88% of its price.')
    expect(m.holdVerdict).toContain('Resume or cancel PR00450 first.')
    expect(model({ projects: [] }).verdict).toBe('No live study needs a decision this week. Keep pricing new work as it is sold.')
  })

  it('speaks about money and the contract before the records to fix', () => {
    const m = model({
      projects: [
        P({ id: 'u', project_code: 'PR00443' }),
        P({ id: 'd', project_code: 'PR00300', client_id: 'acc2', board_column: 'Delivery', status: 'Closed', term_id: 'T', credits: 12, deliver_date: '2026-08-01' }),
      ],
      blasts: [B('u', 5000)],
      terms: [{ id: 'T', client_id: 'acc2', name: 'C', credits_total: 10, starts_on: '2026-03-30', renews_on: '2027-03-29' }],
    })
    const s = m.verdict.split('. ')
    expect(s[0]).toMatch(/^Open the renewal with DE Shaw: 2 credits over its pool/)
    expect(m.verdict).toContain('Set a budget on PR00443 first')
  })

  it('lists what ran clear', () => {
    const m = model(book)
    expect(m.clear).toContain('stop')
    expect(m.clear).not.toContain('freeze')
  })

  it('exports every verb row and every hold row', () => {
    const m = model(book)
    const n = m.groups.reduce((t, g) => t + g.rows.length, 0) + m.hold.rows.length
    expect(m.exportRows).toHaveLength(n)
    expect(m.exportRows.find(r => r.decision === VERB_META.hold.label)).toMatchObject({ bucket: 'On hold', survey: 'PR00450' })
    expect(m.exportColumns.map(c => c.key)).toContain('action')
  })

  it('every header drill reconciles against a figure computed elsewhere', () => {
    const inp = input(book)
    const m = buildThisWeekModel(inp)
    const d = thisWeekDrills(inp, m, 'Live')
    expect(reconcile(d.spent).ok).toBe(true)
    expect(reconcile(d.spent).rowSum).toBe(930)
    expect(reconcile(d.worth!).ok).toBe(true)
    expect(reconcile(d.hold).ok).toBe(true)
    expect(reconcile(d.hold).rowSum).toBe(20)
  })
})

describe('A failed cost read is never $0', () => {
  const book: Book = {
    projects: [P({ id: 'live', n_target: 100 }), P({ id: 'held', project_code: 'PR00450', status: 'Hold' })],
    blasts: [B('live', 100), B('held', 880)],
    rates: [['live', 10]],
  }
  const ALL_COST: FinanceTable[] = ['project_blasts', 'project_suppliers', 'project_costs']
  const REASON = 'Blocked: project_blasts, project_suppliers, project_costs did not load, so no spend can be read'

  it('one missing cost table is a floor, so the figures stand', () => {
    const m = model({ ...book, blocked: ['project_costs'] })
    expect(m.header.spendBlocked).toBeNull()
    expect(m.header.sentence).toContain('$100 spent so far')
    expect(rowsOf(m, 'hold')[0].stake).toBe(880)
  })

  it('every cost table missing takes the dollars away and keeps the holds', () => {
    const m = model({ ...book, blocked: ALL_COST })
    expect(m.header.spendBlocked).toBe(REASON)
    expect(m.header.sentence).toContain(REASON)
    expect(m.header.sentence).not.toContain('spent so far')
    // The hold is still a decision; only its money is missing.
    expect(ids(m, 'hold')).toEqual(['held'])
    expect(rowsOf(m, 'hold')[0].stake).toBeNull()
    expect(rowsOf(m, 'hold')[0].stakeText).toContain(REASON)
    expect(rowsOf(m, 'hold')[0].bullet).toBeNull()
    expect(m.hold.stakeUnknown).toBe(1)
    expect(m.hold.note).toContain(REASON)
    expect(m.holdVerdict).toContain(REASON)
    expect(m.holdVerdict).not.toContain('$0 spent')
  })

  it('leaves every spending verb Blocked rather than clear', () => {
    const m = model({ ...book, blocked: ALL_COST })
    for (const v of ['freeze', 'confirm', 'budget', 'price'] as const) {
      expect(m.groups.find(g => g.verb === v)!.blocked.length).toBeGreaterThan(0)
      expect(m.clear).not.toContain(v)
    }
  })
})

describe('A sold range is printed as a range, never as one "N sold"', () => {
  // 80 sold with a maximum of 100 at $50 per N: a $4,000 contract that can
  // bill up to $5,000. The 50% goal is $2,000, measured at the bottom.
  const ranged = (o: Partial<WeekProject> = {}) => P({ id: 'a', n_target: 80, n_target_max: 100, ...o })

  it('CONFIRM FINAL N names both ends and the end the goal is measured at', () => {
    const m = model({
      projects: [ranged({ board_column: 'Data QA', n_collected: 90 })],
      blasts: [B('a', 3564, 90)], rates: [['a', 50]],
    })
    const r = rowsOf(m, 'confirm')[0]
    expect(r.happened).toContain('89% of the $4,000 at the bottom of its $4,000–$5,000 contract (80–100 N sold)')
    expect(r.action).toContain('up to 100, the top of the 80–100 sold')
    expect(VERB_META.confirm.help).toContain('bottom of the range')
  })

  it('STOP BUYING says the multiple is measured at the top of the range', () => {
    const m = model({ projects: [ranged({ n_collected: 188 })], blasts: [B('a', 1535, 188)], rates: [['a', 50]] })
    const r = rowsOf(m, 'stop')[0]
    expect(r.happened).toContain('collected 188 against 80–100 sold')
    expect(r.happened).toContain('past 1.4× the top of that (140)')
  })

  it('says nothing about a range when there is none', () => {
    const m = model({ projects: [P({ id: 'a', n_target: 100, board_column: 'Data QA' })], blasts: [B('a', 900)], rates: [['a', 10]] })
    expect(rowsOf(m, 'confirm')[0].happened).toContain('spent 90% of its $1,000 contract ($900)')
    expect(rowsOf(m, 'confirm')[0].action).toContain('up to 100.')
  })
})

describe('Every note describes the same surveys the card shows', () => {
  const s1: SeriesRecord = { id: 'S1', client_id: 'acc1', survey_name: 'BAM series', cadence_months: null, paused: false, in_service: true, resume_anchor: null }
  const s2: SeriesRecord = { id: 'S2', client_id: 'acc2', survey_name: 'DE Shaw series', cadence_months: 3, paused: false, in_service: true, resume_anchor: null }
  const book: Book = {
    projects: [
      // S1 (BAM): delivered, but no cadence recorded.
      P({ id: 'a1', project_code: 'A1', client_id: 'acc1', series_id: 'S1', board_column: 'Delivery', status: 'Closed', deliver_date: '2026-05-01' }),
      // S2 (DE Shaw): a wave that has never been delivered.
      P({ id: 'b1', project_code: 'B1', client_id: 'acc2', series_id: 'S2' }),
    ],
    series: ok([s1, s2]),
  }

  it('CHECK THE SERIES counts only the series inside the account filter', () => {
    const all = model(book).groups.find(g => g.verb === 'series')!.note as string
    expect(all).toContain('no cadence')
    expect(all).toContain('no dated delivered wave')
    const bam = model({ ...book, filter: { ...DEFAULT_FILTER, account: 'acc1' } }).groups.find(g => g.verb === 'series')!.note as string
    expect(bam).toContain('no cadence')
    expect(bam).not.toContain('no dated delivered wave')
  })

  it('TOP UP THE CONTRACT says a pool counts every route when a route filter is on', () => {
    const term: WeekTerm = { id: 'T', client_id: 'acc2', name: '2026 Contract', credits_total: 10, starts_on: '2026-03-30', renews_on: '2027-03-29' }
    const drew = P({ id: 'd', project_code: 'D1', client_id: 'acc2', term_id: 'T', credits: 20, board_column: 'Delivery', status: 'Closed', deliver_date: '2026-08-01' })
    const plain = model({ projects: [drew], terms: [term] }).groups.find(g => g.verb === 'topup')!
    expect(plain.rows).toHaveLength(1)
    expect(plain.note).toBeNull()
    const byRoute = model({ projects: [drew], terms: [term], filter: { ...DEFAULT_FILTER, route: 'blast' } })
      .groups.find(g => g.verb === 'topup')!
    expect(byRoute.rows).toHaveLength(1)
    expect(byRoute.note).toContain('counts every route')
  })

  it('warns that one survey can need several decisions, on the card and in the export', () => {
    const m = model({ projects: [P({ id: 'a', n_target: 100, n_collected: 161 })], suppliers: [S('a', 1, 161)] })
    expect(ids(m, 'stop')).toEqual(['a'])
    expect(ids(m, 'budget')).toEqual(['a'])
    expect(m.overlapNote).toContain('1 study needs more than one decision')
    expect(m.exportColumns.find(c => c.key === 'stake')!.header).toContain('do not sum this column')
    const one = model({ projects: [P({ id: 'a', n_target: 100, budget: 500 })], blasts: [B('a', 10)], rates: [['a', 10]] })
    expect(one.overlapNote).toBeNull()
  })
})

describe('The agreed value of a credit contract is a read of its own', () => {
  const term: WeekTerm = { id: 'T', client_id: 'acc2', name: '2026 Contract', credits_total: 375, starts_on: '2026-03-30', renews_on: '2027-03-29' }
  const drew = (id: string, credits: number, o: Partial<WeekProject> = {}) =>
    P({ id, project_code: id, client_id: 'acc2', term_id: 'T', credits, board_column: 'Delivery', status: 'Closed', deliver_date: '2026-08-01', n_target: 100, n_actual: 100, ...o })
  const book: Book = {
    projects: [drew('a', 385), drew('b', 20, { deliver_date: '2026-09-01', n_target: 20, n_actual: 20 })],
    terms: [term], rates: [['b', 200]],
  }

  it('says so when that read failed, and marks the rate implied', () => {
    const m = model({ ...book, termDollars: { state: 'blocked', table: 'client_term_financials' } })
    expect(m.poolsNote).toContain('client_term_financials did not load')
    expect(m.poolsNote).toContain('not agreed')
    expect(m.pools[0].perCredit).toMatchObject({ source: 'implied', value: 200 })
    expect(m.groups.find(g => g.verb === 'topup')!.note).toContain('client_term_financials did not load')
  })

  it('holds the derived dollars back while that read is in flight', () => {
    const m = model({ ...book, termDollars: { state: 'loading' } })
    expect(m.pools[0].perCredit).toBeNull()
    expect(m.pools[0].overDollars).toBeNull()
    expect(rowsOf(m, 'topup')[0].stake).toBeNull()
    expect(rowsOf(m, 'topup')[0].stakeText).toContain('still loading')
    expect(m.poolsNote).toContain('held back')
  })

  it('says nothing extra once the read is in', () => {
    const m = model(book)
    expect(m.poolsNote).toBeNull()
    expect(m.pools[0].perCredit).toMatchObject({ source: 'implied' })
  })
})

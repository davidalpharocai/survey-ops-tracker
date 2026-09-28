import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FILTER, RELIABLE_FROM, TAB_RULES, describe as describeFilter, formatRange, isFiltered,
  itemsOf, optionCounts, parseFilter, populationFor, resolveRange, serializeFilter, sideBucketFor,
  todayET, undatedDropped, placementDate, populationByRule, LEVER_RULE, withPreset, RANGE_PRESETS,
  type FinanceFilter, type FinanceTab,
} from './filters'
import type { FinBlast, FinProject, FinSupplier } from './hub'

/**
 * Guards the ONE filter object, and above all the per-tab population rules.
 *
 * Four blocks on the old page ignored every filter and never said so; one idea
 * got two numbers because one tab followed a filter and the other did not.
 * The harness at the bottom replays fixed filter states and fails if a tab's
 * population neither moves with a filter nor names the filter it ignores.
 */

const TODAY = '2026-09-24'
const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'BAM', client_id: 'bam',
  project_type: 'B2B', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, ...o,
})
const B = (project_id: string): FinBlast =>
  ({ project_id, bid: 1, completes: 1, people: 0, cost_per_send: 0, channel: 'sms' })
const S = (project_id: string): FinSupplier => ({ project_id, cpi: 1, n_collected: 1 })

// A small book: delivered in and out of the window, live, held, undated,
// scoping, an empty placeholder, two accounts, three routes.
const projects = [
  P({ id: 'd-jun-bam-blast', deliver_date: '2026-06-10' }),
  P({ id: 'd-sep-bam-panel', deliver_date: '2026-09-05' }),
  P({ id: 'd-may-coa-blast', deliver_date: '2026-05-20', client_id: 'coa' }),
  P({ id: 'd-undated-bam', deliver_date: null }),
  P({ id: 'live-bam-blast', board_column: 'Fielding', deliver_date: '2026-03-01' }),
  P({ id: 'live-coa-none', board_column: 'Fielding', client_id: 'coa', deliver_date: null }),
  // Live and due NEXT WEEK — placed by a deliver date after today, as most
  // live work is (31 of 46 live surveys on 2026-09-27).
  P({ id: 'live-due-next-week', board_column: 'Fielding', deliver_date: '2026-10-01' }),
  P({ id: 'hold-bam', board_column: 'Fielding', status: 'Hold' }),
  P({ id: 'scoping', board_column: 'Submitted', phase: 'Scoping' }),
  P({ id: 'shell', is_placeholder: true, board_column: 'Delivery', deliver_date: '2026-07-01' }),
]
const blasts = [B('d-jun-bam-blast'), B('d-may-coa-blast'), B('live-bam-blast'), B('hold-bam'), B('live-due-next-week')]
const suppliers = [S('d-sep-bam-panel')]
const items = itemsOf(projects, blasts, suppliers, [])
const ACCOUNTS = [{ id: 'bam', name: 'BAM' }, { id: 'coa', name: 'Coatue' }]
const ids = (tab: FinanceTab, f: FinanceFilter) => populationFor(items, tab, f, TODAY).map(i => i.p.id).sort()
const F = (o: Partial<FinanceFilter> = {}): FinanceFilter => ({ ...DEFAULT_FILTER, ...o })

describe('the default is Since 1 June 2026 — David, 2026-09-24', () => {
  it('defaults the range, and All time is one click away', () => {
    expect(DEFAULT_FILTER.range.preset).toBe('since-jun-1')
    // No end date: live work is placed by a deliver date that is usually
    // still ahead, and capping at today dropped most of it.
    expect(resolveRange(DEFAULT_FILTER.range, TODAY)).toEqual({ from: RELIABLE_FROM, to: null })
    expect(resolveRange({ preset: 'all', from: null, to: null }, TODAY)).toEqual({ from: null, to: null })
  })

  it('resolves every preset against today, in Eastern time', () => {
    // "To date" ranges are open-ended, for the same reason as the default.
    expect(resolveRange({ preset: 'this-month', from: null, to: null }, TODAY)).toEqual({ from: '2026-09-01', to: null })
    expect(resolveRange({ preset: 'last-month', from: null, to: null }, TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
    expect(resolveRange({ preset: 'last-month', from: null, to: null }, '2026-01-10')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolveRange({ preset: 'this-quarter', from: null, to: null }, TODAY)).toEqual({ from: '2026-07-01', to: null })
    expect(resolveRange({ preset: 'custom', from: '2026-02-01', to: 'garbage' }, TODAY)).toEqual({ from: '2026-02-01', to: null })
    // 9:30pm on 24 Sep in New York is already the 25th in UTC.
    expect(todayET(new Date('2026-09-25T01:30:00Z'))).toBe('2026-09-24')
  })

  it('places a survey by deliver date, then launch date, then submitted date', () => {
    expect(placementDate(P({ deliver_date: null, launch_date: '2026-07-01', submitted_date: '2026-06-01' }))).toBe('2026-07-01')
    expect(placementDate(P({ deliver_date: null, launch_date: null, submitted_date: '2026-06-01' }))).toBe('2026-06-01')
    // delivered_at and created_at are bulk stamps and are never read.
    expect(placementDate(P({ deliver_date: null, delivered_at: '2026-09-10' }))).toBeNull()
  })
})

describe('parse and serialize', () => {
  it('round-trips a filter through the URL, omitting defaults', () => {
    const f: FinanceFilter = { range: { preset: 'custom', from: '2026-07-01', to: '2026-07-31' }, account: 'bam', route: 'blast' }
    const q = serializeFilter(f)
    expect(q.toString()).toBe('range=custom&from=2026-07-01&to=2026-07-31&account=bam&route=blast')
    expect(parseFilter(q)).toEqual(f)
    expect(serializeFilter(DEFAULT_FILTER).toString()).toBe('')
  })

  it('keeps unrelated params (tab, drill) and rewrites its own', () => {
    const q = serializeFilter(F({ route: 'panel' }), 'tab=results&preset=mtd&drill=margin')
    expect(q.get('tab')).toBe('results')
    expect(q.get('drill')).toBe('margin')
    expect(q.get('preset')).toBeNull()
    expect(q.get('route')).toBe('panel')
  })

  it('falls back to the default on a bad value instead of emptying the page', () => {
    expect(parseFilter(new URLSearchParams('range=nonsense&route=teleport'))).toEqual(DEFAULT_FILTER)
    // A custom range with no dates is not a range.
    expect(parseFilter(new URLSearchParams('range=custom')).range.preset).toBe('since-jun-1')
  })

  it('seeds Custom with the dates in view, so picking it survives the URL round trip', () => {
    // The page once wrote only range=custom, which parseFilter reads back as
    // the default: the select snapped back and the date inputs never appeared.
    const picked = withPreset(DEFAULT_FILTER, 'custom', TODAY)
    expect(picked.range).toEqual({ preset: 'custom', from: RELIABLE_FROM, to: TODAY })
    expect(parseFilter(serializeFilter(picked))).toEqual(picked)
    expect(parseFilter(serializeFilter(picked, 'tab=book&lifecycle=all')).range.preset).toBe('custom')
    expect(serializeFilter(picked, 'tab=book&lifecycle=all').get('lifecycle')).toBe('all')
    // From last month: that month. From All time: the reliable start to today.
    expect(withPreset(F({ range: { preset: 'last-month', from: null, to: null } }), 'custom', TODAY).range)
      .toEqual({ preset: 'custom', from: '2026-08-01', to: '2026-08-31' })
    expect(withPreset(F({ range: { preset: 'all', from: null, to: null } }), 'custom', TODAY).range)
      .toEqual({ preset: 'custom', from: RELIABLE_FROM, to: TODAY })
    // A custom range already in view is kept; any other preset clears the dates.
    const c = F({ range: { preset: 'custom', from: '2026-07-01', to: '2026-07-31' } })
    expect(withPreset(c, 'custom', TODAY)).toEqual(c)
    expect(withPreset(c, 'this-month', TODAY).range).toEqual({ preset: 'this-month', from: null, to: null })
    // Every preset in the dropdown survives the round trip.
    for (const p of RANGE_PRESETS) {
      expect(parseFilter(serializeFilter(withPreset(DEFAULT_FILTER, p.id, TODAY))).range.preset).toBe(p.id)
    }
  })

  it('still reads the old ?preset= values', () => {
    expect(parseFilter(new URLSearchParams('preset=mtd')).range.preset).toBe('this-month')
    expect(parseFilter(new URLSearchParams('preset=lastmonth')).range.preset).toBe('last-month')
    expect(parseFilter({ preset: 'qtd' }).range.preset).toBe('this-quarter')
  })

  it('knows when anything is filtered (what shows Clear)', () => {
    expect(isFiltered(DEFAULT_FILTER)).toBe(false)
    expect(isFiltered(F({ account: 'bam' }))).toBe(true)
    expect(isFiltered(F({ range: { preset: 'all', from: null, to: null } }))).toBe(true)
  })
})

describe('per-tab population rules', () => {
  it('drops empty placeholders before any tab sees them', () => {
    expect(items.some(i => i.p.id === 'shell')).toBe(false)
  })

  it('Results: delivered × date × account × route', () => {
    expect(ids('results', F())).toEqual(['d-jun-bam-blast', 'd-sep-bam-panel'])
    expect(ids('results', F({ route: 'panel' }))).toEqual(['d-sep-bam-panel'])
    expect(ids('results', F({ account: 'coa' }))).toEqual([])
    // All time brings back May and the undated survey.
    expect(ids('results', F({ range: { preset: 'all', from: null, to: null } }))).toEqual(
      ['d-jun-bam-blast', 'd-may-coa-blast', 'd-sep-bam-panel', 'd-undated-bam'])
  })

  it('This week: live work, IGNORES the date, honours account and route', () => {
    // live-bam-blast "launched" in March and is still live: it matters now.
    expect(ids('this-week', F())).toEqual(['live-bam-blast', 'live-coa-none', 'live-due-next-week'])
    expect(ids('this-week', F({ account: 'coa' }))).toEqual(['live-coa-none'])
    expect(ids('this-week', F({ route: 'blast' }))).toEqual(['live-bam-blast', 'live-due-next-week'])
    expect(ids('this-week', F({ range: { preset: 'last-month', from: null, to: null } })))
      .toEqual(['live-bam-blast', 'live-coa-none', 'live-due-next-week'])
  })

  it('This week shows Hold BESIDE live work, never inside it', () => {
    expect(ids('this-week', F())).not.toContain('hold-bam')
    expect(sideBucketFor(items, 'this-week', F(), TODAY).map(i => i.p.id)).toEqual(['hold-bam'])
    expect(sideBucketFor(items, 'results', F(), TODAY)).toEqual([])
  })

  it('Improve: delivered and live work, with the filters', () => {
    expect(ids('improve', F({ range: { preset: 'all', from: null, to: null } }))).toEqual(
      ['d-jun-bam-blast', 'd-may-coa-blast', 'd-sep-bam-panel', 'd-undated-bam', 'live-bam-blast', 'live-coa-none', 'live-due-next-week'])
    // The default keeps live work due after today: a to-date range has no end.
    expect(ids('improve', F())).toEqual(['d-jun-bam-blast', 'd-sep-bam-panel', 'live-due-next-week'])
  })

  it('the lever population: delivered AND live work, dated like everything else', () => {
    const lever = (f: FinanceFilter) => populationByRule(items, LEVER_RULE, f, TODAY).map(i => i.p.id).sort()
    // Since 1 June: the two delivered surveys in the window AND the live one
    // due next week — capped at today, the levers lost it, and with it most of
    // the live spend. The live survey placed in March is outside the window,
    // and hold never counts.
    expect(lever(F())).toEqual(['d-jun-bam-blast', 'd-sep-bam-panel', 'live-due-next-week'])
    expect(lever(F({ range: { preset: 'this-month', from: null, to: null } }))).toEqual(['d-sep-bam-panel', 'live-due-next-week'])
    expect(lever(F({ range: { preset: 'this-quarter', from: null, to: null } }))).toEqual(['d-sep-bam-panel', 'live-due-next-week'])
    // Last month names its end, and next week is not in it.
    expect(lever(F({ range: { preset: 'last-month', from: null, to: null } }))).toEqual([])
    expect(lever(F({ range: { preset: 'all', from: null, to: null } }))).toEqual(
      ['d-jun-bam-blast', 'd-may-coa-blast', 'd-sep-bam-panel', 'd-undated-bam', 'live-bam-blast', 'live-coa-none', 'live-due-next-week'])
    // A tab's population is exactly this with the tab's rule.
    expect(populationByRule(items, TAB_RULES.results, F(), TODAY)).toEqual(populationFor(items, 'results', F(), TODAY))
    // Its scope chip names the narrower population, not the tab's.
    expect(describeFilter(F(), { tab: 'per-respondent', today: TODAY, count: 3, rule: LEVER_RULE }).chip)
      .toBe('Delivered and live · From 1 Jun 2026 · 3 surveys')
  })

  it('no tab ever shows scoping work', () => {
    for (const tab of Object.keys(TAB_RULES) as FinanceTab[]) {
      expect(ids(tab, F({ range: { preset: 'all', from: null, to: null } }))).not.toContain('scoping')
    }
  })

  it('counts the surveys a date range drops for having no date', () => {
    expect(undatedDropped(items, 'results', F(), TODAY)).toBe(1)
    expect(undatedDropped(items, 'results', F({ range: { preset: 'all', from: null, to: null } }), TODAY)).toBe(0)
    expect(undatedDropped(items, 'this-week', F(), TODAY)).toBe(0)
  })
})

describe('option counts reflect the OTHER active filters', () => {
  it('counts accounts under the current date and route, and greys the empty ones', () => {
    const o = optionCounts(items, 'results', F(), ACCOUNTS, TODAY)
    expect(o.accounts).toEqual([
      { id: 'bam', name: 'BAM', surveys: 2, disabled: false },
      { id: 'coa', name: 'Coatue', surveys: 0, disabled: true },
    ])
    const withRoute = optionCounts(items, 'results', F({ route: 'panel' }), ACCOUNTS, TODAY)
    expect(withRoute.accounts.find(a => a.id === 'bam')!.surveys).toBe(1)
  })

  it('counts routes under the current date and account — never its own selection', () => {
    const o = optionCounts(items, 'results', F({ route: 'panel' }), ACCOUNTS, TODAY)
    const by = Object.fromEntries(o.routes.map(r => [r.id, r.surveys]))
    expect(by).toMatchObject({ all: 2, blast: 1, panel: 1, both: 0, none: 0 })
  })
})

describe('describe(): one set of words for chip, drill, export and audit', () => {
  it('writes the scope chip', () => {
    const d = describeFilter(F({ account: 'bam' }), { tab: 'results', today: TODAY, count: 41, accountName: 'BAM' })
    expect(d.chip).toBe('Delivered · From 1 Jun 2026 · BAM · 41 surveys')
    expect(d.ignored).toEqual([])
  })

  it('says out loud when a tab ignores the date', () => {
    const d = describeFilter(F(), { tab: 'this-week', today: TODAY, count: 12 })
    expect(d.chip).toBe('Live · Live work — all dates · 12 surveys')
    expect(d.ignored).toEqual(['Live work — all dates'])
    expect(d.audit).toMatchObject({ date_applied: false, from: null, to: null })
  })

  it('writes the export header and audit row from the same object', () => {
    const d = describeFilter(F({ route: 'blast', account: 'coa' }),
      { tab: 'results', today: TODAY, count: 3, accountName: 'Coatue', asOf: '24 Sep 2026 18:40 ET' })
    expect(d.header).toContain('As of: 24 Sep 2026 18:40 ET')
    expect(d.header).toContain('Account: Coatue')
    expect(d.header.some(h => h.startsWith('Route: Blast only'))).toBe(true)
    expect(d.header).toContain('Rows: 3')
    expect(d.audit).toMatchObject({
      tab: 'results', population: 'delivered', range: 'since-jun-1', from: RELIABLE_FROM, to: null,
      account: 'coa', account_name: 'Coatue', route: 'blast', rows: 3,
    })
  })

  it('formats ranges plainly', () => {
    expect(formatRange({ from: '2026-06-01', to: '2026-09-24' })).toBe('1 Jun–24 Sep 2026')
    expect(formatRange({ from: '2025-12-01', to: '2026-01-31' })).toBe('1 Dec 2025–31 Jan 2026')
    expect(formatRange({ from: null, to: null })).toBe('All time')
    expect(formatRange({ from: '2026-06-01', to: null })).toBe('From 1 Jun 2026')
  })
})

/**
 * THE HARNESS. Fourteen fixed filter states. For each tab and each filter
 * dimension, a change of that dimension must either change the population or
 * be named in the tab's rule as ignored (and then say so in describe()). A
 * card that neither moves nor declares its scope fails here.
 */
describe('the 14-state harness', () => {
  const ALL = { preset: 'all' as const, from: null, to: null }
  const STATES: FinanceFilter[] = [
    F(),
    F({ range: ALL }),
    F({ range: { preset: 'this-month', from: null, to: null } }),
    F({ range: { preset: 'last-month', from: null, to: null } }),
    F({ range: { preset: 'this-quarter', from: null, to: null } }),
    F({ range: { preset: 'custom', from: '2026-05-01', to: '2026-05-31' } }),
    F({ account: 'bam' }),
    F({ account: 'coa' }),
    F({ route: 'blast' }),
    F({ route: 'panel' }),
    F({ route: 'none' }),
    F({ range: ALL, account: 'coa' }),
    F({ range: ALL, route: 'blast' }),
    F({ range: ALL, account: 'bam', route: 'panel' }),
  ]

  it('has fourteen states', () => expect(STATES).toHaveLength(14))

  for (const tab of Object.keys(TAB_RULES) as FinanceTab[]) {
    it(`${tab}: every filter either moves the population or is declared ignored`, () => {
      const rule = TAB_RULES[tab]
      const pops = STATES.map(f => ids(tab, f).join(','))
      const base = pops[1] // all time, no account, no route
      const moved = { date: false, account: false, route: false }
      STATES.forEach((f, i) => {
        if (pops[i] === base) return
        if (f.account) moved.account = true
        else if (f.route !== 'all') moved.route = true
        else moved.date = true
      })
      for (const dim of ['date', 'account', 'route'] as const) {
        if (rule[dim]) expect(moved[dim], `${tab} honours ${dim} but never moved`).toBe(true)
        else {
          // Ignored: the population must not move with it, and the chip must say so.
          expect(moved[dim]).toBe(false)
          const d = describeFilter(STATES[0], { tab, today: TODAY, count: 0 })
          expect(d.ignored.length).toBeGreaterThan(0)
        }
      }
    })
  }
})

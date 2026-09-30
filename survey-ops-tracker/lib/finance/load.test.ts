import { describe, it, expect } from 'vitest'
import {
  loadFinanceRaw, integrityLine, integrityWarnings, isBlocked, blockedText, FINANCE_TABLES, PAGE,
  priceBlockText, costFloorText, withoutFinancials,
} from './load'
import { revenueOf, segmentPriceDiffers } from './revenue'

/**
 * Guards the loader against the three ways the old page lied about its data:
 * one failed read (a picker's contacts) took down every tab; an RLS-empty rates
 * read looked exactly like an unpriced book; and an explicit column list never
 * asked for is_placeholder, so empty rerun shells counted as delivered work.
 *
 * The client here is a stand-in that records every call, so the tests can check
 * the reads are paged, ordered, filtered and counted — not just that rows came
 * back.
 */

type Row = Record<string, unknown>
interface Call { table: string; cols: string; count?: string; is: [string, null][]; order: string | null; range: [number, number] | null }

function fakeClient(data: Partial<Record<string, Row[]>>, opts: {
  fail?: Record<string, string>
  /** Pretend the database holds this many rows (count exact). */
  counts?: Record<string, number>
} = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      return {
        select(cols: string, o?: { count?: 'exact' }) {
          const call: Call = { table, cols, count: o?.count, is: [], order: null, range: null }
          calls.push(call)
          const q = {
            is(col: string, v: null) { call.is.push([col, v]); return q },
            order(col: string) { call.order = col; return q },
            range(from: number, to: number) { call.range = [from, to]; return q },
            then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
              const err = opts.fail?.[table]
              const all = (data[table] ?? []).filter(r => !call.is.some(([c]) => r[c] != null))
              const [f, t] = call.range ?? [0, all.length - 1]
              const out = err
                ? { data: null, error: { message: err }, count: null }
                : { data: all.slice(f, t + 1), error: null, count: call.count ? (opts.counts?.[table] ?? all.length) : null }
              return Promise.resolve(out).then(res, rej)
            },
          }
          return q
        },
      }
    },
  }
  return { client, calls }
}

const project = (id: string, o: Row = {}): Row => ({
  id, project_code: id, project_name: null, client: null, client_id: 'acc', project_type: 'B2B',
  board_column: 'Delivery', status: 'Closed', phase: 'Active', deliver_date: '2026-07-01',
  launch_date: null, submitted_date: null, n_target: 10, n_collected: 10, n_actual: 10,
  actual_spend: 0, deleted_at: null, ...o,
})

const BOOK = {
  survey_projects: [
    project('a', { actual_spend: 100 }),
    project('b', { actual_spend: 999 }), // stored figure disagrees with its rows
    project('demo', { client_id: 'demo-acc' }),
    project('gone', { deleted_at: '2026-09-01' }),
  ],
  project_blasts: [{ id: 'b1', project_id: 'a', bid: 10, completes: 10, people: 0, cost_per_send: 0, channel: 'sms' }],
  project_suppliers: [],
  project_launches: [],
  project_costs: [],
  project_financials: [
    { project_id: 'a', price_per_n: 50 },
    { project_id: 'b', price_per_n: null },
    { project_id: 'c', price_per_n: 0 },
    { project_id: 'd', price_per_n: -1 },
  ],
  project_segments: [
    { id: 's2', project_id: 'a', n_target: 5, n_actual: 5, sort_order: 2 },
    { id: 's1', project_id: 'a', n_target: 5, n_actual: 5, sort_order: 1 },
  ],
  clients: [{ id: 'acc', name: 'BAM', is_demo: false }, { id: 'demo-acc', name: 'Demo', is_demo: true }],
  client_contacts: [],
  client_terms: [{ id: 't1', client_id: 'acc', deleted_at: null }, { id: 't2', client_id: 'acc', deleted_at: '2026-01-01' }],
}

describe('loadFinanceRaw', () => {
  it('reads every table the hub needs, ordered, counted on the first page', async () => {
    const { client, calls } = fakeClient(BOOK)
    await loadFinanceRaw(client)
    expect(new Set(calls.map(c => c.table))).toEqual(new Set(FINANCE_TABLES))
    for (const c of calls) {
      expect(c.order, `${c.table} must be ordered`).not.toBeNull()
      expect(c.range).toEqual([0, PAGE - 1])
      expect(c.count).toBe('exact')
    }
    // project_financials has no id column: ordering by id fails the request.
    expect(calls.find(c => c.table === 'project_financials')!.order).toBe('project_id')
  })

  it('reads survey_projects and the other schema-moving tables with select(*)', async () => {
    const { client, calls } = fakeClient(BOOK)
    await loadFinanceRaw(client)
    for (const t of ['survey_projects', 'project_financials', 'project_segments', 'client_terms']) {
      expect(calls.find(c => c.table === t)!.cols).toBe('*')
    }
    expect(calls.find(c => c.table === 'project_suppliers')!.cols).toContain('suppliers(name)')
    expect(calls.find(c => c.table === 'project_launches')!.cols).toMatch(/label.*launch_date.*note/)
  })

  it('skips soft-deleted surveys and terms, and drops demo accounts once', async () => {
    const { client, calls } = fakeClient(BOOK)
    const { raw, integrity } = await loadFinanceRaw(client)
    expect(calls.find(c => c.table === 'survey_projects')!.is).toEqual([['deleted_at', null]])
    expect(calls.find(c => c.table === 'client_terms')!.is).toEqual([['deleted_at', null]])
    expect(raw.projects.map(p => p.id)).toEqual(['a', 'b'])
    expect(raw.terms.map(t => t.id)).toEqual(['t1'])
    expect(raw.accounts.map(a => a.id)).toEqual(['acc'])
    expect(integrity.demoDropped).toBe(1)
  })

  it('pages past 1,000 rows instead of truncating silently', async () => {
    const many = Array.from({ length: PAGE + 5 }, (_, i) => ({
      id: `b${i}`, project_id: 'a', bid: 1, completes: 0, people: 0, cost_per_send: 0, channel: 'sms',
    }))
    const { client, calls } = fakeClient({ ...BOOK, project_blasts: many })
    const { raw, integrity } = await loadFinanceRaw(client)
    expect(raw.blasts).toHaveLength(PAGE + 5)
    const pages = calls.filter(c => c.table === 'project_blasts')
    expect(pages.map(c => c.range)).toEqual([[0, PAGE - 1], [PAGE, 2 * PAGE - 1]])
    // Only the first page asks for the count.
    expect(pages.map(c => c.count)).toEqual(['exact', undefined])
    expect(integrity.loadedCounts.project_blasts).toBe(PAGE + 5)
  })

  it('attaches each survey its segments, in order, without mutating the rows read', async () => {
    const { client } = fakeClient(BOOK)
    const { raw } = await loadFinanceRaw(client)
    const a = raw.projects.find(p => p.id === 'a')!
    expect(a.segments!.map(s => s.id)).toEqual(['s1', 's2'])
    expect(raw.projects.find(p => p.id === 'b')!.segments).toBeUndefined()
    expect('segments' in BOOK.survey_projects[0]).toBe(false)
  })

  it('keeps a real $0 price and refuses a missing or negative one', async () => {
    const { client } = fakeClient(BOOK)
    const { raw, integrity } = await loadFinanceRaw(client)
    expect([...raw.rates.entries()]).toEqual([['a', 50], ['c', 0]])
    expect(integrity.pricesReturned).toBe(2)
  })

  it('checks recomputed spend against the stored figure, survey by survey', async () => {
    const { client } = fakeClient(BOOK)
    const { integrity } = await loadFinanceRaw(client)
    expect(integrity.spendRecomputedMatches).toEqual({ matches: 1, of: 2, mismatchIds: ['b'] })
  })
})

describe('a failed read is named, and never reads as $0', () => {
  it('blocks only the table that failed; everything else still loads', async () => {
    const { client } = fakeClient(BOOK, { fail: { client_contacts: 'permission denied for table client_contacts' } })
    const load = await loadFinanceRaw(client)
    expect(load.blocked).toEqual([{ table: 'client_contacts', message: 'permission denied for table client_contacts' }])
    expect(load.raw.projects).toHaveLength(2)
    expect(isBlocked(load.blocked, 'client_contacts')).toBe(true)
    expect(isBlocked(load.blocked, 'project_blasts')).toBe(false)
    expect(blockedText('client_contacts')).toBe('Blocked: client_contacts did not load')
  })

  it('does not claim a spend check it could not run', async () => {
    const { client } = fakeClient(BOOK, { fail: { project_blasts: 'timeout' } })
    const load = await loadFinanceRaw(client)
    expect(load.integrity.spendRecomputedMatches.of).toBe(0)
    expect(integrityWarnings(load, { canViewFinancials: true })[0]).toBe('Blocked: project_blasts did not load (timeout).')
  })

  it('tells a finance reader when NO prices came back — a read problem, not an empty book', async () => {
    const { client } = fakeClient({ ...BOOK, project_financials: [] })
    const load = await loadFinanceRaw(client)
    const w = integrityWarnings(load, { canViewFinancials: true })
    expect(w.some(x => x.startsWith('No client prices came back'))).toBe(true)
    // A reader without the capability is expected to get none.
    expect(integrityWarnings(load, { canViewFinancials: false }).some(x => x.startsWith('No client prices'))).toBe(false)
  })

  it('reports a row count that disagrees with the database', async () => {
    const { client } = fakeClient(BOOK, { counts: { project_costs: 49 } })
    const load = await loadFinanceRaw(client)
    expect(load.integrity.countMismatches).toEqual([{ table: 'project_costs', loaded: 0, expected: 49 }])
    expect(integrityWarnings(load, { canViewFinancials: true })).toContain(
      'project_costs: loaded 0 rows but the database holds 49.')
  })
})

describe('integrityLine', () => {
  it('says what loaded, in one grey line', async () => {
    const { client } = fakeClient(BOOK)
    const { integrity } = await loadFinanceRaw(client)
    expect(integrityLine(integrity, { canViewFinancials: true, time: '6:40 PM' })).toBe(
      'Loaded 2 studies (1 demo left out) · 1 blasts · 0 panel rows · 0 cost lines · 2 prices · ' +
      'recomputed spend = stored on 1 of 2 · 6:40 PM')
  })

  it('says nothing about prices to a reader RLS returns none to', async () => {
    // "0 prices" would be a false statement about the book to an analyst.
    const { client } = fakeClient({ ...BOOK, project_financials: [] })
    const { integrity } = await loadFinanceRaw(client)
    const line = integrityLine(integrity, { canViewFinancials: false })
    expect(line).not.toContain('prices')
    expect(line).toBe('Loaded 2 studies (1 demo left out) · 1 blasts · 0 panel rows · 0 cost lines · recomputed spend = stored on 1 of 2')
  })
})

describe('card-level blocks: a figure built on a failed read says so', () => {
  it('names project_financials when it failed, and when a finance holder got no prices', async () => {
    const failed = await loadFinanceRaw(fakeClient(BOOK, { fail: { project_financials: 'boom' } }).client)
    expect(priceBlockText(failed, { canViewFinancials: true })).toBe('Blocked: project_financials did not load')
    const empty = await loadFinanceRaw(fakeClient({ ...BOOK, project_financials: [] }).client)
    expect(priceBlockText(empty, { canViewFinancials: true })).toBe('Blocked: project_financials returned no prices')
    const fine = await loadFinanceRaw(fakeClient(BOOK).client)
    expect(priceBlockText(fine, { canViewFinancials: true })).toBeNull()
    // Not shown to a reader without the capability at all, so never "blocked".
    expect(priceBlockText(empty, { canViewFinancials: false })).toBeNull()
  })

  it('blocks prices when segments failed: a segmented survey would be capped as one line', async () => {
    const load = await loadFinanceRaw(fakeClient(BOOK, { fail: { project_segments: 'x' } }).client)
    expect(priceBlockText(load, { canViewFinancials: true })).toBe(
      'Blocked: project_segments did not load, so segmented studies cannot be checked')
  })

  it('marks a spend figure as a floor for every cost table that failed', async () => {
    const ok = await loadFinanceRaw(fakeClient(BOOK).client)
    expect(costFloorText(ok)).toBeNull()
    const two = await loadFinanceRaw(fakeClient(BOOK, { fail: { project_blasts: 'x', project_costs: 'y' } }).client)
    expect(costFloorText(two)).toBe(
      'Floor only: project_blasts, project_costs did not load, so the cost here leaves out those tables.')
  })
})

describe('withoutFinancials: what a reader without the capability is handed', () => {
  it('strips every price and budget, a segment override included', async () => {
    const book = {
      ...BOOK,
      survey_projects: [project('a', { actual_spend: 100, budget: 5000 }), project('b', { actual_spend: 999 })],
      project_segments: [
        { id: 's1', project_id: 'a', n_target: 5, n_actual: 5, price_per_n: 150, sort_order: 1 },
        { id: 's2', project_id: 'a', n_target: 5, n_actual: 5, price_per_n: 120, sort_order: 2 },
      ],
    }
    const { raw } = await loadFinanceRaw(fakeClient(book).client)
    const a = raw.projects.find(p => p.id === 'a')!
    // 086 lets an analyst read a segment override. Revenue no longer reads it
    // (the bill uses the survey's one rate), but the segment-price note does,
    // so without the strip a client price reaches the analyst's page through
    // the note — the latent leak.
    expect(revenueOf(a, undefined)).toBeNull()
    expect(segmentPriceDiffers(a, undefined)).toBe(true)
    const stripped = withoutFinancials(raw)
    const sa = stripped.projects.find(p => p.id === 'a')!
    expect(stripped.rates.size).toBe(0)
    expect(stripped.financials).toEqual([])
    expect(sa.budget).toBeNull()
    expect(sa.segments!.every(s => s.price_per_n == null)).toBe(true)
    expect(stripped.segments.every(s => s.price_per_n == null)).toBe(true)
    expect(revenueOf(sa, stripped.rates.get('a'))).toBeNull()
    expect(segmentPriceDiffers(sa, stripped.rates.get('a'))).toBe(false)
    // The rows read are not mutated: a finance holder on the same cache keeps them.
    expect(a.segments![0].price_per_n).toBe(150)
    expect(a.budget).toBe(5000)
  })
})

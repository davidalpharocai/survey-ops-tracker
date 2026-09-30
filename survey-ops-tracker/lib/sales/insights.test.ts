import { describe, it, expect } from 'vitest'
import type { InsightsFilter } from '@/lib/insights/filters'
import {
  buildSalesInsights, salesHeadline, salesInsightsHref, salesInsightsState,
  toInsightsProject, type SalesProjectRow,
} from './insights'

/**
 * The sales Insights adapter.
 *
 * lib/insights/model.test.ts already proves every FIGURE — what counts as
 * delivered, what a cycle time is, when a comparison is withheld. Repeating any
 * of that here would be testing the same code twice and would drift. So this
 * file tests only the four things this module actually decides:
 *
 *   1. whether the page may draw at all (the migration 130 guard),
 *   2. that a sales row reaches the model intact and uncaptained,
 *   3. that the one sentence written here cannot say something false,
 *   4. that links stay inside /sales.
 *
 * Every row below is shaped like a real sales_projects row, including the awkward
 * ones: an empty auto-spawned shell parked in Delivery, and delivered work whose
 * respondent count was never entered (113 studies are in that state today).
 */

const TODAY = '2026-09-30'

const f = (over: Partial<InsightsFilter> = {}): InsightsFilter => ({
  range: { preset: 'all', from: null, to: null },
  type: null, captain: null, account: null,
  ...over,
})

/** A delivered study with everything recorded. */
const row = (over: Partial<SalesProjectRow> = {}): SalesProjectRow => ({
  id: 'p1',
  project_code: 'PR00001',
  project_name: 'A study',
  client: 'Acme',
  client_id: 'c1',
  status: 'Open',
  phase: 'Fielding',
  board_column: 'Delivery',
  project_type: 'PS',
  submitted_date: '2026-09-01',
  launch_date: '2026-09-05',
  due_date: '2026-09-20',
  deliver_date: '2026-09-18',
  n_target: 500,
  n_target_max: null,
  n_collected: 520,
  n_actual: 500,
  series_id: null,
  rerun_number: null,
  is_placeholder: null,
  greenlit_at: null,
  cancelled_at: null,
  ...over,
})

/** The thing migration 130 exists for: a wave the spawner made in advance,
 *  sitting in the Delivery column with no respondents and no work behind it. */
const shell = (id: string): SalesProjectRow => row({
  id, project_code: `PR9${id}`, project_name: 'Wave 3',
  is_placeholder: true, n_collected: null, n_actual: null,
  submitted_date: null, deliver_date: null, due_date: null,
})

const ACCOUNTS = new Map([['c1', 'Acme Corp']])

describe('may the page draw at all', () => {
  it('is empty, not broken, when the book has no studies', () => {
    expect(salesInsightsState([])).toBe('empty')
  })

  // The guard is the presence of the KEY, not a truthy value: PostgREST returns
  // one key per view column, so a study that is not a placeholder still carries
  // is_placeholder: null. Testing truthiness would have declared the migration
  // missing on every normal book.
  it('is ready when the column is there but null on the row', () => {
    expect(salesInsightsState([row({ is_placeholder: null })])).toBe('ready')
  })

  it('needs the migration when the view does not carry the column', () => {
    const before = row()
    delete (before as unknown as Record<string, unknown>).is_placeholder
    expect(salesInsightsState([before])).toBe('needs-migration')
  })
})

describe('a sales row reaching the model', () => {
  it('is never captained — the view does not carry one and a book view does not ask', () => {
    expect(toInsightsProject(row()).captain).toBeNull()
  })

  it('turns the columns migration 130 has not added into nulls, not undefined', () => {
    const before = row()
    delete (before as unknown as Record<string, unknown>).is_placeholder
    delete (before as unknown as Record<string, unknown>).greenlit_at
    delete (before as unknown as Record<string, unknown>).cancelled_at
    const p = toInsightsProject(before)
    expect(p.is_placeholder).toBeNull()
    expect(p.greenlit_at).toBeNull()
    expect(p.cancelled_at).toBeNull()
  })

  it('carries the dates and counts through unchanged', () => {
    const p = toInsightsProject(row())
    expect(p.deliver_date).toBe('2026-09-18')
    expect(p.n_actual).toBe(500)
    expect(p.client_id).toBe('c1')
  })
})

describe('empty rerun shells', () => {
  // The whole reason migration 130 exists. 18 of these sit on real books.
  it('does not count a flagged empty shell in Delivery as delivered work', () => {
    const { model } = buildSalesInsights({
      rows: [row(), shell('s1'), shell('s2')], accounts: ACCOUNTS, filter: f(), today: TODAY,
    })
    expect(model.cur.delivered).toBe(1)
    expect(model.excluded.placeholders).toBe(2)
  })

  // A flagged row that HAS respondents is not an empty shell; it is real work
  // with a stale flag, and hiding its delivery would be the opposite error.
  it('still counts a flagged study that has respondents', () => {
    const real = row({ id: 's3', is_placeholder: true, n_actual: 300 })
    const { model } = buildSalesInsights({
      rows: [real], accounts: ACCOUNTS, filter: f(), today: TODAY,
    })
    expect(model.cur.delivered).toBe(1)
    expect(model.excluded.placeholders).toBe(0)
  })
})

describe('the headline', () => {
  const headline = (rows: SalesProjectRow[], owner: string | null = 'Alex Pinsky') =>
    buildSalesInsights({ rows, accounts: ACCOUNTS, filter: f(), today: TODAY, owner }).headline

  it('names the book, and never speaks for the whole team', () => {
    const t = headline([row()])
    expect(t).toMatch(/^Alex Pinsky delivered/)
    expect(t).not.toMatch(/The team/)
  })

  it('falls back to "Your book" rather than an empty subject', () => {
    expect(headline([row()], null)).toMatch(/^Your book delivered/)
  })

  it('says nothing was delivered rather than printing a zero', () => {
    const t = headline([row({ board_column: 'Fielding', deliver_date: null })])
    expect(t).toMatch(/nothing delivered/)
    expect(t).not.toMatch(/\b0 studies\b/)
  })

  // 113 delivered studies have no recorded N. Saying "0 respondents" about work
  // that happened is worse than saying nothing about it.
  it('claims no respondents when none are recorded', () => {
    const t = headline([row({ n_actual: null })])
    expect(t).toMatch(/delivered 1 study/)
    expect(t).not.toMatch(/respondent/)
  })

  it('says how many studies a respondent total rests on when it is not all of them', () => {
    const t = headline([row(), row({ id: 'p2', n_actual: null })])
    expect(t).toMatch(/500 respondents across the 1 with a count recorded/)
  })

  // This page is a slice of the company. A superlative computed from one book
  // ("your best month ever") can be beaten by a month when the same account sat
  // on someone else's, so none is ever claimed.
  it('makes no record or superlative claim', () => {
    const t = headline([row(), row({ id: 'p2' }), row({ id: 'p3' })])
    expect(t).not.toMatch(/most|best|record|ever|highest/i)
  })

  it('carries no dollar figure, because this page has none', () => {
    expect(headline([row(), row({ id: 'p2' })])).not.toMatch(/\$/)
  })

  it('withholds a comparison the model refuses to make', () => {
    // Two studies is far below MIN_COMPARE_N, so no direction may be stated.
    const t = headline([row(), row({ id: 'p2' })])
    expect(t).not.toMatch(/\bUp from\b|\bDown from\b/)
  })
})

describe('links stay inside the sales shell', () => {
  it('points at /sales/insights, not the analyst page', () => {
    expect(salesInsightsHref(f())).toBe('/sales/insights?range=all')
    expect(salesInsightsHref(f({ range: { preset: 'this-month', from: null, to: null } }))).toBe('/sales/insights')
  })

  it('patches a filter without touching the rest', () => {
    expect(salesInsightsHref(f(), { account: 'c1' })).toContain('account=c1')
  })

  // There is no captain control on this page. A captain left in the URL would
  // quietly filter every figure with nothing on screen saying so.
  it('drops a captain someone pasted into the URL', () => {
    expect(salesInsightsHref(f({ captain: 'abc' }))).not.toContain('captain')
  })
})

describe('salesHeadline on a built model', () => {
  it('reports on-time and cycle time when the studies support them', () => {
    const { model } = buildSalesInsights({
      rows: [row(), row({ id: 'p2', deliver_date: '2026-09-25', due_date: '2026-09-20' })],
      accounts: ACCOUNTS, filter: f(), today: TODAY,
    })
    const t = salesHeadline(model, 'Jenna Shrove')
    expect(t).toMatch(/50% on time/)
    expect(t).toMatch(/from start to delivery/)
  })
})

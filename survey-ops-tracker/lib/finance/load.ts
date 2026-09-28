/**
 * Every read the finance hub needs, in one place, and honest about failure.
 *
 * ── WHAT WENT WRONG BEFORE ──────────────────────────────────────────────────
 *   · One `Promise.all`: a failed read of client_contacts — which only feeds a
 *     picker — took down all four tabs, and the error shown named no table.
 *   · An explicit column list on survey_projects never asked for
 *     `is_placeholder`, so 20 empty rerun shells counted as delivered work; and
 *     `n_target_max`, `credits` and `term_id` never arrived either. A column the
 *     select forgets does not error — it is simply undefined, and every function
 *     that reasons about it silently decides the fact is absent.
 *   · A read the database answered with zero rows (RLS on project_financials
 *     for a reader without the finance capability) looked exactly like an empty
 *     book: Backlog $0, Foregone $0, 100% unpriced, and no banner.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *   · Promise.allSettled across every table. A table that fails is reported in
 *     `blocked` with its name and message, and everything else still loads, so
 *     each card can say "Blocked: <table> did not load" for exactly the tables
 *     it needs. A failed read is never $0 and never "none".
 *   · survey_projects, project_financials, project_segments and client_terms
 *     are read with select('*'). PostgREST rejects a WHOLE select that names a
 *     column the schema does not have yet, so naming a new column before its
 *     migration is applied would take the page down; '*' degrades instead.
 *   · Every table is PAGED and ORDERED — `.order(col).range(f, f + 999)`.
 *     PostgREST caps a response at 1,000 rows and truncates silently, and a
 *     range with no ORDER BY has no stable page boundary, so a row can appear
 *     twice or not at all. The order column is per table (project_financials
 *     has no `id`; ordering by a missing column fails the request).
 *   · The first page asks for count(exact), so the integrity line can say when
 *     the rows loaded disagree with the rows the database holds.
 *   · It recomputes every survey's spend from its rows and compares it with the
 *     stored actual_spend, and it counts the prices that came back — so a
 *     finance reader who receives zero prices is TOLD, not shown an empty book.
 *
 * Demo and test accounts (113) are dropped here, once, for every consumer.
 */

import {
  spendOf, buildIndex,
  type FinAccount, type FinContact, type FinCost, type FinProject, type FinRate, type FinSegment,
  type FinSupplier,
} from './hub'
import type { FinBlastDated, FinLaunch } from './savings'
import type { FinTerm } from './credits'
import { fmtNum } from '@/lib/utils/number'

/** A project_suppliers row with its panel's name. */
export type FinSupplierFull = FinSupplier & {
  id: string
  supplier_id: string | null
  launch_id: string | null
  completes_cap?: number | null
  created_at?: string | null
  suppliers?: { name: string | null } | null
}

/** A project_launches row — one PureSpectrum wave. */
export type FinLaunchFull = FinLaunch & {
  label: string | null
  launch_date: string | null
  note: string | null
  created_at?: string | null
}

export type FinCostFull = FinCost & {
  id: string
  quantity?: number | null
  incurred_on?: string | null
  created_at?: string | null
}

export type FinTermFull = FinTerm & {
  starts_on?: string | null
  renews_on?: string | null
  note?: string | null
}

export type FinAccountFull = FinAccount & { is_demo?: boolean | null }

export interface FinanceRaw {
  /** Live surveys (deleted_at is null), demo accounts dropped, each carrying
   *  its segments. Empty placeholders are KEPT here — the classifier excludes
   *  them — so the integrity line can count what the database holds. */
  projects: FinProject[]
  blasts: (FinBlastDated & { id: string })[]
  suppliers: FinSupplierFull[]
  launches: FinLaunchFull[]
  costs: FinCostFull[]
  /** project_financials rows as returned (select '*'). */
  financials: (FinRate & Record<string, unknown>)[]
  /** project_id → price per N, for rows with a price. */
  rates: Map<string, number>
  segments: FinSegment[]
  /** Non-demo accounts. */
  accounts: FinAccountFull[]
  contacts: FinContact[]
  terms: FinTermFull[]
}

export type FinanceTable =
  | 'survey_projects' | 'project_blasts' | 'project_suppliers' | 'project_launches'
  | 'project_costs' | 'project_financials' | 'project_segments'
  | 'clients' | 'client_contacts' | 'client_terms'

export interface Blocked { table: FinanceTable; message: string }

export interface LoadIntegrity {
  /** Rows read, per table. */
  loadedCounts: Record<FinanceTable, number>
  /** count(exact) the database reported, per table; null when it did not say. */
  expectedCounts: Record<FinanceTable, number | null>
  countMismatches: { table: FinanceTable; loaded: number; expected: number }[]
  /** Surveys whose recomputed spend equals the stored actual_spend to the cent. */
  spendRecomputedMatches: { matches: number; of: number; mismatchIds: string[] }
  /** project_financials rows that carry a price. Zero for a finance reader is a
   *  problem to REPORT (see integrityWarnings), not an empty book. */
  pricesReturned: number
  /** Demo-account surveys dropped. */
  demoDropped: number
  loadedAt: string
}

export interface FinanceLoad {
  raw: FinanceRaw
  blocked: Blocked[]
  integrity: LoadIntegrity
}

const TABLES: { table: FinanceTable; cols: string; order: string; live?: boolean }[] = [
  { table: 'survey_projects', cols: '*', order: 'id', live: true },
  { table: 'project_blasts', cols: 'id, project_id, bid, people, completes, cost_per_send, channel, blast_at, scheduled_at, created_at', order: 'id' },
  { table: 'project_suppliers', cols: 'id, project_id, supplier_id, launch_id, cpi, n_collected, completes_cap, created_at, suppliers(name)', order: 'id' },
  { table: 'project_launches', cols: 'id, project_id, label, launch_date, note, target, created_at', order: 'id' },
  { table: 'project_costs', cols: 'id, project_id, kind, amount, quantity, route, description, incurred_on, created_at', order: 'id' },
  // Keyed on project_id and has NO id column. Ordering by `id` fails the whole
  // request, and the first version of the old page caught that failure and
  // returned [] — which rendered as "nothing is priced".
  { table: 'project_financials', cols: '*', order: 'project_id' },
  { table: 'project_segments', cols: '*', order: 'id' },
  { table: 'clients', cols: 'id, name, is_demo', order: 'id' },
  { table: 'client_contacts', cols: 'id, client_id, first_name, last_name, email, archived', order: 'id' },
  { table: 'client_terms', cols: '*', order: 'id', live: true },
]

export const FINANCE_TABLES: FinanceTable[] = TABLES.map(t => t.table)

/** The slice of a Supabase client this file uses. Structural, so the browser
 *  client, the server client and a test double all fit. */
interface PageResult { data: unknown[] | null; error: { message: string } | null; count?: number | null }
interface Query extends PromiseLike<PageResult> {
  is(col: string, v: null): Query
  order(col: string, opts?: { ascending?: boolean }): Query
  range(from: number, to: number): Query
}
interface Reader { from(table: string): { select(cols: string, opts?: { count?: 'exact' }): Query } }

export const PAGE = 1000

async function readAll(
  client: Reader, t: (typeof TABLES)[number],
): Promise<{ rows: unknown[]; expected: number | null }> {
  const rows: unknown[] = []
  let expected: number | null = null
  for (let from = 0; ; from += PAGE) {
    let q = client.from(t.table).select(t.cols, from === 0 ? { count: 'exact' } : undefined)
    if (t.live) q = q.is('deleted_at', null)
    const { data, error, count } = await q.order(t.order).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message || `${t.table} did not load`)
    if (from === 0 && typeof count === 'number') expected = count
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows, expected }
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Read everything the finance hub needs. Never throws: a table that fails is in
 * `blocked`, and its slot in `raw` is empty — which the caller must render as
 * "Blocked", never as $0.
 *
 * `client` is any Supabase client (browser or server). Typed loosely because
 * the generated client's generic `from()` does not accept a plain string.
 */
export async function loadFinanceRaw(
  client: unknown, opts: { now?: Date } = {},
): Promise<FinanceLoad> {
  const reader = client as Reader
  const settled = await Promise.allSettled(TABLES.map(t => readAll(reader, t)))
  const blocked: Blocked[] = []
  const got = {} as Record<FinanceTable, unknown[]>
  const loadedCounts = {} as Record<FinanceTable, number>
  const expectedCounts = {} as Record<FinanceTable, number | null>
  const countMismatches: LoadIntegrity['countMismatches'] = []
  settled.forEach((r, i) => {
    const table = TABLES[i].table
    if (r.status === 'fulfilled') {
      got[table] = r.value.rows
      loadedCounts[table] = r.value.rows.length
      expectedCounts[table] = r.value.expected
      if (r.value.expected != null && r.value.expected !== r.value.rows.length) {
        countMismatches.push({ table, loaded: r.value.rows.length, expected: r.value.expected })
      }
    } else {
      got[table] = []
      loadedCounts[table] = 0
      expectedCounts[table] = null
      const reason = r.reason as { message?: string } | undefined
      blocked.push({ table, message: reason?.message ?? String(r.reason ?? 'did not load') })
    }
  })

  const clients = got.clients as FinAccountFull[]
  const demo = new Set(clients.filter(c => c.is_demo === true).map(c => c.id))
  // Filtered here rather than in the query because `NULL not in (…)` is NULL,
  // which would also drop every project with no client_id.
  const allProjects = got.survey_projects as FinProject[]
  const projects = allProjects.filter(p => !(p.client_id && demo.has(p.client_id)))

  const segments = (got.project_segments as FinSegment[]).slice()
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
  const segBy = new Map<string, FinSegment[]>()
  for (const s of segments) {
    const a = segBy.get(s.project_id)
    if (a) a.push(s); else segBy.set(s.project_id, [s])
  }
  // Attached as a fresh object so the rows PostgREST returned are not mutated.
  const withSegs = projects.map(p => {
    const segs = segBy.get(p.id)
    return segs ? { ...p, segments: segs } : p
  })

  const financials = got.project_financials as (FinRate & Record<string, unknown>)[]
  const rates = new Map<string, number>()
  for (const f of financials) {
    const v = num(f.price_per_n)
    if (v != null && v >= 0) rates.set(f.project_id, v)
  }

  const blasts = got.project_blasts as (FinBlastDated & { id: string })[]
  const suppliers = got.project_suppliers as FinSupplierFull[]
  const costs = got.project_costs as FinCostFull[]

  // The recomputation check: this file's arithmetic against the database
  // trigger's, to the cent. Only meaningful when all three child tables loaded.
  const ix = buildIndex(blasts, suppliers, costs)
  const childrenLoaded = !blocked.some(b =>
    b.table === 'project_blasts' || b.table === 'project_suppliers' || b.table === 'project_costs')
  let matches = 0
  const mismatchIds: string[] = []
  if (childrenLoaded) {
    for (const p of withSegs) {
      const recomputed = spendOf(p, blasts, suppliers, costs, ix).total
      const stored = num(p.actual_spend) ?? 0
      if (Math.abs(recomputed - stored) < 0.01) matches++
      else mismatchIds.push(p.id)
    }
  }

  return {
    raw: {
      projects: withSegs,
      blasts,
      suppliers,
      launches: got.project_launches as FinLaunchFull[],
      costs,
      financials,
      rates,
      segments,
      accounts: clients.filter(c => !demo.has(c.id)),
      contacts: got.client_contacts as FinContact[],
      terms: got.client_terms as FinTermFull[],
    },
    blocked,
    integrity: {
      loadedCounts,
      expectedCounts,
      countMismatches,
      spendRecomputedMatches: { matches, of: childrenLoaded ? withSegs.length : 0, mismatchIds },
      pricesReturned: rates.size,
      demoDropped: allProjects.length - projects.length,
      loadedAt: (opts.now ?? new Date()).toISOString(),
    },
  }
}

/** Did this table fail to load? */
export const isBlocked = (blocked: Blocked[], table: FinanceTable) => blocked.some(b => b.table === table)

/** The card-level message for a failed read: names the table, never says $0. */
export const blockedText = (table: FinanceTable) => `Blocked: ${table} did not load`

/**
 * Why a card built on CLIENT PRICES cannot show its figures, or null when it
 * can. A card that reads this renders the reason in place of its numbers:
 * computed from an empty price map, Backlog reads "$0 if every one lands on
 * target", Revenue foregone reads $0 and every dollar of spend reads as
 * "can never reach a margin" — all of it false, and only a banner at the top
 * of the page said otherwise.
 *
 * Three causes: project_financials failed; project_segments failed, so a
 * survey whose N actual is kept only on its segments cannot be billed (the
 * roll-up in revenue.ts deliveredNOf needs them) and the segment notes are
 * missing; or a finance holder got zero prices back, which is a read problem,
 * not an empty book. Null for a reader without the capability — those cards are not shown
 * to them at all, and "blocked" would claim there is something to see.
 */
export function priceBlockText(
  load: Pick<FinanceLoad, 'blocked' | 'integrity'>, opts: { canViewFinancials: boolean },
): string | null {
  if (!opts.canViewFinancials) return null
  if (isBlocked(load.blocked, 'project_financials')) return blockedText('project_financials')
  if (isBlocked(load.blocked, 'project_segments')) {
    return `${blockedText('project_segments')}, so segmented surveys cannot be checked`
  }
  if (load.integrity.pricesReturned === 0) return 'Blocked: project_financials returned no prices'
  return null
}

/** The field-cost tables. A card built on spend still has a figure when one
 *  fails, but it is a floor missing that table's money, and it must say so. */
const COST_TABLES: FinanceTable[] = ['project_blasts', 'project_suppliers', 'project_costs']

/** The per-card line for a failed cost table, or null when all three loaded. */
export function costFloorText(load: Pick<FinanceLoad, 'blocked'>): string | null {
  const failed = COST_TABLES.filter(t => isBlocked(load.blocked, t))
  if (!failed.length) return null
  return `Floor only: ${failed.join(', ')} did not load, so the cost here leaves out ${failed.length === 1 ? 'that table' : 'those tables'}.`
}

/**
 * The load as a reader WITHOUT the finance capability may hold it: no client
 * prices (neither the project rate nor a segment override) and no budgets.
 *
 * RLS already returns no project_financials rows to such a reader, but 086
 * leaves segment price overrides and survey budgets readable, because they sit
 * on tables analysts need for other work. Revenue no longer reads a segment's
 * price (the bill uses the survey's one rate), but the segment-price note does,
 * so left in, a client price would reach an analyst's browser the day the first
 * segment override is entered, and a budget-derived sentence would reach them
 * wherever a card forgot its own gate. Stripped once, here, no card can show what it was never
 * handed. The capability checks on each card stay as the second lock.
 */
export function withoutFinancials(raw: FinanceRaw): FinanceRaw {
  const seg = (s: FinSegment): FinSegment => ({ ...s, price_per_n: null })
  return {
    ...raw,
    projects: raw.projects.map(p => ({
      ...p,
      budget: null,
      ...(p.segments ? { segments: p.segments.map(seg) } : {}),
    })),
    segments: raw.segments.map(seg),
    financials: [],
    rates: new Map(),
  }
}

/**
 * What the integrity line must turn red for: a failed read, a row count that
 * disagrees with the database's own count, recomputed spend that disagrees
 * with the stored figure, or zero prices returned to someone who should see
 * them. Plain English, one line each.
 */
export function integrityWarnings(
  load: Pick<FinanceLoad, 'blocked' | 'integrity'>, opts: { canViewFinancials: boolean },
): string[] {
  const out: string[] = []
  for (const b of load.blocked) out.push(`${blockedText(b.table)} (${b.message}).`)
  for (const m of load.integrity.countMismatches) {
    out.push(`${m.table}: loaded ${fmtNum(m.loaded)} rows but the database holds ${fmtNum(m.expected)}.`)
  }
  const s = load.integrity.spendRecomputedMatches
  if (s.of > 0 && s.matches < s.of) {
    out.push(`Recomputed spend differs from the stored figure on ${fmtNum(s.of - s.matches)} of ${fmtNum(s.of)} surveys.`)
  }
  if (opts.canViewFinancials && !load.blocked.some(b => b.table === 'project_financials') && load.integrity.pricesReturned === 0) {
    out.push('No client prices came back. Revenue and margin figures are missing, not zero — this is a read problem, not an empty book.')
  }
  return out
}

/**
 * "Loaded 441 surveys · 1,063 blasts · 3,027 panel rows · 49 cost lines · 71
 * prices · recomputed spend = stored on 441 of 441 · 18:40"
 *
 * `canViewFinancials` is required. A reader without it is returned no prices by
 * RLS, so "0 prices" would be a false statement about the book (and "71
 * prices" a leak of how much is priced); for them the part is left out.
 */
export function integrityLine(
  i: LoadIntegrity, opts: { canViewFinancials: boolean; time?: string },
): string {
  const f = (x: number) => fmtNum(x)
  // Surveys as the page counts them — demo accounts are dropped once, here in
  // the loader — so this agrees with the "of N" in the spend check beside it.
  const surveys = Math.max(0, (i.loadedCounts.survey_projects ?? 0) - i.demoDropped)
  const parts = [
    `Loaded ${f(surveys)} surveys` + (i.demoDropped > 0 ? ` (${f(i.demoDropped)} demo left out)` : ''),
    `${f(i.loadedCounts.project_blasts ?? 0)} blasts`,
    `${f(i.loadedCounts.project_suppliers ?? 0)} panel rows`,
    `${f(i.loadedCounts.project_costs ?? 0)} cost lines`,
    ...(opts.canViewFinancials ? [`${f(i.pricesReturned)} prices`] : []),
  ]
  const s = i.spendRecomputedMatches
  if (s.of > 0) parts.push(`recomputed spend = stored on ${f(s.matches)} of ${f(s.of)}`)
  if (opts.time) parts.push(opts.time)
  return parts.join(' · ')
}

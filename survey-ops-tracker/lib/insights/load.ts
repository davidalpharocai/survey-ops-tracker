/**
 * Every read the Insights dashboard makes — and, as importantly, every column
 * it does NOT make.
 *
 * ── NO MONEY, NOT EVEN IN THE NETWORK TAB ───────────────────────────────────
 * Insights is the analyst dashboard and shows no dollar figure to anyone,
 * finance holders included (they have /finance). Hiding a column in the UI is
 * not enough: anything selected arrives in the browser and can be read in the
 * network panel. So the survey read names its columns one by one and none of
 * them is a money column, the child tables are read for `project_id` ONLY
 * (to tell an empty rerun placeholder from real work), and a test
 * (load.test.ts) fails the build if a money-shaped column ever joins a select.
 *
 * ── HONEST ABOUT FAILURE ────────────────────────────────────────────────────
 * Promise.allSettled across the tables. A table that fails is reported in
 * `blocked` with its name, and the page says "Blocked: <table> did not load"
 * rather than drawing zeros — a failed read is not "none". Every read is
 * PAGED and ORDERED (`.order(col).range(f, f + 999)`): PostgREST truncates at
 * 1,000 rows without saying so, and a range with no ORDER BY has no stable
 * page boundary.
 *
 * Every column named here exists today (075 is_placeholder, 069 cancelled_at,
 * 073 series_id, 040 rerun_number, 078 n_target_max). A column added later must
 * not be named until its migration is applied: PostgREST rejects the WHOLE
 * select, which would blank this page for everyone.
 */

import type { FieldRowCounts } from '@/lib/finance/lifecycle'

/** The survey columns Insights reads. Deliberately no money column, no internal
 *  target, and no `*` (which would drag every money column along). */
export const INSIGHTS_PROJECT_COLUMNS = [
  'id',
  'project_code',
  'project_name',
  'client',
  'client_id',
  'status',
  'phase',
  'board_column',
  'project_type',
  'submitted_date',
  // REQUIRES MIGRATION 128. PostgREST rejects an entire select that names a
  // column the database has not got, so this line is why this change must not
  // be deployed ahead of the SQL: Insights would not degrade, it would go dark.
  'greenlit_at',
  'launch_date',
  'due_date',
  'deliver_date',
  'n_target',
  'n_target_max',
  'n_collected',
  'n_actual',
  'is_placeholder',
  'cancelled_at',
  'series_id',
  'rerun_number',
  'captain:team_members(id, name, initials)',
] as const

export const INSIGHTS_PROJECT_SELECT = INSIGHTS_PROJECT_COLUMNS.join(', ')

/** The child tables, read for their survey id alone: the classifier needs to
 *  know whether a rerun placeholder has any blast, panel or cost row. */
export const CHILD_TABLES = ['project_blasts', 'project_suppliers', 'project_costs'] as const
export type ChildTable = (typeof CHILD_TABLES)[number]
export const CHILD_SELECT = 'project_id'

export const CLIENT_SELECT = 'id, name, is_demo'

export type InsightsTable = 'survey_projects' | 'clients' | ChildTable

/** Every select string this module sends, by table — what the no-money test
 *  checks, and what a reviewer reads to know what reaches the browser. */
export const INSIGHTS_SELECTS: Record<InsightsTable, string> = {
  survey_projects: INSIGHTS_PROJECT_SELECT,
  clients: CLIENT_SELECT,
  project_blasts: CHILD_SELECT,
  project_suppliers: CHILD_SELECT,
  project_costs: CHILD_SELECT,
}

export interface InsightsProject {
  id: string
  project_code: string | null
  project_name: string | null
  client: string | null
  client_id: string | null
  status: string | null
  phase: string | null
  board_column: string | null
  project_type: string | null
  submitted_date: string | null
  /** Null for every study that predates migration 128 — see cycleStartOf. */
  greenlit_at?: string | null
  launch_date: string | null
  due_date: string | null
  deliver_date: string | null
  n_target: number | null
  n_target_max: number | null
  n_collected: number | null
  n_actual: number | null
  is_placeholder: boolean | null
  cancelled_at: string | null
  series_id: string | null
  rerun_number: number | null
  captain: { id: string; name: string; initials: string | null } | null
}

export interface InsightsBlocked { table: InsightsTable; message: string }

export interface InsightsRaw {
  /** Live surveys (deleted_at is null), demo accounts already dropped. Empty
   *  placeholders are KEPT — the model's classifier drops them — so the page
   *  can say how many it left out. */
  projects: InsightsProject[]
  /** project_id → child row counts. null when any child table failed, so the
   *  page can say placeholders could not be checked instead of guessing. */
  rowCounts: Map<string, FieldRowCounts> | null
  /** clients.id → name, demo accounts excluded. Empty when clients failed. */
  accounts: Map<string, string>
  blocked: InsightsBlocked[]
  /** Surveys on demo / test accounts, dropped here (migration 113). null when
   *  `clients` did not load: which accounts are demo is then unknown, and a
   *  failed read is not "0 dropped". */
  demoDropped: number | null
}

export const PAGE = 1000

/** The slice of a Supabase client this file uses — structural, so the browser
 *  client and a test double both fit. */
interface PageResult { data: unknown[] | null; error: { message: string } | null }
interface Query extends PromiseLike<PageResult> {
  is(col: string, v: null): Query
  order(col: string, opts?: { ascending?: boolean }): Query
  range(from: number, to: number): Query
}
interface Reader { from(table: string): { select(cols: string): Query } }

async function readAll(client: Reader, table: InsightsTable, order: string, live: boolean): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(INSIGHTS_SELECTS[table])
    if (live) q = q.is('deleted_at', null)
    const { data, error } = await q.order(order).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message || `${table} did not load`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

const READS: { table: InsightsTable; order: string; live: boolean }[] = [
  { table: 'survey_projects', order: 'id', live: true },
  { table: 'clients', order: 'id', live: false },
  // Ordered by `id`, which is not selected: PostgREST orders by any column the
  // reader may see, and naming it in the select would add nothing.
  { table: 'project_blasts', order: 'id', live: false },
  { table: 'project_suppliers', order: 'id', live: false },
  { table: 'project_costs', order: 'id', live: false },
]

/** Read everything Insights needs. Never throws: a failed table is in
 *  `blocked`, and its slot is empty — which the page must show as Blocked. */
export async function loadInsightsRaw(client: unknown): Promise<InsightsRaw> {
  const reader = client as Reader
  const settled = await Promise.allSettled(READS.map(r => readAll(reader, r.table, r.order, r.live)))
  const blocked: InsightsBlocked[] = []
  const got = {} as Record<InsightsTable, unknown[]>
  settled.forEach((s, i) => {
    const table = READS[i].table
    if (s.status === 'fulfilled') got[table] = s.value
    else {
      got[table] = []
      const reason = s.reason as { message?: string } | undefined
      blocked.push({ table, message: reason?.message ?? String(s.reason ?? 'did not load') })
    }
  })
  const failed = new Set(blocked.map(b => b.table))

  const clients = got.clients as { id: string; name: string | null; is_demo?: boolean | null }[]
  const demo = new Set(clients.filter(c => c.is_demo === true).map(c => c.id))
  const accounts = new Map<string, string>()
  for (const c of clients) if (!demo.has(c.id)) accounts.set(c.id, c.name?.trim() || '(unnamed account)')

  // Filtered here rather than in the query: `client_id not in (...)` is NULL
  // for a survey with no client_id, which would silently drop it — and "no
  // account recorded" is not "demo".
  const all = got.survey_projects as InsightsProject[]
  const projects = all.filter(p => !(p.client_id && demo.has(p.client_id)))

  let rowCounts: Map<string, FieldRowCounts> | null = null
  if (!CHILD_TABLES.some(t => failed.has(t))) {
    rowCounts = new Map()
    const bump = (rows: unknown[], key: keyof FieldRowCounts) => {
      for (const r of rows as { project_id: string | null }[]) {
        if (!r.project_id) continue
        const c = rowCounts!.get(r.project_id) ?? { blasts: 0, suppliers: 0, costs: 0 }
        c[key] = (c[key] ?? 0) + 1
        rowCounts!.set(r.project_id, c)
      }
    }
    bump(got.project_blasts, 'blasts')
    bump(got.project_suppliers, 'suppliers')
    bump(got.project_costs, 'costs')
  }

  return {
    projects, rowCounts, accounts, blocked,
    demoDropped: failed.has('clients') ? null : all.length - projects.length,
  }
}

/** "Blocked: project_costs did not load (permission denied)". */
export function blockedText(b: InsightsBlocked): string {
  return `Blocked: ${b.table} did not load${b.message ? ` (${b.message})` : ''}`
}

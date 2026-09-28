import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { spendOf } from '@/lib/finance/hub'
import { todayET } from '@/lib/finance/filters'
import {
  CLEANUP_PROJECT_COLUMNS, CLEANUP_PROJECT_SELECT, demoAccountIds, withoutDemoAccounts,
  type AccountFlag, type CleanupRow, type CleanupSource, type FieldFacts,
} from '@/lib/admin/cleanup'

/**
 * Everything the data-cleanup dashboard reads, read ON THE SERVER.
 *
 * ── WHY THE SERVER, WHEN EVERY OTHER LIST IN THIS APP LOADS IN THE BROWSER ──
 * Because of the money. `spend_not_recomputed` needs to know that a survey's
 * child rows record spend while its own `actual_spend` is 0 — and that is the
 * only thing it needs to know. Loading in the browser would put `actual_spend`,
 * and every blast bid and supplier CPI behind it, into a network response on a
 * page whose whole point is that it carries no money. So the arithmetic happens
 * here and two booleans cross the wire (`recordsSpend`, `spendIsZero`). The
 * response can be read in the network panel without learning a single figure.
 *
 * The same reasoning is why lib/admin/cleanup.ts names its select column by
 * column and leaves the money columns out: what is not selected cannot leak.
 * `actual_spend` is read here, in its own query, and is never joined onto a row
 * that is handed onward. `n_internal_target` rides in that same private query
 * for the same reason — it is restricted from the sales tier, and a column
 * selected but never rendered still travels to the browser inside the RSC
 * payload. What crosses is the LIST OF IDS that have one, which is all
 * `no_n_target` needs to avoid accusing them of having no target at all.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * CLEANUP_LOADER_CONTRACT, kept honest here:
 *   · `deleted_at is null` and `status != 'Cancelled'` on the survey read. A
 *     cancelled survey is not a data gap, and a deleted one is not a survey.
 *   · every read PAGED and ORDERED — PostgREST caps a response at 1,000 rows
 *     and truncates silently, and there are 3,439 supplier rows alone. A range
 *     without an order has no stable page boundary, so a row can arrive twice
 *     or not at all.
 *   · Promise.allSettled across the child tables, and anything that failed is
 *     named in `blocked`, so its checks report "we could not measure this"
 *     instead of a confident zero.
 *
 * ── THE THREE READS THAT ARE NOT ALLOWED TO FAIL SOFTLY ─────────────────────
 * The surveys, their `actual_spend`, and the accounts list. There is no
 * dashboard without the first, no honest spend boolean without the second, and
 * no way to tell a real survey from a demo one without the third — a missing
 * accounts list would silently admit the three test accounts and put a gap
 * nobody can fix onto a dashboard whose goal state is every tile at zero. Those
 * three fail the PAGE, with the reason on screen, rather than quietly changing
 * what the numbers mean.
 */

/** Serializable: this crosses the server/client boundary, where a Map does not. */
export interface CleanupData {
  projects: CleanupRow[]
  /** Survey id → what its child rows say. Counts and two booleans, no amounts. */
  fielding: Record<string, FieldFacts>
  /** Client contact id → whether they have been invited to Occam. A contact
   *  that is absent means no contact row was found for it, which the Occam
   *  check reports as its own kind of gap rather than passing over. */
  contacts: Record<string, boolean>
  /** Ids of the surveys carrying an `n_internal_target`. The membership, never
   *  the number: the column is restricted from the sales tier. */
  internalTargets: string[]
  blocked: CleanupSource[]
  /** Why each blocked read failed, in the database's own words. */
  blockedWhy: { source: CleanupSource; message: string }[]
  /** YYYY-MM-DD in New York, where the team works. */
  today: string
  /** When this was read, in words and in the team's time zone — formatted HERE
   *  on purpose. Formatting a timestamp in the browser renders one string on
   *  the server and another on the client, which React reports as a hydration
   *  mismatch and which would make the page flicker for no reason. */
  loadedAtLabel: string
  /** Set when the survey, spend or accounts read failed: there is no dashboard,
   *  and the page says so rather than rendering an empty, clean-looking one. */
  error: string | null
}

/** "2:02 PM", in New York. */
export const readTimeLabel = (now: Date = new Date()): string =>
  now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

export const emptyData = (message: string): CleanupData => ({
  projects: [], fielding: {}, contacts: {}, internalTargets: [], blocked: [], blockedWhy: [],
  today: todayET(), loadedAtLabel: readTimeLabel(), error: message,
})

/* ── READING ────────────────────────────────────────────────────────────── */

export const PAGE = 1000

/** The slice of a Supabase client this file uses. Structural, so the server
 *  client and a test double both fit without fighting generated generics. */
interface PageResult { data: unknown[] | null; error: { message: string } | null }
interface Query extends PromiseLike<PageResult> {
  is(col: string, v: null): Query
  neq(col: string, v: string): Query
  order(col: string): Query
  range(from: number, to: number): Query
}
export interface Reader { from(table: string): { select(cols: string): Query } }

interface Read {
  table: string
  cols: string
  order: string
  /** Live, non-cancelled surveys only. */
  live?: boolean
}

async function readAll(client: Reader, t: Read): Promise<unknown[]> {
  const rows: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    let q = client.from(t.table).select(t.cols)
    // `status` is a NOT NULL enum, so `neq` cannot drop a null-status row the
    // way `<> 'Cancelled'` would if the column were nullable.
    if (t.live) q = q.is('deleted_at', null).neq('status', 'Cancelled')
    const { data, error } = await q.order(t.order).range(from, from + PAGE - 1)
    if (error) throw new Error(error.message || `${t.table} did not load`)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/** The child tables, each mapped to the `CleanupSource` its failure blocks. */
const CHILD: { source: CleanupSource; read: Read }[] = [
  { source: 'blasts', read: { table: 'project_blasts', cols: 'project_id, bid, people, completes, cost_per_send, channel', order: 'id' } },
  { source: 'suppliers', read: { table: 'project_suppliers', cols: 'project_id, cpi, n_collected', order: 'id' } },
  { source: 'launches', read: { table: 'project_launches', cols: 'project_id', order: 'id' } },
  { source: 'costs', read: { table: 'project_costs', cols: 'project_id, amount', order: 'id' } },
  { source: 'contacts', read: { table: 'client_contacts', cols: 'id, occam_invited', order: 'id' } },
]

const SURVEYS: Read = { table: 'survey_projects', cols: CLEANUP_PROJECT_SELECT, order: 'id', live: true }
/** The columns that must not reach the browser, read on their own and collapsed
 *  to a boolean and a membership before anything is handed onward. */
const PRIVATE: Read = { table: 'survey_projects', cols: 'id, actual_spend, n_internal_target', order: 'id', live: true }
const ACCOUNTS: Read = { table: 'clients', cols: 'id, is_demo', order: 'id' }

interface Child { project_id: string }
function by<T extends Child>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const a = m.get(r.project_id)
    if (a) a.push(r)
    else m.set(r.project_id, [r])
  }
  return m
}

type BlastRow = Child & {
  bid: number | null; people: number | null; completes: number | null
  cost_per_send: number | null; channel: string | null
}
type SupplierRow = Child & { cpi: number | null; n_collected: number | null }
type CostRow = Child & { amount: number | null }

/**
 * The survey row as it leaves here: the named columns, plus the joined captain
 * flattened to a name. Nothing else.
 *
 * Built by PICKING `CLEANUP_PROJECT_COLUMNS` rather than by spreading what came
 * back, so a column added to a select — deliberately, as `actual_spend` and
 * `n_internal_target` are on the private read, or by accident — cannot ride into
 * the payload this page ships to the browser. What is not on that list does not
 * cross, and that list is what the "no money" rule is written against.
 */
function toRow(raw: Record<string, unknown>): CleanupRow {
  const captain = raw.captain as { name?: string | null; initials?: string | null } | null | undefined
  const row: Record<string, unknown> = {}
  for (const col of CLEANUP_PROJECT_COLUMNS) row[col] = raw[col] ?? null
  return {
    ...(row as unknown as CleanupRow),
    captain_name: captain?.name ?? captain?.initials ?? null,
  }
}

export async function loadCleanup(client?: Reader): Promise<CleanupData> {
  const reader = client ?? ((await createClient()) as unknown as Reader)
  const today = todayET()
  const loadedAtLabel = readTimeLabel()

  // The three that must succeed. A rejection here is the page's error, not a
  // blocked tile.
  let rawProjects: Record<string, unknown>[]
  let privateRows: { id: string; actual_spend: number | null; n_internal_target: number | null }[]
  let accounts: AccountFlag[]
  try {
    const [p, s, a] = await Promise.all([
      readAll(reader, SURVEYS), readAll(reader, PRIVATE), readAll(reader, ACCOUNTS),
    ])
    rawProjects = p as Record<string, unknown>[]
    privateRows = s as { id: string; actual_spend: number | null; n_internal_target: number | null }[]
    accounts = a as AccountFlag[]
  } catch (err) {
    return emptyData(err instanceof Error ? err.message : String(err))
  }

  // Demo and test accounts, dropped once, here — the same three the finance hub
  // drops, and the reason the live book is 437 surveys and not 438. The rule
  // itself lives in lib/admin/cleanup.ts so the connector drops exactly the same
  // rows; two loaders scanning two populations is how the tile and the assistant
  // came to report different numbers on the same afternoon.
  const projects = withoutDemoAccounts(rawProjects.map(toRow), demoAccountIds(accounts))

  const settled = await Promise.allSettled(CHILD.map(c => readAll(reader, c.read)))
  const got = new Map<CleanupSource, unknown[]>()
  const blocked: CleanupSource[] = []
  const blockedWhy: { source: CleanupSource; message: string }[] = []
  settled.forEach((r, i) => {
    const { source } = CHILD[i]
    if (r.status === 'fulfilled') {
      got.set(source, r.value)
    } else {
      got.set(source, [])
      blocked.push(source)
      const reason = r.reason as { message?: string } | undefined
      blockedWhy.push({ source, message: reason?.message ?? String(r.reason ?? 'did not load') })
    }
  })

  const blasts = by(got.get('blasts') as BlastRow[])
  const suppliers = by(got.get('suppliers') as SupplierRow[])
  const launches = by(got.get('launches') as Child[])
  const costs = by(got.get('costs') as CostRow[])
  const spendById = new Map(privateRows.map(r => [r.id, Number(r.actual_spend ?? 0)]))
  const withInternalTarget = new Set(
    privateRows.filter(r => r.n_internal_target != null).map(r => r.id))
  const live = new Set(projects.map(r => r.id))

  const fielding: Record<string, FieldFacts> = {}
  for (const r of projects) {
    const b = blasts.get(r.id) ?? []
    const s = suppliers.get(r.id) ?? []
    const c = costs.get(r.id) ?? []
    const l = launches.get(r.id) ?? []
    // A survey with no child rows at all has nothing to say. Left out of the
    // map rather than written as zeroes, so the payload carries facts only
    // where there are any; `facts()` answers NO_FIELD_FACTS for an absent id.
    if (b.length + s.length + c.length + l.length === 0) continue
    // The app's ONE spend formula (lib/finance/hub.ts), so this cannot drift
    // from the finance hub or from recompute_project_spend. Only its sign
    // survives the call.
    const total = spendOf(r, b, s, c).total
    fielding[r.id] = {
      blasts: b.length,
      suppliers: s.length,
      launches: l.length,
      costs: c.length,
      recordsSpend: total > 0,
      spendIsZero: !(Number(spendById.get(r.id) ?? 0) > 0),
    }
  }

  const contacts: Record<string, boolean> = {}
  for (const c of got.get('contacts') as { id: string; occam_invited: boolean | null }[]) {
    contacts[c.id] = c.occam_invited === true
  }

  return {
    projects, fielding, contacts,
    // Only for the surveys that survived the demo filter, so the payload names
    // no survey the page is not showing.
    internalTargets: [...withInternalTarget].filter(id => live.has(id)),
    blocked, blockedWhy, today, loadedAtLabel, error: null,
  }
}

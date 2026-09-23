import { ilikeOr, isSearchable, scoreRow, RANK } from './match'
import { objectsFor, type Ctx, type Row, type SearchObject, type Tier } from './objects'

/**
 * Runs one query per object, then fills in the names those rows point at.
 *
 * ── STRUCTURAL CLIENT TYPE, ON PURPOSE ──────────────────────────────────────
 * This takes anything shaped like a Supabase query builder rather than
 * SupabaseClient<Database>. The generated types lag the hand-applied migrations
 * -- sales_deliverables landed in 118 and is not in them at all -- so typing
 * against Database would make this file fail to compile for tables that exist
 * and work. The shape below is the part actually used, and nothing more.
 */
interface Filterable extends PromiseLike<{ data: Row[] | null; error: unknown; count?: number | null }> {
  or(filter: string): Filterable
  is(column: string, value: null | boolean): Filterable
  not(column: string, operator: string, value: unknown): Filterable
  in(column: string, values: readonly string[]): Filterable
  limit(n: number): Filterable
}

export interface SearchClient {
  from(table: string): { select(columns: string, options?: { count: 'exact' }): Filterable }
}

export interface Hit {
  key: string
  title: string
  subtitle: string | null
  tag: string | null
  href: string | null
  rank: number
}

export interface Group {
  id: string
  label: string
  hits: Hit[]
  /** Total matches in the database, which can exceed hits.length. */
  total: number
  /** True when the object's own query failed, so an empty section can say
   *  "could not read" instead of the confident lie "no matches". */
  failed: boolean
}

/** How many rows to pull per object. Generous, because the page groups and the
 *  reader expands -- but bounded, so one broad word cannot drag the whole book
 *  across the wire. */
const FETCH = 100

export async function runSearch(
  supabase: SearchClient,
  tier: Tier,
  query: string,
): Promise<{ groups: Group[]; total: number; truncated: boolean }> {
  const q = (query ?? '').trim()
  if (!isSearchable(q)) return { groups: [], total: 0, truncated: false }

  const objects = objectsFor(tier)

  // Every object at once. One slow table must not hold up the other nine.
  const settled = await Promise.all(objects.map(o => fetchOne(supabase, o, q)))

  // ── Fill in the names ─────────────────────────────────────────────────────
  // Rows carry project_id / client_id, not labels. Collected across ALL objects
  // and fetched once each, rather than per section, so a search that hits notes
  // and contacts and contracts does not ask for the same account three times.
  const projectIds = new Set<string>()
  const clientIds = new Set<string>()
  objects.forEach((o, i) => {
    if (!o.joins?.length) return
    for (const r of settled[i].rows) {
      if (o.joins.includes('project') && typeof r['project_id'] === 'string') projectIds.add(r['project_id'])
      if (o.joins.includes('client') && typeof r['client_id'] === 'string') clientIds.add(r['client_id'])
    }
  })

  const ctx: Ctx = { projects: new Map(), clients: new Map() }
  await Promise.all([
    hydrate(supabase, tier === 'sales' ? 'sales_projects' : 'survey_projects',
      'id, project_code, project_name', [...projectIds], r => {
        ctx.projects.set(String(r['id']), {
          code: typeof r['project_code'] === 'string' ? r['project_code'] : null,
          name: typeof r['project_name'] === 'string' ? r['project_name'] : '',
        })
      }),
    hydrate(supabase, tier === 'sales' ? 'sales_clients' : 'clients',
      'id, name, code', [...clientIds], r => {
        ctx.clients.set(String(r['id']), {
          name: typeof r['name'] === 'string' ? r['name'] : '',
          code: typeof r['code'] === 'string' ? r['code'] : null,
        })
      }),
  ])

  const groups: Group[] = objects.map((o, i) => {
    const { rows, total, failed } = settled[i]
    const hits = rows
      .map(r => ({
        row: r,
        rank: scoreRow(o.columns.map(c => (typeof r[c] === 'string' ? (r[c] as string) : null)), q),
      }))
      // ilike already filtered, but a row can reach here whose only match was in
      // a column this object selects and does not search -- drop it rather than
      // render a result with no visible reason for being there.
      .filter(x => x.rank !== RANK.miss)
      .sort((a, b) => a.rank - b.rank || o.title(a.row, ctx).localeCompare(o.title(b.row, ctx)))
      .map(({ row, rank }): Hit => ({
        key: `${o.id}-${String(row['id'] ?? Math.random())}`,
        title: o.title(row, ctx),
        subtitle: o.subtitle(row, ctx, q),
        tag: o.tag?.(row) ?? null,
        href: o.href(row),
        rank,
      }))
    return { id: o.id, label: o.label, hits, total: Math.max(total, hits.length), failed }
  })

  return {
    groups,
    total: groups.reduce((t, g) => t + g.total, 0),
    truncated: groups.some(g => g.total > g.hits.length),
  }
}

async function fetchOne(
  supabase: SearchClient,
  o: SearchObject,
  q: string,
): Promise<{ rows: Row[]; total: number; failed: boolean }> {
  try {
    let b = supabase.from(o.from).select(o.select, { count: 'exact' }).or(ilikeOr(o.columns, q))
    if (o.liveWhen) {
      b = o.liveWhen.is === 'null'
        ? b.is(o.liveWhen.column, null)
        // `not is true` rather than `is false`. Today the only such column is
        // client_contacts.archived, which is `not null default false`, so the
        // two agree -- but if a later migration adds a nullable flag, `is false`
        // would silently drop every row that predates it and this will not.
        : b.not(o.liveWhen.column, 'is', true)
    }
    const { data, error, count } = await b.limit(FETCH)
    // A failed read is NOT an empty result. Saying "no matches" when the query
    // errored is the same class of lie as a $0 total from a failed money read.
    if (error) return { rows: [], total: 0, failed: true }
    const rows = data ?? []
    return { rows, total: typeof count === 'number' ? count : rows.length, failed: false }
  } catch {
    return { rows: [], total: 0, failed: true }
  }
}

async function hydrate(
  supabase: SearchClient,
  from: string,
  select: string,
  ids: string[],
  put: (r: Row) => void,
): Promise<void> {
  if (!ids.length) return
  // PostgREST caps a response at 1000 rows and truncates SILENTLY, and a long
  // `in` list can also overrun the URL. Chunked on both counts.
  for (let i = 0; i < ids.length; i += 200) {
    try {
      const { data, error } = await supabase.from(from).select(select).in('id', ids.slice(i, i + 200)).limit(200)
      if (error) continue
      for (const r of data ?? []) put(r)
    } catch {
      // A name that cannot be resolved renders as a row without a subtitle,
      // which is worse-looking and still true. It must not take down the search.
    }
  }
}

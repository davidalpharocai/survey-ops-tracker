import { excerpt } from './match'
import { stageOf } from '@/lib/sales/stage'

/**
 * Every object the search knows how to find, for each tier.
 *
 * David, 2026-09-23, asked for a Salesforce-style system-wide search grouped by
 * object, over "everything available/possible". This file is that list, as data
 * rather than as ten hand-written queries, so a new object is one entry and both
 * the dropdown and the results page pick it up.
 *
 * ── WHY THE TIERS ARE TWO LISTS AND NOT ONE WITH FLAGS ──────────────────────
 * The sales tier does not read the tables at all. Migrations 102/105/111/118
 * give it six security_barrier views and nothing else, and the base-table
 * policies were deliberately dropped. A single list with an `ifSales` flag would
 * put a table name in reach of a sales session and rely on a boolean to stop it;
 * two lists mean the sales search has no table name in it to get wrong.
 *
 * That is also why sales gets FIVE objects and the analyst gets ten. There is no
 * sales_rerun_series, no sales view over notes, activity, steps or the team
 * roster, and inventing one is a disclosure decision rather than a search
 * feature. A salesperson searching "wealth manager" finds their surveys, their
 * accounts, their contacts, their contracts and their files — which is their
 * whole world in this app.
 */

export type Tier = 'analyst' | 'sales'
export type Row = Record<string, unknown>

/** Ids resolved in one pass after the searches run, for subtitles and links. */
export interface Ctx {
  projects: Map<string, { code: string | null; name: string }>
  clients: Map<string, { name: string; code: string | null }>
}

export interface SearchObject {
  id: string
  /** Section heading, and the label on the filter rail. */
  label: string
  /** Table or view. On the sales tier this is ALWAYS a sales_* view. */
  from: string
  select: string
  /** Columns the ilike runs over. */
  columns: string[]
  /** A column that must be null (soft delete) or false (archive flag). */
  liveWhen?: { column: string; is: 'null' | 'false' }
  /** Which id maps this object needs filled in before rendering. */
  joins?: ('project' | 'client')[]
  title: (r: Row, c: Ctx) => string
  subtitle: (r: Row, c: Ctx, q: string) => string | null
  /** Null means the row has no page to open — rendered as plain text. */
  href: (r: Row) => string | null
  /** A short word for the row, e.g. the stage or the file type. */
  tag?: (r: Row) => string | null
}

const s = (r: Row, k: string): string | null => {
  const v = r[k]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
const id = (r: Row, k = 'id'): string => String(r[k] ?? '')

const personName = (r: Row): string =>
  [s(r, 'first_name'), s(r, 'last_name')].filter(Boolean).join(' ') || s(r, 'email') || 'Unnamed contact'

const clientLabel = (r: Row, c: Ctx): string | null => {
  const cid = s(r, 'client_id')
  return cid ? (c.clients.get(cid)?.name ?? null) : null
}

const projectLabel = (r: Row, c: Ctx): string | null => {
  const pid = s(r, 'project_id')
  if (!pid) return null
  const p = c.projects.get(pid)
  if (!p) return null
  return p.code ? `${p.code} · ${p.name}` : p.name
}

/** Bytes as something a person reads. NULL stays blank — a file whose size was
 *  never recorded is not a zero-byte file. */
function fileSize(r: Row): string | null {
  const n = r['size_bytes']
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------
// ANALYST
// ---------------------------------------------------------------------------

const ANALYST: SearchObject[] = [
  {
    id: 'surveys',
    label: 'Surveys',
    from: 'survey_projects',
    // survey_tool_id is searched even though it is a COMMA-SEPARATED LIST of
    // ids: ilike over the whole string is exactly right for it, where an
    // equality match would miss the 22 studies that share a tool id.
    select: 'id, project_code, project_name, client, client_id, requested_by_name, survey_tool_id, board_column, status, phase, scoping_stage',
    columns: ['project_code', 'project_name', 'client', 'requested_by_name', 'survey_tool_id'],
    liveWhen: { column: 'deleted_at', is: 'null' },
    title: r => [s(r, 'project_code'), s(r, 'project_name')].filter(Boolean).join(' · ') || 'Untitled survey',
    subtitle: (r, c) => s(r, 'client') ?? clientLabel(r, c),
    href: r => `/projects/${id(r)}`,
    // stageOf, NOT the raw status. `status !== 'Open' ? status : board_column`
    // is the exact pattern that made four other surfaces label every delivered
    // survey "Closed" -- and every delivered survey IS also Closed, 328 of 328.
    tag: r => stageOf({
      status: s(r, 'status'), phase: s(r, 'phase'),
      board_column: s(r, 'board_column'), scoping_stage: s(r, 'scoping_stage'),
    }),
  },
  {
    id: 'accounts',
    label: 'Accounts',
    from: 'clients',
    select: 'id, name, code, salesperson',
    columns: ['name', 'code'],
    liveWhen: { column: 'deleted_at', is: 'null' },
    title: r => s(r, 'name') ?? 'Unnamed account',
    subtitle: r => [s(r, 'code'), s(r, 'salesperson')].filter(Boolean).join(' · ') || null,
    href: r => `/clients/${id(r)}`,
  },
  {
    id: 'contacts',
    label: 'Contacts',
    from: 'client_contacts',
    select: 'id, first_name, last_name, email, title, client_id',
    columns: ['first_name', 'last_name', 'email', 'title'],
    // client_contacts archives rather than soft-deletes (041: `archived boolean
    // not null default false`); an archived contact is deliberately out of a
    // search, same as everywhere else in the app.
    liveWhen: { column: 'archived', is: 'false' },
    joins: ['client'],
    title: personName,
    subtitle: (r, c) => [s(r, 'title'), clientLabel(r, c)].filter(Boolean).join(' · ') || s(r, 'email'),
    href: r => `/contacts/${id(r)}`,
  },
  {
    id: 'contracts',
    label: 'Contracts',
    from: 'client_terms',
    select: 'id, name, note, client_id, credits_total, starts_on, renews_on',
    columns: ['name', 'note'],
    liveWhen: { column: 'deleted_at', is: 'null' },
    joins: ['client'],
    title: r => s(r, 'name') ?? 'Unnamed contract',
    // There is no contract page, so this opens the account that holds it. Said
    // in the subtitle rather than left for the reader to discover on arrival.
    subtitle: (r, c) => clientLabel(r, c),
    href: r => (s(r, 'client_id') ? `/clients/${s(r, 'client_id')}` : null),
    tag: r => (typeof r['credits_total'] === 'number' ? `${r['credits_total']} credits` : null),
  },
  {
    id: 'files',
    label: 'Files',
    from: 'deliverables',
    select: 'id, file_name, original_file_name, project_id, client_id, mime_type, size_bytes, status',
    columns: ['file_name', 'original_file_name'],
    liveWhen: { column: 'deleted_at', is: 'null' },
    joins: ['project'],
    title: r => s(r, 'file_name') ?? s(r, 'original_file_name') ?? 'Untitled file',
    subtitle: (r, c) => [projectLabel(r, c), fileSize(r)].filter(Boolean).join(' · ') || null,
    href: r => (s(r, 'project_id') ? `/projects/${s(r, 'project_id')}` : '/deliverables'),
    // A file still in review has not been attached to anything; say so rather
    // than let it read as filed.
    tag: r => (s(r, 'status') === 'filed' ? null : s(r, 'status')),
  },
  {
    id: 'series',
    label: 'Rerun series',
    from: 'rerun_series',
    select: 'id, survey_name, client, notes, cadence_months, in_service',
    columns: ['survey_name', 'client', 'notes'],
    title: r => s(r, 'survey_name') ?? 'Unnamed series',
    subtitle: r => s(r, 'client'),
    href: r => `/reruns/series/${id(r)}`,
    tag: r => (r['in_service'] === false ? 'not in service' : null),
  },
  {
    id: 'people',
    label: 'People',
    from: 'team_members',
    select: 'id, name, initials, email',
    columns: ['name', 'initials'],
    title: r => s(r, 'name') ?? 'Unnamed',
    subtitle: r => s(r, 'initials'),
    // No person page exists, so a hit opens the list filtered to what they
    // captain — which is the question someone searching a colleague is asking.
    href: r => `/list?view=full&captain=${id(r)}`,
    tag: () => 'captain',
  },
  {
    id: 'notes',
    label: 'Account notes',
    from: 'client_notes',
    select: 'id, body, client_id, created_at, created_by',
    columns: ['body'],
    joins: ['client'],
    title: (r, c) => clientLabel(r, c) ?? 'Account note',
    subtitle: (r, _c, q) => excerpt(s(r, 'body'), q),
    href: r => (s(r, 'client_id') ? `/clients/${s(r, 'client_id')}` : null),
    tag: r => (s(r, 'created_at') ?? '').slice(0, 10) || null,
  },
  {
    id: 'activity',
    label: 'Activity & email',
    from: 'project_activity',
    select: 'id, subject, snippet, body, project_id, occurred_at, type',
    columns: ['subject', 'snippet', 'body'],
    liveWhen: { column: 'deleted_at', is: 'null' },
    joins: ['project'],
    title: (r, c) => s(r, 'subject') ?? projectLabel(r, c) ?? 'Activity',
    subtitle: (r, c, q) => {
      const where = projectLabel(r, c)
      const hit = excerpt(s(r, 'snippet') ?? s(r, 'body'), q, 90)
      return [where, hit].filter(Boolean).join(' — ') || null
    },
    href: r => (s(r, 'project_id') ? `/projects/${s(r, 'project_id')}` : null),
    tag: r => s(r, 'type'),
  },
  {
    id: 'steps',
    label: 'Next steps',
    from: 'project_steps',
    select: 'id, text, project_id, done, created_at',
    columns: ['text'],
    joins: ['project'],
    title: r => s(r, 'text') ?? 'Step',
    subtitle: (r, c) => projectLabel(r, c),
    href: r => (s(r, 'project_id') ? `/projects/${s(r, 'project_id')}` : null),
    tag: r => (r['done'] === true ? 'done' : null),
  },
]

// ---------------------------------------------------------------------------
// SALES — views only, and every href stays inside /sales.
// ---------------------------------------------------------------------------

const SALES: SearchObject[] = [
  {
    id: 'surveys',
    label: 'Surveys',
    from: 'sales_projects',
    select: 'id, project_code, project_name, client, client_id, requested_by_name, board_column, status, scoping_stage, phase',
    columns: ['project_code', 'project_name', 'client', 'requested_by_name'],
    title: r => [s(r, 'project_code'), s(r, 'project_name')].filter(Boolean).join(' · ') || 'Untitled survey',
    subtitle: r => s(r, 'client'),
    href: r => `/sales/surveys/${id(r)}`,
    tag: r => stageOf({
      status: s(r, 'status'), phase: s(r, 'phase'),
      board_column: s(r, 'board_column'), scoping_stage: s(r, 'scoping_stage'),
    }),
  },
  {
    id: 'accounts',
    label: 'Accounts',
    from: 'sales_clients',
    select: 'id, name, code',
    columns: ['name', 'code'],
    title: r => s(r, 'name') ?? 'Unnamed account',
    subtitle: r => s(r, 'code'),
    href: r => `/sales/accounts/${id(r)}`,
  },
  {
    id: 'contacts',
    label: 'Contacts',
    from: 'sales_contacts',
    select: 'id, first_name, last_name, email, title, client_id',
    columns: ['first_name', 'last_name', 'email', 'title'],
    joins: ['client'],
    title: personName,
    subtitle: (r, c) => [s(r, 'title'), clientLabel(r, c)].filter(Boolean).join(' · ') || s(r, 'email'),
    href: r => `/sales/contacts/${id(r)}`,
  },
  {
    id: 'contracts',
    label: 'Contracts',
    from: 'sales_terms',
    // No `note` column here, on purpose: 105 withholds it from the sales view,
    // so it is neither selected nor searched.
    select: 'id, name, client_id, credits_total, starts_on, renews_on',
    columns: ['name'],
    joins: ['client'],
    title: r => s(r, 'name') ?? 'Unnamed contract',
    subtitle: (r, c) => clientLabel(r, c),
    href: r => (s(r, 'client_id') ? `/sales/accounts/${s(r, 'client_id')}` : null),
    tag: r => (typeof r['credits_total'] === 'number' ? `${r['credits_total']} credits` : null),
  },
  {
    id: 'files',
    label: 'Files',
    from: 'sales_deliverables',
    select: 'id, project_id, kind, file_name, mime_type, size_bytes, filed_at',
    columns: ['file_name'],
    joins: ['project'],
    title: r => s(r, 'file_name') ?? 'Untitled file',
    subtitle: (r, c) => [projectLabel(r, c), fileSize(r)].filter(Boolean).join(' · ') || null,
    href: r => (s(r, 'project_id') ? `/sales/surveys/${s(r, 'project_id')}` : null),
  },
]

export function objectsFor(tier: Tier): SearchObject[] {
  return tier === 'sales' ? SALES : ANALYST
}

/** Where a tier's search page lives, so callers do not hard-code it twice. */
export function searchPath(tier: Tier, q: string): string {
  const base = tier === 'sales' ? '/sales/search' : '/search'
  return `${base}?q=${encodeURIComponent(q)}`
}

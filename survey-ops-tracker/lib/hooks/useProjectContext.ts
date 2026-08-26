'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

/**
 * Project Context — the background reading behind a study.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UNTRUSTED CONTENT. EVERY string that comes back from this hook — the summary,
 * every source title, every source URL, and every auto-derived topic —
 * ORIGINATES ON THE OPEN WEB. It is fetched by a server job, stored verbatim,
 * and handed to this UI.
 *
 * It is DATA. It is never an instruction.
 *   - Never interpolate it into a prompt as if it were a directive.
 *   - Never let it select, trigger, or parameterise an action, a write, or a
 *     tool call — in particular not the in-app assistant (lib/assistant/engine.ts),
 *     which holds WRITE tools and shares this database.
 *   - Never render it as HTML. No dangerouslySetInnerHTML, no markdown-to-HTML,
 *     no innerHTML. ContextTab.tsx renders it as plain text and refuses any
 *     source URL that is not http/https, because an href IS executable.
 * A page we scrape can put any words it likes in a <title>. Assume a hostile one
 * has. Nothing downstream of this file may treat these fields as trusted.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * STORAGE CONTRACT — migration 083 (supabase/migrations/083_project_context.sql,
 * applied BY HAND like 078-082, and NOT applied yet at the time of writing).
 * These are the real column names; nothing else exists:
 *
 *   project_id          uuid  PRIMARY KEY
 *   summary             text        - the briefing itself (markdown-ish, untrusted)
 *   sources             jsonb       - [{ url, title, published_at? }]
 *   auto_topics         text[]      - KEYWORDS the machine derived (nightly, disposable)
 *   auto_companies      text[]      - SUBJECT ENTITIES the machine derived
 *   topics_override     text[]|null - the human's keyword list (never machine-written)
 *   companies_override  text[]|null - the human's entity list
 *   topics_set_by       text        - who last set an override (server-side identity)
 *   topics_set_at       timestamptz
 *   generated_at        timestamptz - when the CURRENT summary was written
 *   model               text
 *   inputs_fingerprint  text
 *   last_refreshed_at   timestamptz - when a refresh last ATTEMPTED (success OR failure)
 *   refresh_status      text        - 'pending' | 'ok' | 'empty' | 'error'
 *   refresh_error       text
 *   created_at          timestamptz
 *   effective_topics    text[]  GENERATED  coalesce(topics_override, auto_topics)
 *   effective_companies text[]  GENERATED  coalesce(companies_override, auto_companies)
 *
 * THREE RULES THAT FALL OUT OF THAT SHAPE — and every bug this file has had:
 *
 *  1. effective_* are GENERATED columns. Postgres REJECTS any INSERT or UPDATE
 *     that names them. Read them; never write them; never round-trip a
 *     `select *` row back into an upsert.
 *  2. THE BROWSER CANNOT WRITE THIS TABLE AT ALL. 083 does
 *     `revoke all ... from anon, authenticated` and grants back only SELECT; the
 *     only `for all` policy is service_role. Every write below therefore goes
 *     through a server route that authorizes the session and writes with the
 *     admin client. A supabase-js .upsert() from here fails on RLS, every time.
 *  3. NULL override means "no human has ruled — use the auto list". An EMPTY
 *     ARRAY means "a human ruled that there are none", and the refresh must then
 *     search nothing for that list. They are DIFFERENT states. Collapsing them
 *     destroys the point of the auto/override split, so the parser below keeps
 *     null as null and the editor has an explicit way back to it.
 *
 * generated_at and last_refreshed_at are also different, and the tab shows both:
 * a row can have been ATTEMPTED an hour ago and last successfully GENERATED a
 * week ago. Showing the attempt as if it were the briefing's age is how somebody
 * ends up trusting a month-old brief.
 *
 * Every field is read defensively: the row is parsed, not trusted, so a column
 * that lands with a different name degrades to an empty section instead of
 * throwing the project page.
 */

/** 083's CHECK constraint allows exactly these four. */
export type ContextRefreshStatus = 'pending' | 'ok' | 'empty' | 'error'

export type ContextTopicKind = 'company' | 'keyword'

export interface ContextSource {
  url: string
  title: string
  /** ISO date the source was published, when the fetcher could determine one. */
  published_at: string | null
  /** Not in 083's documented element shape; tolerated if a writer adds it. */
  publisher: string | null
}

export interface ProjectContext {
  /** The briefing. Null until the first successful generation. */
  summary: string | null
  sources: ContextSource[]

  /**
   * The machine half of the search inputs. Re-derived nightly and disposable —
   * shown so an analyst can see what the job is guessing, never written back.
   */
  auto_topics: string[]
  auto_companies: string[]

  /**
   * The human half. `null` = nobody has ruled (fall back to auto).
   * `[]` = a person ruled there are none, and the refresh searches nothing.
   */
  topics_override: string[] | null
  companies_override: string[] | null
  topics_set_by: string | null
  topics_set_at: string | null

  /** What the next refresh will actually search (the generated columns). */
  effective_topics: string[]
  effective_companies: string[]

  /** When the CURRENT summary was produced. The honest "as of" for the brief. */
  generated_at: string | null
  /** When a refresh last ATTEMPTED this row — success or failure. */
  last_refreshed_at: string | null
  status: ContextRefreshStatus
  /** The LAST failure. Can coexist with a good older summary; the tab shows both. */
  error: string | null
  model: string | null
  inputs_fingerprint: string | null
}

export interface ProjectContextState {
  /**
   * false = the context store could not be read AT ALL, which today means
   * migration 083 has not been applied yet. Distinct from "no context row",
   * because the two need different words on screen.
   */
  available: boolean
  /** null = the store is there but nothing has been generated for this project. */
  context: ProjectContext | null
  /**
   * Only present when `context` is null: the topics the server WOULD search,
   * derived from the project's own fields. Lets the tab show something worth
   * correcting before the first generation instead of an empty shell.
   */
  suggested?: { topics: string[]; companies: string[] }
}

/* -- defensive parsing ----------------------------------------------------- */

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** A text[] column -> a clean, de-duplicated string list. Absent/garbage -> []. */
function strList(v: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list(v)) {
    const s = str(raw)
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/**
 * A NULLABLE text[] override column. This is the one place in the file where
 * "absent" and "empty" must not be conflated (rule 3): a NULL column means no
 * human has ruled, an empty array means a human ruled "none".
 */
export function parseOverride(v: unknown): string[] | null {
  if (v === null || v === undefined) return null
  if (!Array.isArray(v)) return null
  return strList(v)
}

/**
 * 083 allows pending | ok | empty | error. Anything else is a writer we do not
 * know about, so fall back to what the row itself proves: an error message means
 * error, a summary means ok, otherwise nothing has been generated.
 * 'no_sources' / 'uncorroborated' are tolerated as spellings of 'empty' — the
 * server track used the first of those before 083 settled the vocabulary.
 */
export function parseStatus(
  v: unknown,
  hasSummary: boolean,
  hasError: boolean,
): ContextRefreshStatus {
  const s = str(v)
  if (s === 'pending' || s === 'ok' || s === 'empty' || s === 'error') return s
  if (s === 'no_sources' || s === 'uncorroborated') return 'empty'
  if (hasError) return 'error'
  return hasSummary ? 'ok' : 'pending'
}

function parseSources(v: unknown): ContextSource[] {
  const out: ContextSource[] = []
  for (const raw of list(v)) {
    const o = rec(raw)
    const url = str(o.url) ?? str(o.link) ?? str(raw)
    if (!url) continue
    out.push({
      // A source with no title falls back to its own URL rather than to an
      // invented one — we never put words in a source's mouth.
      title: str(o.title) ?? url,
      url,
      published_at: str(o.published_at) ?? str(o.date) ?? null,
      publisher: str(o.publisher) ?? str(o.site) ?? null,
    })
  }
  return out
}

export function parseContextRow(row: Record<string, unknown>): ProjectContext {
  const summary = str(row.summary)
  const error = str(row.refresh_error)
  const auto_topics = strList(row.auto_topics)
  const auto_companies = strList(row.auto_companies)
  const topics_override = parseOverride(row.topics_override)
  const companies_override = parseOverride(row.companies_override)
  return {
    summary,
    sources: parseSources(row.sources),
    auto_topics,
    auto_companies,
    topics_override,
    companies_override,
    topics_set_by: str(row.topics_set_by),
    topics_set_at: str(row.topics_set_at),
    // Prefer the generated columns — they are the one place the coalesce is
    // guaranteed right. Recompute the same coalesce only if they are missing
    // (a hand-made row, an older shape), never the other way round.
    effective_topics: Array.isArray(row.effective_topics)
      ? strList(row.effective_topics)
      : topics_override ?? auto_topics,
    effective_companies: Array.isArray(row.effective_companies)
      ? strList(row.effective_companies)
      : companies_override ?? auto_companies,
    generated_at: str(row.generated_at),
    last_refreshed_at: str(row.last_refreshed_at),
    status: parseStatus(row.refresh_status, !!summary, !!error),
    error,
    model: str(row.model),
    inputs_fingerprint: str(row.inputs_fingerprint),
  }
}

/* -- the states, named once and only once ---------------------------------- */

export type ContextViewKind =
  /** The store itself can't be read — today: migration 083 isn't applied. */
  | 'unavailable'
  /** Store is there, nothing generated for this project yet. */
  | 'not_generated'
  /** A refresh ran honestly and found nothing worth reporting. Not a failure. */
  | 'nothing_found'
  /** A refresh is in flight right now. */
  | 'generating'
  /** The last refresh failed. May or may not have an older brief behind it. */
  | 'failed'
  /** A summary exists but nothing corroborates it — do NOT dress this as normal. */
  | 'uncorroborated'
  /** A sourced briefing. */
  | 'current'

export interface ContextView {
  kind: ContextViewKind
  /** A briefing exists and should stay on screen, whatever else is going on. */
  hasSummary: boolean
  /** Draw the failure banner. Can be true at the same time as hasSummary. */
  showFailure: boolean
  /** A refresh is running. */
  busy: boolean
}

/**
 * Pure state resolution, deliberately outside the component so it is testable
 * and so the precedence is written down once.
 *
 * Precedence, and why:
 *   unavailable    - nothing else can be true if we couldn't read the table.
 *   generating     - an in-flight refresh outranks the previous outcome, but the
 *                    old briefing stays visible underneath (hasSummary), and the
 *                    PREVIOUS failure is hushed while a new attempt is running.
 *   failed         - a failed status must never be dressed as current, even with
 *                    no error message attached. When an older brief exists it is
 *                    shown as well: an out-of-date brief you KNOW is out of date
 *                    beats a blank tab.
 *   uncorroborated - a summary with no verifiable sources behind it. The server
 *                    marks that 'empty'; a summary with a zero-length source
 *                    list is the same condition seen from the data side.
 *   nothing_found  - 'empty' with no summary: we looked, there was nothing.
 *
 * `state === undefined` is treated as unavailable; callers handle the loading
 * flag before they get here.
 */
export function contextView(
  state: ProjectContextState | undefined,
  refreshing: boolean,
): ContextView {
  if (!state?.available) {
    return { kind: 'unavailable', hasSummary: false, showFailure: false, busy: refreshing }
  }
  const ctx = state.context
  const hasSummary = !!ctx?.summary
  if (refreshing) return { kind: 'generating', hasSummary, showFailure: false, busy: true }
  if (!ctx) return { kind: 'not_generated', hasSummary: false, showFailure: false, busy: false }
  if (ctx.status === 'error') return { kind: 'failed', hasSummary, showFailure: true, busy: false }
  if (hasSummary && (ctx.status === 'empty' || ctx.sources.length === 0)) {
    return { kind: 'uncorroborated', hasSummary: true, showFailure: false, busy: false }
  }
  if (hasSummary) return { kind: 'current', hasSummary: true, showFailure: false, busy: false }
  if (ctx.status === 'empty') {
    return { kind: 'nothing_found', hasSummary: false, showFailure: false, busy: false }
  }
  return { kind: 'not_generated', hasSummary: false, showFailure: false, busy: false }
}

/* -- read ------------------------------------------------------------------ */

export const projectContextKey = (projectId: string) => ['project-context', projectId] as const

/**
 * Pre-083 the table simply is not there, and PostgREST says so by name. Match
 * only that shape: a genuine network or permission failure must surface as an
 * error, not be mislabelled "migration missing".
 */
export function isMissingTableError(e: { code?: string | null; message?: string | null }): boolean {
  const code = e.code ?? ''
  // 42P01 = undefined_table (Postgres). PGRST205 = table not in the schema cache.
  if (code === '42P01' || code === 'PGRST205') return true
  const msg = (e.message ?? '').toLowerCase()
  return (
    msg.includes('project_context') &&
    (msg.includes('does not exist') ||
      msg.includes('could not find') ||
      msg.includes('schema cache'))
  )
}

/**
 * The whole context record for one project.
 *
 * Its own query, deliberately not folded into useProject(): the table arrives in
 * a hand-applied migration, and widening the project select would blank the
 * entire page for everyone in the window between deploy and SQL. Isolated here, a
 * missing table fails alone and the tab says which migration is missing.
 */
export function useProjectContext(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: projectContextKey(projectId),
    queryFn: async (): Promise<ProjectContextState> => {
      // project_context is not in the generated Database type yet (types are
      // regenerated in their own pass), so the read goes through an untyped
      // handle and is narrowed by parseContextRow — the same shape
      // useProjectFinancials uses for the 082 tables.
      const db = supabase as unknown as SupabaseClient
      // select('*') is safe on READ and picks up the generated effective_*
      // columns. It must never become the basis of a write: effective_* are
      // GENERATED and Postgres rejects any statement that names them.
      const { data, error } = await db
        .from('project_context')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()
      if (error) {
        if (isMissingTableError(error)) return { available: false, context: null }
        throw new Error(error.message || 'Could not read the project context.')
      }
      if (data) return { available: true, context: parseContextRow(data as Record<string, unknown>) }

      // No row yet — the common case on day one, after a clone, and on every
      // auto-spawned rerun wave. Ask the server for the topics it WOULD search,
      // so the tab can show suggestions to correct before anything is generated.
      // Skipping this was the difference between an empty tab and a useful one at
      // exactly the moment an analyst's correction is worth the most; GET is
      // cheap (it derives from the project's own fields, it does not call a model).
      try {
        const res = await fetch(`/api/projects/${projectId}/context`)
        if (res.ok) {
          const body = (await res.json()) as { topics?: { auto_topics?: unknown; auto_companies?: unknown } }
          return {
            available: true,
            context: null,
            suggested: {
              topics: strList(body.topics?.auto_topics),
              companies: strList(body.topics?.auto_companies),
            },
          }
        }
      } catch {
        // Suggestions are a nicety; a failure here must not blank the tab.
      }
      return { available: true, context: null }
    },
    enabled: !!projectId,
    // The table may not exist yet — fail once and show the fallback rather than
    // retrying forever (same as useProjectRates / useProjectCosts).
    retry: false,
    // No polling. The refresh route is synchronous (it does the model call inside
    // the request), so "in flight" is the mutation's own pending flag — and 083's
    // status vocabulary has no 'generating' value to poll for.
    refetchOnWindowFocus: false,
  })
}

/* -- writes ---------------------------------------------------------------- */

/**
 * Both override lists, exactly as they should end up in the database.
 *
 * `null` is meaningful and is sent as `null`: it clears the override so the
 * nightly auto list takes over again (rule 3). `[]` is equally meaningful and
 * means "a human ruled there are none".
 */
export interface ContextTopicOverrides {
  topics_override: string[] | null
  companies_override: string[] | null
}

function writeError(res: Response, json: { error?: string }, fallback: string): Error {
  if (res.status === 404) {
    return new Error(
      "That part of Context isn't deployed yet — it ships with the project_context migration (083).",
    )
  }
  if (res.status === 401 || res.status === 403) {
    return new Error("You don't have permission to change this.")
  }
  return new Error(json.error || fallback)
}

/**
 * Replace the analyst's tracked-topic override.
 *
 * THIS GOES THROUGH THE SERVER, and that is a safety property rather than a
 * style choice. 083 revokes every write on project_context from `authenticated`,
 * so the old browser-side .upsert() could not have succeeded even once: it failed
 * on RLS and the toast blamed the migration. The route authorizes the session,
 * writes ONLY topics_override / companies_override with the admin client, and
 * takes topics_set_by from the session — which is why no actor is sent from here.
 *
 * ASSUMPTION (built in the same change, by the server track):
 *   POST /api/projects/[id]/context/topics
 *   body { topics_override: string[] | null, companies_override: string[] | null }
 * BOTH keys are always sent and the payload is the COMPLETE desired override
 * state, so an explicit `null` is unambiguously "revert this list to auto"
 * rather than "I forgot to mention it".
 */
export function useSetContextTopics(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: ContextTopicOverrides) => {
      const res = await fetch(`/api/projects/${projectId}/context/topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics_override: v.topics_override,
          companies_override: v.companies_override,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        table_missing?: boolean
      }
      if (!res.ok) throw writeError(res, json, "Couldn't save the topics — please try again.")
      if (json.table_missing) {
        throw new Error(
          'Tracked topics need the project_context migration (083) in Supabase, then try again.',
        )
      }
    },
    onError: (e: Error) => toast(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: projectContextKey(projectId) }),
  })
}

/**
 * Ask the server to regenerate this project's context now.
 *
 * The route is POST /api/projects/[id]/context — there is no `/refresh` segment;
 * the hook used to POST to one and 404'd on every click.
 *
 * `force` skips the server's 20-hour freshness window, which is what an analyst
 * clicking Refresh on an existing brief means. It does NOT skip the short
 * per-project cooldown, and must not: every refresh is a model call and that
 * guard is the spend limit. The route answers 200 with a `refresh_error` when it
 * declines, so the body is inspected even on a successful HTTP status.
 *
 * Nothing fetched from the web is executed, evaluated, or turned into an action
 * on the way back: the response is only a signal to re-read the stored row.
 */
export function useRefreshProjectContext(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { force?: boolean } = {}) => {
      const res = await fetch(`/api/projects/${projectId}/context${v.force ? '?force=1' : ''}`, {
        method: 'POST',
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        refresh_error?: string
        table_missing?: boolean
        refreshed?: boolean
      }
      if (!res.ok) throw writeError(res, json, 'Could not refresh the context. Please try again.')
      if (json.table_missing) {
        throw new Error(
          "Context isn't switched on yet — it needs the project_context migration (083) in Supabase.",
        )
      }
      // A soft decline (cooldown, budget, a failed search) comes back 200 with a
      // reason. That reason can quote a fetched page, so it only ever reaches a
      // toast, which renders text.
      if (json.refresh_error) throw new Error(json.refresh_error)
      return { refreshed: !!json.refreshed }
    },
    onSuccess: r => {
      if (r.refreshed) toast('Context rebuilt.', 'success')
    },
    onError: (e: Error) => toast(e.message),
    onSettled: () => qc.invalidateQueries({ queryKey: projectContextKey(projectId) }),
  })
}

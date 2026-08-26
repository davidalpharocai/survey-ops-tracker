import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isMissingTable,
  normalizeOverride,
  readProjectContext,
  resolveTopics,
  CONTEXT_PROJECT_COLUMNS,
  MAX_TOPIC_LIST,
  PROJECT_CONTEXT_TABLE,
  type ContextProject,
  type ProjectContextRow,
} from '@/lib/server/projectContext'

/* ---------------------------------------------------------------------------
 * Save the HUMAN half of the Context tab's search topics.
 *
 * WHY THIS ROUTE EXISTS AT ALL — the browser cannot write `project_context`.
 * Migration 083 does `revoke all ... from anon, authenticated` and grants back
 * only SELECT; the single `for all` policy is service_role. That is a SAFETY
 * boundary, not a style choice: every text value in that table came off the open
 * internet, and a browser-writable row that a nightly job re-reads and an
 * assistant WITH WRITE TOOLS may later be shown is a one-line injection vector.
 * So editing topics — a person's action — still goes through the server:
 * requireAnalyst() authorises, createAdminClient() writes. 081's `data_exports`
 * takes the same posture; app/api/activity/delete/route.ts is the route shape.
 *
 * `topics_set_by` COMES FROM THE SESSION, NEVER FROM THE BODY. This row records
 * who overrode what. An actor field a caller can set is a forged audit line, so
 * the body is not even read for it — it is taken from supabase.auth.getUser().
 *
 * WHAT IT WRITES: `topics_override` / `companies_override` (+ the two stamps),
 * and nothing else. Never `auto_*` (the machine's half, re-derived nightly) and
 * never `effective_*` — those are GENERATED columns and Postgres rejects any
 * statement that names them.
 *
 * NULL vs EMPTY ARRAY is preserved end to end, because they mean different
 * things (083):
 *     null / omitted / JSON null → clear the override; fall back to auto.
 *     []                         → "an analyst ruled there are NONE"; the refresh
 *                                  must then search nothing for that list.
 * Collapsing an empty array to NULL would let the auto list resurrect a list a
 * person deliberately emptied — the exact failure the auto/override split exists
 * to prevent.
 * --------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

/** Analyst-only, matching every other service-role write route in the app. */
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

/**
 * Read one override list off the request body.
 *
 * Three outcomes, deliberately distinct:
 *   undefined → the caller did not mention this list; leave the column alone.
 *   null      → clear the override (back to auto).
 *   string[]  → set it, possibly to [] meaning "there are none".
 * Anything else (a number, an object, a string) is a malformed request, not a
 * silent no-op — it comes back as 400 rather than being coerced.
 */
type OverrideInput = string[] | null | undefined

function readOverride(
  body: Record<string, unknown>,
  key: string,
): { ok: true; value: OverrideInput } | { ok: false; error: string } {
  if (!(key in body)) return { ok: true, value: undefined }
  const raw = body[key]
  if (raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw)) return { ok: false, error: `${key} must be an array of strings, or null to clear it` }
  if (raw.some((v) => typeof v !== 'string')) return { ok: false, error: `${key} must contain only strings` }
  if (raw.length > MAX_TOPIC_LIST) {
    return { ok: false, error: `${key} is limited to ${MAX_TOPIC_LIST} entries` }
  }
  // normalizeOverride trims, de-dupes and caps. An empty array in stays an empty
  // array out — that is the "a human ruled there are none" answer.
  return { ok: true, value: normalizeOverride(raw, MAX_TOPIC_LIST) ?? [] }
}

async function loadProject(admin: ReturnType<typeof createAdminClient>, projectId: string) {
  const { data, error } = await admin
    .from('survey_projects')
    .select(CONTEXT_PROJECT_COLUMNS)
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[project-context/topics] project fetch failed:', error)
    return null
  }
  return (data as unknown as ContextProject | null) ?? null
}

interface TopicsResponse {
  context: ProjectContextRow | null
  /** true until migration 083 is applied by hand — the tab shows "no context yet". */
  table_missing: boolean
  /** What the next refresh would search for, after this edit. */
  topics: ReturnType<typeof resolveTopics>
  saved: boolean
  error?: string
}

/**
 * POST { topics_override?: string[] | null, companies_override?: string[] | null }
 *
 * Sets, clears or empties the analyst's topic lists. Absent keys are untouched.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const topics = readOverride(body, 'topics_override')
  if (!topics.ok) return NextResponse.json({ error: topics.error }, { status: 400 })
  const companies = readOverride(body, 'companies_override')
  if (!companies.ok) return NextResponse.json({ error: companies.error }, { status: 400 })
  if (topics.value === undefined && companies.value === undefined) {
    return NextResponse.json(
      { error: 'Nothing to save — send topics_override and/or companies_override' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()
  const project = await loadProject(admin, id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  // ⚠️ Built explicitly, one column at a time. NEVER spread a row read with
  // select('*') into this: `effective_topics` / `effective_companies` are
  // GENERATED and Postgres rejects any write that names them.
  const patch: Record<string, unknown> = {
    project_id: id,
    // The actor is the SESSION's user, never the request body. A forgeable
    // "who changed this" field on an override table is worse than no field.
    topics_set_by: user.email ?? user.id,
    topics_set_at: new Date().toISOString(),
  }
  // `undefined` would be dropped by JSON serialisation and silently skip the
  // column, which is what we want for "not mentioned"; an explicit null must
  // survive as a null, so only defined keys are added.
  if (topics.value !== undefined) patch.topics_override = topics.value
  if (companies.value !== undefined) patch.companies_override = companies.value

  // project_context is not in the generated Database types yet (083 is applied by
  // hand, types are regenerated in their own pass), so the write goes through a
  // deliberately untyped handle — the same cast lib/server/projectContext.ts uses.
  const db = admin as unknown as SupabaseClient
  const { error } = await db.from(PROJECT_CONTEXT_TABLE).upsert(patch, { onConflict: 'project_id' })

  if (error) {
    // Migration 083 not applied yet: say so plainly instead of 500-ing on a
    // missing relation. Same tolerance as every other read/write of this table.
    if (isMissingTable(error)) {
      return NextResponse.json(
        {
          context: null,
          table_missing: true,
          topics: resolveTopics(project, null),
          saved: false,
          error:
            "The context store isn't set up yet — ask David to run the latest database migration in Supabase.",
        } satisfies TopicsResponse,
        { status: 200 },
      )
    }
    console.error('[project-context/topics] save failed:', error)
    return NextResponse.json({ error: 'Could not save the topics.' }, { status: 500 })
  }

  // Re-read so the caller sees the persisted row (including the GENERATED
  // effective_* columns, which only Postgres can compute).
  const { row, tableMissing } = await readProjectContext(admin, id)
  return NextResponse.json(
    {
      context: row,
      table_missing: tableMissing,
      topics: resolveTopics(project, row),
      saved: true,
    } satisfies TopicsResponse,
    { status: 200 },
  )
}

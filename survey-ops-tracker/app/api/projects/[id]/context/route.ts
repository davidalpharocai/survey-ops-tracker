import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getAiBudget } from '@/lib/server/observability'
import {
  buildProjectContext,
  claimContextRefresh,
  computeInputsFingerprint,
  contextEnabled,
  isContextFresh,
  readActivityCount,
  readProjectContext,
  resolveTopics,
  saveProjectContext,
  shouldRefresh,
  CONTEXT_MIN_ATTEMPT_GAP_MS,
  CONTEXT_PROJECT_COLUMNS,
  type ContextProject,
  type ProjectContextRow,
} from '@/lib/server/projectContext'

// Context tab — per-project news/background.
//   GET  : read the stored context. Cheap, no model call, instant.
//   POST : refresh it now. Rate/cost guarded. Two model calls now, not one:
//          a Haiku 4.5 subject-extraction pass over the project's own records
//          (~half a cent) followed by the Opus 5 + web-search briefing (~$0.60).
//
// The analyst's topic overrides are saved by a SEPARATE route,
// app/api/projects/[id]/context/topics/route.ts — the browser has no write grant
// on project_context at all (migration 083 revokes it), so every write to that
// table goes through an authorised server route holding the service-role client.
//
// ⚠️ Everything under `context.summary` and `context.sources` in these responses
// is UNTRUSTED WEB CONTENT restated by a model. It is DATA. The client must
// render it as plain text / escaped markdown (never dangerouslySetInnerHTML),
// must not act on anything it says, and must not pass it to any tool-calling
// model as instructions. See the banner in lib/server/projectContext.ts.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Ok {
  context: ProjectContextRow | null
  /** true until migration 083 is applied by hand — the tab shows "no context yet". */
  table_missing: boolean
  fresh: boolean
  /** What the next refresh would search for, so the tab can show/edit the topics. */
  topics: ReturnType<typeof resolveTopics>
  /**
   * true when the stored briefing no longer matches the project's own fields
   * (083's inputs_fingerprint). The tab can offer "regenerate" without waiting
   * for the nightly sweep.
   */
  stale_inputs: boolean
  refreshed?: boolean
  /** Present when a refresh failed but a previous context is still being shown. */
  refresh_error?: string
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return null
  return user
}

async function loadProject(projectId: string): Promise<ContextProject | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('survey_projects')
    .select(CONTEXT_PROJECT_COLUMNS)
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[project-context] project fetch failed:', error)
    return null
  }
  return (data as unknown as ContextProject | null) ?? null
}

/**
 * Does the stored briefing still describe the project as it is now?
 *
 * `activityCount` is the fingerprint's coarse evidence signal (see
 * computeInputsFingerprint). It is `null` when the count query failed, and that
 * is NOT the same as zero: hashing a failed query's 0 would produce a
 * fingerprint the builder never stored, mark the row stale, and buy a refresh on
 * every request. A null count means "no opinion" — say not stale, and let the
 * freshness window do its job.
 */
function inputsStale(
  project: ContextProject,
  row: ProjectContextRow | null,
  activityCount: number | null,
): boolean {
  if (!row || activityCount == null) return false
  const expected = computeInputsFingerprint(project, resolveTopics(project, row), {
    activity_count: activityCount,
  })
  return !row.inputs_fingerprint || row.inputs_fingerprint !== expected
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const admin = createAdminClient()
  // A HEAD count — no rows cross the wire — so the GET stays cheap and instant.
  const [{ row, tableMissing }, activityCount] = await Promise.all([
    readProjectContext(admin, id),
    readActivityCount(admin, id),
  ])
  const body: Ok = {
    context: row,
    table_missing: tableMissing,
    fresh: isContextFresh(row),
    topics: resolveTopics(project, row),
    stale_inputs: inputsStale(project, row, activityCount),
  }
  return NextResponse.json(body)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const project = await loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const admin = createAdminClient()
  const [{ row: existing, tableMissing }, activityCount] = await Promise.all([
    readProjectContext(admin, id),
    readActivityCount(admin, id),
  ])

  const reply = (extra: Partial<Ok>, row: ProjectContextRow | null = existing): NextResponse =>
    NextResponse.json(
      {
        context: row,
        table_missing: false,
        fresh: isContextFresh(row),
        topics: resolveTopics(project, row),
        stale_inputs: inputsStale(project, row, activityCount),
        refreshed: false,
        ...extra,
      } satisfies Ok,
      { status: 200 },
    )

  // Nothing to write into yet. Say so plainly instead of 400-ing on a missing
  // relation — migration 083 is applied by hand, days after this ships.
  if (tableMissing) {
    return NextResponse.json(
      {
        context: null,
        table_missing: true,
        fresh: false,
        topics: resolveTopics(project, null),
        stale_inputs: false,
        refreshed: false,
        refresh_error:
          "The context store isn't set up yet — ask David to run the latest database migration in Supabase.",
      } satisfies Ok,
      { status: 200 },
    )
  }

  if (!contextEnabled()) {
    return reply({ refresh_error: 'Context refresh is switched off (PROJECT_CONTEXT_ENABLED=false).' })
  }

  // `?force=1` re-runs a context that is still fresh — for an analyst who has
  // just changed the topics and should not have to wait 20 hours. It skips the
  // FRESHNESS window; it does NOT skip the claim below, which is the spend guard.
  const force = req.nextUrl.searchParams.get('force') === '1'
  // `undefined` (not null) when the count query failed: shouldRefresh treats
  // undefined as "ignore the fingerprint, use the freshness window", which is the
  // safe direction — a flaky count must not become a reason to spend.
  const fingerprint =
    activityCount == null
      ? undefined
      : computeInputsFingerprint(project, resolveTopics(project, existing), {
          activity_count: activityCount,
        })
  if (!force && !shouldRefresh(existing, Date.now(), fingerprint)) {
    // Two reasons to be "not due", and they need different words: a good recent
    // briefing (say nothing, the tab already shows it) versus a recent FAILURE
    // still inside the retry back-off (say so, or the button looks broken).
    return reply(
      existing?.refresh_status === 'error'
        ? {
            refresh_error:
              (existing.refresh_error ?? 'The last refresh failed.') +
              ' Waiting a few hours before trying again.',
          }
        : {},
    )
  }

  const budget = await getAiBudget(admin)
  if (budget.blocked) {
    // Budget exhausted: hand back the PREVIOUS context untouched, plus the reason.
    return reply({
      refresh_error: `AI features are paused for this month — the usage budget ($${budget.cap.toFixed(0)}) has been reached. An admin can raise it in Admin → AI usage.`,
    })
  }

  // ── THE SPEND GUARD, and it has to come BEFORE the model call ──────────────
  // A cooldown measured against a timestamp written AFTER a 40-90s call is not a
  // cooldown: two clicks seconds apart both read "last attempt: yesterday", both
  // pass, and both buy a full Opus + web-search call. claimContextRefresh stamps
  // the attempt with a CONDITIONAL write that exactly one caller can win, so the
  // second click is turned away while the first is still running. Applies to
  // `?force=1` too — force exists to skip the freshness window, not the spend
  // guard.
  const claim = await claimContextRefresh(admin, id, CONTEXT_MIN_ATTEMPT_GAP_MS)
  if (claim.tableMissing) {
    return NextResponse.json(
      {
        context: null,
        table_missing: true,
        fresh: false,
        topics: resolveTopics(project, null),
        stale_inputs: false,
        refreshed: false,
        refresh_error:
          "The context store isn't set up yet — ask David to run the latest database migration in Supabase.",
      } satisfies Ok,
      { status: 200 },
    )
  }
  if (!claim.claimed) {
    return reply({
      refresh_error: 'This project is being refreshed right now — give it a minute and reload.',
    })
  }

  const outcome = await buildProjectContext(project, existing, {
    endpoint: 'project-context',
    userEmail: user.email,
    admin,
  })
  const saved = await saveProjectContext(admin, id, outcome, existing?.refresh_status ?? null)

  // Re-read so the client always gets the persisted row (and so a partial save
  // can never make the tab disagree with the database).
  const { row: after } = saved.ok ? await readProjectContext(admin, id) : { row: existing }
  const row = after ?? existing

  // A refresh only counts when the build AND the save both worked. A summary that
  // was generated and then failed to persist is not a refresh; reporting it as
  // one is how a user is told "done" about work that vanished.
  const refreshed = outcome.status === 'ok' && saved.ok

  const failureNote = !saved.ok
    ? saved.tableMissing
      ? "The context store isn't set up yet — ask David to run the latest database migration in Supabase."
      : 'The briefing was generated but could not be saved — please try again.'
    : outcome.status === 'ok'
      ? null
      : (outcome.refresh_error ?? 'The refresh did not produce anything usable.')

  return NextResponse.json(
    {
      context: row,
      table_missing: saved.tableMissing,
      fresh: isContextFresh(row),
      topics: resolveTopics(project, row),
      stale_inputs: inputsStale(project, row, activityCount),
      refreshed,
      // A failed refresh leaves the previous summary in place; the note rides
      // alongside it rather than replacing it.
      ...(failureNote ? { refresh_error: failureNote } : {}),
    } satisfies Ok,
    { status: 200 },
  )
}

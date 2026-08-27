import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { getAiBudget, logSystemEvent } from '@/lib/server/observability'
import { isActiveOperational } from '@/lib/mcp/data'
import {
  buildProjectContext,
  claimContextRefresh,
  computeInputsFingerprint,
  contextEnabled,
  readActivityCounts,
  readManyProjectContexts,
  refreshSortKey,
  resolveTopics,
  saveProjectContext,
  shouldRefresh,
  CONTEXT_MIN_ATTEMPT_GAP_MS,
  CONTEXT_PROJECT_COLUMNS,
  type ContextProject,
} from '@/lib/server/projectContext'

/* ---------------------------------------------------------------------------
 * Daily Context sweep — keeps the project Context tab warm so opening it is
 * instant instead of a 40-second wait.
 *
 * SCOPE: active projects only. "Active" is the house definition, reused (not
 * re-derived) from lib/mcp/data.ts `isActiveOperational`: status Open AND phase
 * Active AND not in the Delivery ("Delivered") column. Internal, soft-deleted
 * and placeholder-wave projects are excluded, matching daily-digest and
 * searchProjects. That is ~17 projects today.
 *
 * COST: TWO model calls per project per refresh. A Haiku 4.5 subject-extraction
 * pass over the project's own records (activity, analyst notes, linked docs) at
 * about $0.005, then the Opus 5 briefing with up to 5 web searches: tokens run
 * ~$0.20-$0.50 (search results AND the project-records blob land in the context
 * window and are re-sent on each tool turn) plus $0.05 for the searches
 * themselves at $10/1,000. Call it $0.25-$0.60 per project.
 *
 * What the subject-extraction work added: ~$0.015 on a typical project and up to
 * ~$0.10 on one with a big linked doc and a chatty inbox — half a cent of Haiku,
 * and the rest the per-turn re-send of the evidence blob. See the cost note on
 * buildProjectContext in lib/server/projectContext.ts for the arithmetic; the
 * dial is MAX_EVIDENCE_CHARS there, not anything in this file. It buys a briefing
 * that searches for Novo Nordisk instead of for "Considerers".
 *
 * Both calls are logged separately through logAiUsage (endpoints
 * `project-context-cron` and `project-context-cron-extract`). That is real money,
 * so the sweep is guarded five ways:
 *   1. `shouldRefresh` skips anything still inside the freshness window
 *      (CONTEXT_FRESH_HOURS — 72h today, and THAT constant is the cadence dial,
 *      not this schedule) or unchanged since its last briefing (083's
 *      inputs_fingerprint) — so repeat runs on the same day are free,
 *   2. `claimContextRefresh` stamps the attempt BEFORE the call, so two
 *      overlapping runs (or a run plus a manual click) cannot double-spend,
 *   3. `MAX_PROJECTS_PER_RUN` + a wall-clock deadline cap a single run,
 *   4. `MAX_RUN_SPEND_USD`, a ceiling this route enforces itself, and the shared
 *      monthly AI budget IF an admin has switched `ai_hard_stop` on (it is off
 *      by default, so the shared guard alone stops nothing),
 *
 * SCHEDULE: once daily at 10:20 UTC. It was "20 9-11 * * *" (three firings),
 * which Vercel REJECTED at deployment creation — the deployment failed in the
 * same second it was created, with no build, and never appeared in the
 * dashboard at all. Every other entry in vercel.json is once-daily; match them.
 * Once daily also caps the worst case at MAX_PROJECTS_PER_RUN model calls a day
 * instead of three times that, which is the difference between ~$5 and ~$15 on
 * a bad day. If more throughput is ever needed, raise MAX_PROJECTS_PER_RUN
 * rather than adding firings.
 *   5. PROJECT_CONTEXT_ENABLED=false switches it off entirely.
 * Every call is recorded through logAiUsage inside buildProjectContext — tokens
 * AND per-search fees — so the spend shows up in Admin → AI usage like every
 * other Claude call.
 *
 * (The SCHEDULE note above is authoritative: vercel.json fires this ONCE daily.
 * An earlier three-firing schedule was rejected at deployment creation.)
 * --------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'
// 120s: the repo's proven ceiling on this plan (app/api/parse-questionnaire).
// The deadline below stops starting new work well before it.
export const maxDuration = 120

/** Hard cap on model calls per invocation, whatever the clock says. */
const MAX_PROJECTS_PER_RUN = 8
/** How many projects to research at once. Small: each call is expensive and slow,
 *  and Anthropic rate limits are shared with the assistant and ✦ Summary. */
// Four, not two. At CONCURRENCY 2 with a 25s start-deadline and a 40-70s build,
// a run finishes ~2-4 projects — so ~19 active projects took 5-10 DAYS to cycle
// while every comment, cost estimate and tooltip in the feature claimed 3. The
// cadence was fiction. Four concurrent calls still fit inside maxDuration
// because they overlap, and MAX_RUN_SPEND_USD remains the real spend ceiling.
const CONCURRENCY = 4
/**
 * Stop STARTING new projects once this much of the invocation is gone.
 *
 * 25s — and the number is DERIVED from the timeout constants in
 * lib/server/projectContext.ts, not tuned. One project's worst case is 90s:
 * DOC_FETCH_TIMEOUT_MS 5s for the linked-doc read + EXTRACT_TIMEOUT_MS 15s for
 * the Haiku subject-extraction call + BRIEFING_TIMEOUT_MS 70s for the Opus +
 * web-search briefing. maxDuration is 120s, so anything STARTED after
 * 120 - 90 = 30s can be killed by the platform mid-call — after the tokens are
 * billed, with nothing logged and nothing saved. 25s leaves a small margin.
 * Change any of those three timeouts and this number has to be re-derived.
 *
 * The honest consequence: a single invocation completes about 2-4 projects, not 8.
 * A longer deadline does not buy throughput — it buys killed calls that were paid
 * for and thrown away. MAX_PROJECTS_PER_RUN is the non-binding cap and the clock
 * is the real one. If ~19 active projects need to cycle faster than that, the
 * lever is more invocations or higher CONCURRENCY, not a deadline that outlives
 * the function.
 */
// 45s, not 25s: this only stops workers STARTING, and a build that starts at 45s
// still lands by ~115s inside maxDuration 120. Paired with CONCURRENCY 4 that is
// ~8 projects a run, which actually delivers the 3-day cycle the feature claims
// (19 projects / 8 per day = every ~2.4 days).
const DEADLINE_MS = 45_000

// A ceiling this sweep enforces ITSELF, independent of app_config.
//
// The shared monthly guard (getAiBudget) computes `blocked = hardStop && exceeded`,
// and migration 036 defaults `ai_hard_stop` to FALSE — so on a stock install
// `blocked` is false no matter what has been spent, and a runaway here would bill
// unbounded while every guard reported green. A web-search-backed Opus call runs
// ~$0.60 a project, so one bad loop is real money. This cap is dumb on purpose:
// it needs no configuration to be true.
const MAX_RUN_SPEND_USD = 6

function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  if (!contextEnabled()) {
    return Response.json({ skipped: 'PROJECT_CONTEXT_ENABLED=false', refreshed: 0 })
  }

  const startedAt = Date.now()
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('survey_projects')
    .select(CONTEXT_PROJECT_COLUMNS)
    .eq('status', 'Open')
    .eq('phase', 'Active')
    .neq('board_column', 'Delivery')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    .or('is_placeholder.is.null,is_placeholder.eq.false')
    // Only a tiebreak — the real queue order is by staleness, below.
    .order('due_date', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[cron/project-context] project query failed:', error)
    await logSystemEvent({ source: 'project-context', status: 'error', detail: 'Project query failed.' })
    return new Response('Database error', { status: 500 })
  }

  // Belt and braces: the SQL above encodes the same rule, but running every row
  // through the shared predicate means a future change to what "active" means
  // only has to land in one place.
  const active = ((data ?? []) as unknown as ContextProject[]).filter(isActiveOperational)

  const { rows: contexts, tableMissing } = await readManyProjectContexts(
    admin,
    active.map((p) => p.id),
  )
  // The fingerprint's coarse evidence signal — bucketed activity counts. HEAD
  // counts, so no rows cross the wire; ~19 of them in chunks of 8 is three round
  // trips of a few milliseconds. A project whose count failed is ABSENT from the
  // map, and the gate below then skips the fingerprint for it rather than hashing
  // a wrong value and buying a refresh it did not need.
  const activityCounts = await readActivityCounts(admin, active.map((p) => p.id))
  if (tableMissing) {
    // Migration 083 hasn't been run yet. Not an error — just nothing to do.
    await logSystemEvent({
      source: 'project-context',
      status: 'ok',
      detail: 'project_context table not created yet (migration 083 pending) — nothing to refresh.',
    })
    return Response.json({ skipped: 'table_missing', active: active.length, refreshed: 0 })
  }

  const now = Date.now()
  const due = active.filter((p) => {
    const row = contexts.get(p.id) ?? null
    // 083's inputs_fingerprint is the authoritative staleness signal: a project
    // whose name/client/audience/objective/category, analyst notes, linked
    // documents or human topic overrides have moved since its briefing was
    // written is due even inside the freshness window, and merge_projects NULLs
    // it precisely to force that.
    const count = activityCounts.get(p.id)
    const fingerprint =
      count === undefined
        ? undefined
        : computeInputsFingerprint(p, resolveTopics(p, row), { activity_count: count })
    return shouldRefresh(row, now, fingerprint)
  })

  // ── QUEUE ORDER: STALENESS, NOT DEADLINE ───────────────────────────────────
  // Ordering by due_date and truncating to MAX_PROJECTS_PER_RUN meant the same
  // early-deadline projects won every run and a project further down the list
  // could go weeks without a briefing. Ordering by last_refreshed_at with
  // never-attempted rows first — exactly what 083's
  // project_context_refresh_idx (last_refreshed_at nulls first) was built for —
  // gives every active project a turn. `due` already arrives in due_date order
  // from the query above, and Array.prototype.sort is stable, so deadline stays
  // the tiebreak between two equally stale projects.
  const queue = [...due]
    .sort((a, b) => refreshSortKey(contexts.get(a.id) ?? null) - refreshSortKey(contexts.get(b.id) ?? null))
    .slice(0, MAX_PROJECTS_PER_RUN)

  let refreshed = 0
  let empty = 0
  let failed = 0
  let saveFailed = 0
  let skippedClaimed = 0
  let costUsd = 0
  let stoppedFor: string | null = null
  let attempted = 0
  // Raw web-search error_codes across the whole sweep, counted by code.
  //
  // WHY: the run that produced three unusable briefings logged the cause
  // nowhere. `ai_usage` has no `searches` column, so even the search count was
  // only recoverable by subtracting token cost from `cost_usd` at $0.01 a search
  // — which is how "max_uses was binding on every single call" was eventually
  // established. A code per sweep is one cheap jsonb field and it makes the next
  // one of these a glance instead of an investigation.
  const searchErrors = new Map<string, number>()

  let cursor = 0
  const worker = async () => {
    for (;;) {
      if (stoppedFor) return
      const index = cursor++
      if (index >= queue.length) return
      if (Date.now() - startedAt > DEADLINE_MS) {
        stoppedFor = stoppedFor ?? 'deadline'
        return
      }
      // Re-check the budget between projects, not just once: a long sweep can
      // be what pushes the month over the cap.
      // Local ceiling first — it is the one that actually holds (see
      // MAX_RUN_SPEND_USD). The shared budget is still consulted below because
      // when it IS configured with a hard stop it is the org-wide answer.
      if (costUsd >= MAX_RUN_SPEND_USD) {
        stoppedFor = 'run_spend_cap'
        break
      }
      const budget = await getAiBudget(admin)
      if (budget.blocked) {
        stoppedFor = 'budget'
        return
      }

      const project = queue[index]

      // Stamp the attempt BEFORE spending anything. Two overlapping invocations
      // (or a run racing an analyst's manual refresh) would otherwise both buy a
      // full Opus + web-search call for the same project.
      const claim = await claimContextRefresh(admin, project.id, CONTEXT_MIN_ATTEMPT_GAP_MS)
      if (claim.tableMissing) {
        stoppedFor = 'table_missing'
        return
      }
      if (!claim.claimed) {
        skippedClaimed++
        continue
      }

      attempted++

      const priorRow = contexts.get(project.id) ?? null
      const outcome = await buildProjectContext(project, priorRow, {
        endpoint: 'project-context-cron',
        userEmail: null,
        admin,
      })
      costUsd += outcome.costUsd
      for (const code of outcome.searchErrors) {
        searchErrors.set(code, (searchErrors.get(code) ?? 0) + 1)
      }

      // Always save: a success writes the new summary, a failure only stamps the
      // attempt + error so the previous good context survives untouched.
      const saved = await saveProjectContext(admin, project.id, outcome, priorRow?.refresh_status ?? null)

      // ── COUNT WHAT ACTUALLY HAPPENED ─────────────────────────────────────
      // A build that succeeded and then failed to persist is NOT a refresh. The
      // old code incremented off outcome.status alone, so on a day when every
      // write failed the sweep spent the full Opus + web-search budget, persisted
      // nothing, and reported success.
      if (!saved.ok) {
        saveFailed++
        if (saved.tableMissing) {
          // The table vanished mid-run (or was never there). Every further call
          // is money we cannot keep — stop rather than finish the queue.
          stoppedFor = 'table_missing'
          return
        }
      } else if (outcome.status === 'ok') {
        refreshed++
      } else if (outcome.status === 'empty') {
        // Searched, and either found nothing or found nothing the briefing could
        // be tied to. A real outcome, not a failure — 083 says don't retry it.
        empty++
      } else {
        failed++
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

  const remaining = Math.max(0, due.length - attempted)
  // "max_uses_exceeded x3" — the one line that would have diagnosed this feature's
  // first bad run without any arithmetic.
  const searchErrorSummary = [...searchErrors.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${code} x${n}`)
    .join(', ')
  const detail = [
    `${refreshed} refreshed`,
    empty ? `${empty} empty/uncorroborated` : null,
    failed ? `${failed} failed` : null,
    searchErrorSummary ? `search errors: ${searchErrorSummary}` : null,
    saveFailed ? `${saveFailed} generated but NOT SAVED` : null,
    skippedClaimed ? `${skippedClaimed} already being refreshed` : null,
    `${active.length} active`,
    `${due.length} due`,
    remaining > 0 ? `${remaining} left for the next run` : null,
    `~$${costUsd.toFixed(2)} spent`,
    stoppedFor === 'budget' ? 'stopped: monthly AI budget reached' : null,
    stoppedFor === 'deadline' ? 'stopped: run deadline' : null,
    stoppedFor === 'table_missing' ? 'stopped: project_context is not writable (migration 083?)' : null,
  ]
    .filter(Boolean)
    .join(', ')

  await logSystemEvent({
    source: 'project-context',
    // A save failure is the loudest thing that can happen here — money spent,
    // nothing kept — so it counts as an error, not a partial.
    status:
      saveFailed > 0 || stoppedFor === 'table_missing'
        ? 'error'
        : failed > 0 || stoppedFor === 'budget'
          ? 'partial'
          : 'ok',
    detail,
    meta: {
      active: active.length,
      due: due.length,
      attempted,
      refreshed,
      empty,
      failed,
      save_failed: saveFailed,
      skipped_claimed: skippedClaimed,
      remaining,
      cost_usd: costUsd,
      stopped_for: stoppedFor,
      search_errors: Object.fromEntries(searchErrors),
    },
  })

  // Always 200 so Vercel Cron doesn't retry and double-spend.
  return Response.json({
    active: active.length,
    due: due.length,
    attempted,
    refreshed,
    empty,
    failed,
    save_failed: saveFailed,
    skipped_claimed: skippedClaimed,
    remaining,
    cost_usd: Number(costUsd.toFixed(4)),
    stopped_for: stoppedFor,
  })
}

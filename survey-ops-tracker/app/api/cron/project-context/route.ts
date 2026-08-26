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
 * COST: one Opus 5 call with up to 5 web searches per project per day. Tokens run
 * ~$0.20-$0.50 (search results land in the context window and are re-sent on each
 * tool turn) plus $0.05 for the searches themselves at $10/1,000 — call it
 * $0.25-$0.55 per project, so roughly $4-$9/day and $130-$280/month at 17 active
 * projects. That is real money, so the sweep is guarded five ways:
 *   1. `shouldRefresh` skips anything already fresh (<20h) or unchanged since its
 *      last briefing (083's inputs_fingerprint) — repeat runs are free,
 *   2. `claimContextRefresh` stamps the attempt BEFORE the call, so two
 *      overlapping runs (or a run plus a manual click) cannot double-spend,
 *   3. `MAX_PROJECTS_PER_RUN` + a wall-clock deadline cap a single run,
 *   4. `MAX_RUN_SPEND_USD`, a ceiling this route enforces itself, and the shared
 *      monthly AI budget IF an admin has switched `ai_hard_stop` on (it is off
 *      by default, so the shared guard alone stops nothing),
 *   5. PROJECT_CONTEXT_ENABLED=false switches it off entirely.
 * Every call is recorded through logAiUsage inside buildProjectContext — tokens
 * AND per-search fees — so the spend shows up in Admin → AI usage like every
 * other Claude call.
 *
 * SCHEDULING: vercel.json runs this at 09:20 / 10:20 / 11:20 UTC
 * ("20 9-11 * * *"). One 120s invocation cannot cover 17 projects, so it runs
 * three times and the freshness gate makes the repeats free; all three finish
 * before the 12:00 daily digest.
 * --------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'
// 120s: the repo's proven ceiling on this plan (app/api/parse-questionnaire).
// The deadline below stops starting new work well before it.
export const maxDuration = 120

/** Hard cap on model calls per invocation, whatever the clock says. */
const MAX_PROJECTS_PER_RUN = 8
/** How many projects to research at once. Small: each call is expensive and slow,
 *  and Anthropic rate limits are shared with the assistant and ✦ Summary. */
const CONCURRENCY = 2
/** Stop STARTING new projects this many ms before maxDuration expires. */
const DEADLINE_MS = 95_000

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
    // whose name/client/audience/objective/category or topic lists have moved
    // since its briefing was written is due even inside the freshness window, and
    // merge_projects NULLs it precisely to force that.
    const fingerprint = computeInputsFingerprint(p, resolveTopics(p, row))
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
      })
      costUsd += outcome.costUsd

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
  const detail = [
    `${refreshed} refreshed`,
    empty ? `${empty} empty/uncorroborated` : null,
    failed ? `${failed} failed` : null,
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

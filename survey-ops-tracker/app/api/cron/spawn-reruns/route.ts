import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { nextRerunName } from '@/lib/utils/rerun'
import { selectDueSeries, isLegacyEligible, addDaysISO } from '@/lib/reruns/spawn'
import { spawnWaveForSeries, QUIET_SPAWN_SKIP_REASONS } from '@/lib/reruns/spawnSeries'
import { renumberLegacyLineage } from '@/lib/reruns/renumberLineage'
import { copyProjectPricing } from '@/lib/server/clone'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily (see vercel.json). Spawns the next wave for every rerun_series that's
// due (the first-class model, migration 073) AND, for un-migrated data, every
// legacy `longitudinal` project whose `rerun_date` is within a week. The copy
// lands in Submitted for the captain to review; setup carries over, run-data
// resets, numbered + linked as a series. Idempotent: a series' unique
// `(series_id, rerun_number)` DB index is the hard backstop against duplicate
// waves; the query-time checks below are the fast path that skips a re-run
// without needing to hit that constraint. See
// docs/superpowers/plans/2026-08-10-rerun-update.md Task 4 + review-hardening
// addendum, spec §8/§18.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

const LEAD_DAYS = 7

type SeriesStatusRow = Database['public']['Views']['rerun_series_status']['Row']

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  const spawned: string[] = []
  const errors: string[] = []
  let seriesChecked = 0
  let legacyChecked = 0
  // Waves that landed unpriced because project_financials wasn't there to read
  // (082 pending). Counted, not errored — see the copy site below.
  let pricingUnavailable = 0

  // -------------------------------------------------------------------------
  // Series path (migration 073): the first-class model.
  // -------------------------------------------------------------------------
  const horizonSeries = addDaysISO(todayISO, LEAD_DAYS)
  const { data: seriesRaw, error: seriesQueryErr } = await supabase
    .from('rerun_series_status')
    .select('*')
    .eq('service_mode', 'auto')
    .eq('auto_armed', true)
    .eq('paused', false)
    .eq('in_service', true)
    .not('effective_next', 'is', null)
    .lte('effective_next', horizonSeries)

  if (seriesQueryErr) {
    errors.push(`series query: ${seriesQueryErr.message}`)
  } else {
    // The SQL filters above are a performance narrowing; selectDueSeries is
    // the actual (unit-tested) gate applied to what we spawn from.
    const dueSeries = selectDueSeries(seriesRaw ?? [], todayISO, LEAD_DAYS)
    seriesChecked = dueSeries.length

    for (const series of dueSeries as SeriesStatusRow[]) {
      try {
        // spawnWaveForSeries re-applies its own (unit-tested) idempotency
        // guard, builds the wave via nextWaveInherit, resolves a captain,
        // copies child rows, and advances next_wave_no — the exact same path
        // the manual "spawn_next" action on /api/reruns/series calls.
        const result = await spawnWaveForSeries(supabase, series.id)
        if (result.created) {
          spawned.push(result.waveName ?? series.survey_name)
        } else if (result.reason && !QUIET_SPAWN_SKIP_REASONS.has(result.reason)) {
          errors.push(`${series.client} — ${series.survey_name}: ${result.reason}`)
        }
        // else: quiet skip (already spawned / no prior wave / lost a race) — not an error.
      } catch (err) {
        errors.push(`${series.client} — ${series.survey_name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Legacy path: un-migrated `longitudinal` projects (no series_id). A row
  // that has been seeded into a series must NEVER also spawn here — that's
  // the `series_id is null` filter (SQL) + `isLegacyEligible` (re-applied
  // client-side as the authoritative, unit-tested gate) below.
  // -------------------------------------------------------------------------
  const horizonLegacy = new Date(Date.now() + LEAD_DAYS * 86400_000).toISOString().split('T')[0]
  const todayLegacy = new Date().toISOString().split('T')[0]

  const { data: due, error } = await supabase
    .from('survey_projects')
    .select(
      // n_target_max rides along with n_target: since migration 078 the target is
      // a RANGE and n_target is only its FLOOR, so copying the floor alone would
      // hand every spawned wave a silently-reset ceiling. Safe to name here —
      // 078 is applied. price_per_n is deliberately NOT in this list: 082 is not,
      // and PostgREST fails the WHOLE request over one unknown column, which
      // would take the entire nightly spawn down. It is read separately below.
      'id, project_name, client, captain_id, co_captain_ids, salesperson, n_target, n_target_max, audience_size, linked_documents, voter_survey_qa, citation_language_needed, row_level_data, compliance_override, rerun_number, rerun_series_id, series_id, rerun_date, rerun_spawned_at, longitudinal, status, board_column'
    )
    .eq('longitudinal', true)
    .not('rerun_date', 'is', null)
    .lte('rerun_date', horizonLegacy)
    .is('rerun_spawned_at', null)
    .is('series_id', null)
    .is('deleted_at', null)
    // Skip genuinely-abandoned (Closed) projects, BUT include delivered waves —
    // which are now Closed too (migration 064: delivered ⇒ archived). A delivered
    // wave hitting its rerun_date is exactly when the next wave should spawn, so
    // "Closed AND in the Delivery stage" must still qualify.
    .or('status.neq.Closed,board_column.eq.Delivery')
    // A Cancelled wave (client pulled the plug) satisfies status.neq.Closed, so
    // exclude it explicitly — a cancelled longitudinal must never spawn a next wave.
    .neq('status', 'Cancelled')

  if (error) {
    errors.push(`legacy query: ${error.message}`)
  } else {
    const legacyDue = (due ?? []).filter((p) =>
      isLegacyEligible(
        {
          longitudinal: p.longitudinal,
          rerun_date: p.rerun_date,
          rerun_spawned_at: p.rerun_spawned_at,
          series_id: p.series_id,
          status: p.status,
          board_column: p.board_column,
        },
        todayLegacy,
        LEAD_DAYS
      )
    )
    legacyChecked = legacyDue.length

    for (const p of legacyDue) {
      const nextNum = (p.rerun_number ?? 1) + 1
      const name = nextRerunName(p.project_name, nextNum)
      const copy = {
        project_name: name,
        client: p.client,
        project_type: 'Rerun' as const,
        phase: 'Active' as const,
        status: 'Open' as const,
        board_column: 'Submitted' as const,
        captain_id: p.captain_id,
        co_captain_ids: p.co_captain_ids,
        salesperson: p.salesperson,
        // Both ends of the range in the SAME insert — 078's
        // enforce_n_target_range trigger only sees the fields a write carries,
        // so the pair must never be split across two statements.
        n_target: p.n_target,
        n_target_max: p.n_target_max,
        n_collected: 0,
        n_actual: null,
        audience_size: p.audience_size,
        longitudinal: true,
        voter_survey_qa: p.voter_survey_qa,
        citation_language_needed: p.citation_language_needed,
        row_level_data: p.row_level_data,
        compliance_override: p.compliance_override,
        linked_documents: p.linked_documents,
        stage_doc_programming: false,
        stage_survey_programming: false,
        stage_edwin_qa: false,
        stage_fielding: false,
        stage_data_qa: false,
        stage_delivery: false,
        submitted_date: todayLegacy,
        rerun_number: nextNum,
        rerun_series_id: p.rerun_series_id ?? p.id,
      }
      // Capture the new wave's id so a failed source-stamp below can roll it back.
      const { data: inserted, error: insErr } = await supabase
        .from('survey_projects')
        .insert(copy)
        .select('id')
        .single()
      if (insErr || !inserted) {
        errors.push(`${p.project_name}: ${insErr?.message ?? 'insert returned no row'}`)
        continue
      }
      // Stamp the source so it never re-spawns this wave. If that UPDATE fails we
      // must NOT leave the source eligible — the legacy lineage has no unique
      // backstop, so the next cron run would insert a DUPLICATE next wave. Roll
      // back by soft-deleting the wave we just inserted (recoverable from Admin)
      // and skip this source; a later run can retry cleanly.
      const { error: stampErr } = await supabase
        .from('survey_projects')
        .update({ rerun_spawned_at: new Date().toISOString() })
        .eq('id', p.id)
      if (stampErr) {
        const { error: rbErr } = await supabase
          .from('survey_projects')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', inserted.id)
        errors.push(
          `stamp ${p.project_name}: ${stampErr.message}` +
          (rbErr ? ` (rollback of inserted wave ALSO failed: ${rbErr.message})` : ' — rolled back the inserted wave')
        )
        continue
      }
      // Carry the client rate onto the new wave. A rerun is the same study for
      // the same client at the same price, and a wave with no rate reads as $0
      // revenue in every margin figure — worse than blank, because $0 looks like
      // a number somebody agreed to. Isolated + non-fatal on purpose: migration
      // 082 is applied by hand, so 'unavailable' is the expected answer until it
      // lands, and a missing price must never cost us the wave itself. Recorded
      // as a note, not an error — nothing is broken, the wave is just unpriced.
      const pricing = await copyProjectPricing(supabase, p.id, inserted.id, 'system')
      if (pricing === 'unavailable') pricingUnavailable++

      // Renumber the whole lineage by chronological position so the new wave
      // takes its true number and any pre-existing gap (legacy naive max+1)
      // self-heals — never the "1,3,4" drift this used to produce.
      try {
        await renumberLegacyLineage(supabase, p.rerun_series_id ?? p.id)
      } catch (renumErr) {
        errors.push(`renumber ${p.project_name}: ${renumErr instanceof Error ? renumErr.message : String(renumErr)}`)
      }
      spawned.push(name)
    }
  }

  await logSystemEvent({
    source: 'spawn-reruns',
    status: errors.length ? 'partial' : 'ok',
    detail: spawned.length ? `Spawned ${spawned.length} rerun(s): ${spawned.join(', ')}` : 'No reruns due.',
    meta: { spawned, errors, seriesChecked, legacyChecked, pricingUnavailable },
  })

  return Response.json(
    { checked: seriesChecked + legacyChecked, spawned, errors },
    { status: errors.length ? 207 : 200 }
  )
}

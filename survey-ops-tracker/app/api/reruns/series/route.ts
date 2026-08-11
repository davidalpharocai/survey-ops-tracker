import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renumberWaves, type Wave } from '@/lib/reruns/series'
import { spawnWaveForSeries } from '@/lib/reruns/spawnSeries'
import { baseRerunName } from '@/lib/utils/rerun'
import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import type { TablesInsert, TablesUpdate } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

// Write endpoints for the rerun_series record (migration 073): create (promote
// a project to Wave 1), edit scalar fields, edit future-wave defaults,
// pause/resume/end/reactivate the lifecycle, manually spawn the next wave,
// arm/disarm auto-spawn, and drag-reorder waves. Analyst-gated, admin client,
// mirrors the requireAnalyst + renumber pattern in
// app/api/projects/link-rerun/route.ts. See
// docs/superpowers/plans/2026-08-10-rerun-update.md Task 6 + addendum.

async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

type Admin = ReturnType<typeof createAdminClient>

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

function defaultRerunCaptainEmail(): string {
  return process.env.RERUN_CAPTAIN_EMAIL ?? 'sreerag@alpharoc.ai'
}

/** Every live wave belonging to a series, ordered by wave number — the shape
 * `renumberWaves` needs plus display fields for the API response. */
async function fetchWaves(admin: Admin, seriesId: string) {
  const { data, error } = await admin
    .from('survey_projects')
    .select(
      'id, project_code, project_name, rerun_number, wave_order, submitted_date, launch_date, deliver_date, due_date, delivered_at, n_target, n_collected, n_actual, status, board_column, created_at, rerun_spawned_at'
    )
    .eq('series_id', seriesId)
    .is('deleted_at', null)
    .order('rerun_number', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

type PendingWave = {
  id: string
  project_code: string | null
  project_name: string
  rerun_number: number
  board_column: string
} | null

/** A wave counts as "pending" (spawned but not yet fielded) when: it's the
 * latest live wave in the series, AND the wave immediately before it has
 * `rerun_spawned_at` set — proving the latest wave is a genuine product of a
 * spawn (auto or manual), not just Wave 1 sitting untouched — AND its stage
 * is still before Fielding. Used by pause/end to offer cancel-or-leave. */
async function findPendingWave(admin: Admin, seriesId: string): Promise<PendingWave> {
  const { data, error } = await admin
    .from('survey_projects')
    .select('id, project_code, project_name, rerun_number, board_column, rerun_spawned_at')
    .eq('series_id', seriesId)
    .is('deleted_at', null)
    .order('rerun_number', { ascending: false })
    .limit(2)
  if (error) throw new Error(error.message)
  const [latest, prev] = data ?? []
  if (!latest || !prev) return null // need an origin + at least one spawned successor
  if (!prev.rerun_spawned_at) return null // latest wasn't produced by a spawn
  const fieldingIdx = STAGE_ORDER.indexOf('Fielding')
  const latestIdx = STAGE_ORDER.indexOf(latest.board_column as BoardColumn)
  if (latestIdx >= fieldingIdx) return null // already fielding or past it
  return {
    id: latest.id,
    project_code: latest.project_code,
    project_name: latest.project_name,
    rerun_number: latest.rerun_number,
    board_column: latest.board_column,
  }
}

/** Soft-cancel a wave via the same field set the project page's "cancel"
 * action uses (status → Cancelled, reason + timestamp) — never a delete. */
async function cancelWave(admin: Admin, waveId: string): Promise<void> {
  await admin
    .from('survey_projects')
    .update({
      status: 'Cancelled',
      cancel_reason: 'Rerun series paused/ended — pending wave cancelled before it started fielding.',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', waveId)
}

async function applyRenumber(admin: Admin, seriesId: string, originId: string): Promise<void> {
  const { data, error } = await admin
    .from('survey_projects')
    .select('id, rerun_number, wave_order, submitted_date, launch_date, deliver_date, created_at')
    .eq('series_id', seriesId)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)
  const waves = (data ?? []) as Wave[]
  const renumbered = renumberWaves(waves, originId)
  for (const w of renumbered) {
    await admin.from('survey_projects').update({ rerun_number: w.rerun_number }).eq('id', w.id)
  }
}

const UPDATE_FIELD_WHITELIST = [
  'cadence_months',
  'delivery_cadence',
  'service_mode',
  'template_id',
  'owner_email',
  'base_type',
  'survey_name',
  'notes',
  'data_qa_note',
  'anchor_date',
] as const

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const action = typeof body.action === 'string' ? body.action : ''
  const actor = user.email ?? 'unknown'
  const admin = createAdminClient()

  try {
    switch (action) {
      // -----------------------------------------------------------------
      case 'create': {
        const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
        const baseType = typeof body.base_type === 'string' ? body.base_type : ''
        if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
        if (baseType !== 'B2B' && baseType !== 'PS') {
          return NextResponse.json({ error: "base_type must be 'B2B' or 'PS'." }, { status: 400 })
        }

        const { data: project, error: projErr } = await admin
          .from('survey_projects')
          .select('id, client, client_id, project_name, captain_id, rerun_series_id, rerun_number')
          .eq('id', projectId)
          .is('deleted_at', null)
          .maybeSingle()
        if (projErr) return NextResponse.json({ error: projErr.message }, { status: 500 })
        if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

        const futureDefaultsIn = (body.future_defaults ?? {}) as Record<string, unknown>
        const insert: TablesInsert<'rerun_series'> = {
          client_id: project.client_id,
          client: project.client,
          survey_name: baseRerunName(project.project_name),
          base_type: baseType,
          origin_project_id: projectId,
          cadence_months: typeof body.cadence_months === 'number' ? body.cadence_months : null,
          delivery_cadence: typeof body.delivery_cadence === 'string' ? body.delivery_cadence : null,
          service_mode: typeof body.service_mode === 'string' ? body.service_mode : 'auto',
          template_id: typeof body.template_id === 'string' ? body.template_id : null,
          owner_email: defaultRerunCaptainEmail(),
          auto_armed: true,
          future_defaults: {
            ...futureDefaultsIn,
            // The original (wave-1) captain is seeded into co_captain_ids ONCE
            // at promotion, then carried verbatim to every future wave (§8/§10
            // of the design spec) — never re-derived, so history never
            // degrades to "the rerun captain is her own co-captain".
            co_captain_ids: project.captain_id ? [project.captain_id] : (futureDefaultsIn.co_captain_ids ?? []),
          } as unknown as TablesInsert<'rerun_series'>['future_defaults'],
          updated_by: actor,
        }
        const { data: newSeries, error: insErr } = await admin
          .from('rerun_series')
          .insert(insert)
          .select('*')
          .single()
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

        // Migrate the whole legacy lineage (if this project already had one)
        // into the new first-class series, so the record isn't just Wave 1
        // and the first auto-spawn doesn't collide with legacy numbering.
        const legacyRoot = project.rerun_series_id ?? project.id
        const { data: family, error: familyErr } = await admin
          .from('survey_projects')
          .select('id')
          .or(`id.eq.${legacyRoot},rerun_series_id.eq.${legacyRoot}`)
          .is('deleted_at', null)
        if (familyErr) return NextResponse.json({ error: familyErr.message }, { status: 500 })
        const familyIds = (family ?? []).map((f) => f.id)
        if (familyIds.length > 0) {
          const { error: linkErr } = await admin
            .from('survey_projects')
            .update({ series_id: newSeries.id })
            .in('id', familyIds)
          if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })
        }

        // The promoted project is always Wave 1, regardless of where it falls
        // chronologically among any legacy siblings swept in above.
        await applyRenumber(admin, newSeries.id, projectId)

        const waves = await fetchWaves(admin, newSeries.id)
        const maxNum = waves.reduce((m, w) => Math.max(m, w.rerun_number), 0)
        const { data: finalSeries, error: bumpErr } = await admin
          .from('rerun_series')
          .update({ next_wave_no: maxNum + 1 })
          .eq('id', newSeries.id)
          .select('*')
          .single()
        if (bumpErr) return NextResponse.json({ error: bumpErr.message }, { status: 500 })

        return NextResponse.json({ series: finalSeries, waves })
      }

      // -----------------------------------------------------------------
      case 'update': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const fields = (body.fields ?? {}) as Record<string, unknown>
        const patch: TablesUpdate<'rerun_series'> = {}
        for (const key of UPDATE_FIELD_WHITELIST) {
          if (key in fields) (patch as Record<string, unknown>)[key] = fields[key]
        }
        if ('base_type' in patch && patch.base_type !== 'B2B' && patch.base_type !== 'PS') {
          return NextResponse.json({ error: "base_type must be 'B2B' or 'PS'." }, { status: 400 })
        }
        patch.updated_by = actor
        patch.updated_at = new Date().toISOString()
        const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series: data })
      }

      // -----------------------------------------------------------------
      case 'set_defaults': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const { data, error } = await admin
          .from('rerun_series')
          .update({
            future_defaults: (body.future_defaults ?? {}) as TablesUpdate<'rerun_series'>['future_defaults'],
            updated_by: actor,
            updated_at: new Date().toISOString(),
          })
          .eq('id', seriesId)
          .select('*')
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series: data })
      }

      // -----------------------------------------------------------------
      case 'pause':
      case 'end': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const pendingWave = await findPendingWave(admin, seriesId)

        // A dry run only reports whether a pending wave exists, so the UI can
        // ask "cancel it or leave it?" before committing to pause/end.
        if (body.dryRun === true) {
          return NextResponse.json({ pendingWave })
        }

        if (body.cancelPending === true && pendingWave) {
          await cancelWave(admin, pendingWave.id)
        }

        const patch: TablesUpdate<'rerun_series'> =
          action === 'pause'
            ? { paused: true, updated_by: actor, updated_at: new Date().toISOString() }
            : { in_service: false, updated_by: actor, updated_at: new Date().toISOString() }
        const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series: data, pendingWave })
      }

      // -----------------------------------------------------------------
      case 'resume':
      case 'reactivate': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        // resume_anchor rebases effective_next off today (ET), so a
        // resumed/re-activated series isn't instantly overdue.
        const patch: TablesUpdate<'rerun_series'> =
          action === 'resume'
            ? { paused: false, resume_anchor: todayET(), updated_by: actor, updated_at: new Date().toISOString() }
            : { in_service: true, resume_anchor: todayET(), updated_by: actor, updated_at: new Date().toISOString() }
        const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series: data })
      }

      // -----------------------------------------------------------------
      case 'spawn_next': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const spawn = await spawnWaveForSeries(admin, seriesId)
        // A manual spawn is the "first wave" review action — it arms auto-spawn
        // going forward (spec §18: seeded/fresh series start unarmed until a
        // human reviews and creates the first wave by hand).
        const { data: series, error } = await admin
          .from('rerun_series')
          .update({ auto_armed: true, updated_by: actor, updated_at: new Date().toISOString() })
          .eq('id', seriesId)
          .select('*')
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series, spawn })
      }

      // -----------------------------------------------------------------
      case 'arm': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const { data, error } = await admin
          .from('rerun_series')
          .update({ auto_armed: body.armed === true, updated_by: actor, updated_at: new Date().toISOString() })
          .eq('id', seriesId)
          .select('*')
          .single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ series: data })
      }

      // -----------------------------------------------------------------
      case 'reorder': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        const orderedWaveIds = Array.isArray(body.orderedWaveIds) ? (body.orderedWaveIds as unknown[]).filter((v): v is string => typeof v === 'string') : []
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        if (orderedWaveIds.length === 0) return NextResponse.json({ error: 'orderedWaveIds is required.' }, { status: 400 })

        // Guard against a caller sneaking in an id from another series.
        const { data: existing, error: exErr } = await admin
          .from('survey_projects')
          .select('id')
          .eq('series_id', seriesId)
          .is('deleted_at', null)
        if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
        const validIds = new Set((existing ?? []).map((r) => r.id))
        const safeOrder = orderedWaveIds.filter((id) => validIds.has(id))

        for (let i = 0; i < safeOrder.length; i++) {
          await admin.from('survey_projects').update({ wave_order: i }).eq('id', safeOrder[i])
        }
        // Every wave now has an explicit wave_order, so renumberWaves' date-based
        // fallback (which forces a specific originId first) never engages here.
        await applyRenumber(admin, seriesId, safeOrder[0] ?? seriesId)
        await admin.from('rerun_series').update({ updated_by: actor, updated_at: new Date().toISOString() }).eq('id', seriesId)

        const waves = await fetchWaves(admin, seriesId)
        return NextResponse.json({ waves })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action || '(none)'}` }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 500 })
  }
}

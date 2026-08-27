import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  SeriesOpError,
  createSeriesFromProject,
  updateSeriesFields,
  setSeriesDefaults,
  pauseSeries,
  endSeries,
  resumeSeries,
  reactivateSeries,
  spawnNextWave,
  armSeries,
  reorderWaves,
  attachProjectToSeries,
  detachProjectFromSeries,
} from '@/lib/reruns/seriesOps'

export const dynamic = 'force-dynamic'

// Write endpoints for the rerun_series record (migration 073): create (promote
// a project to Wave 1), edit scalar fields, edit future-wave defaults,
// pause/resume/end/reactivate the lifecycle, manually spawn the next wave,
// arm/disarm auto-spawn, and drag-reorder waves. Analyst-gated, admin client.
// The actual DB operations live in lib/reruns/seriesOps.ts so the MCP connector
// + in-app assistant run the exact same logic; this route validates the body
// and delegates, preserving its response shapes + status codes. See
// docs/superpowers/plans/2026-08-10-rerun-update.md Task 6 + addendum + Task 8.

async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

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
        const { series, waves } = await createSeriesFromProject(
          admin,
          {
            projectId,
            base_type: baseType,
            cadence_months: typeof body.cadence_months === 'number' ? body.cadence_months : null,
            delivery_cadence: typeof body.delivery_cadence === 'string' ? body.delivery_cadence : null,
            service_mode: typeof body.service_mode === 'string' ? body.service_mode : undefined,
            template_id: typeof body.template_id === 'string' ? body.template_id : null,
            future_defaults: (body.future_defaults ?? {}) as Record<string, unknown>,
          },
          actor
        )
        return NextResponse.json({ series, waves })
      }

      // -----------------------------------------------------------------
      case 'update': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const fields = (body.fields ?? {}) as Record<string, unknown>
        const { series } = await updateSeriesFields(admin, seriesId, fields, actor)
        return NextResponse.json({ series })
      }

      // -----------------------------------------------------------------
      case 'set_defaults': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const { series } = await setSeriesDefaults(
          admin,
          seriesId,
          (body.future_defaults ?? {}) as Record<string, unknown>,
          actor
        )
        return NextResponse.json({ series })
      }

      // -----------------------------------------------------------------
      case 'pause':
      case 'end': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const opts = { dryRun: body.dryRun === true, cancelPending: body.cancelPending === true }
        const run = action === 'pause' ? pauseSeries : endSeries
        const { series, pendingWave } = await run(admin, seriesId, opts, actor)
        // A dry run only reports whether a pending wave exists (no write, no
        // series row) so the UI can ask "cancel it or leave it?" first.
        if (opts.dryRun) return NextResponse.json({ pendingWave })
        return NextResponse.json({ series, pendingWave })
      }

      // -----------------------------------------------------------------
      case 'resume':
      case 'reactivate': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const run = action === 'resume' ? resumeSeries : reactivateSeries
        const { series } = await run(admin, seriesId, actor)
        return NextResponse.json({ series })
      }

      // -----------------------------------------------------------------
      case 'spawn_next': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const { series, spawn } = await spawnNextWave(admin, seriesId, actor)
        return NextResponse.json({ series, spawn })
      }

      // -----------------------------------------------------------------
      case 'arm': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        const { series } = await armSeries(admin, seriesId, body.armed === true, actor)
        return NextResponse.json({ series })
      }

      // -----------------------------------------------------------------
      case 'reorder': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        const orderedWaveIds = Array.isArray(body.orderedWaveIds)
          ? (body.orderedWaveIds as unknown[]).filter((v): v is string => typeof v === 'string')
          : []
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        if (orderedWaveIds.length === 0) return NextResponse.json({ error: 'orderedWaveIds is required.' }, { status: 400 })
        const { waves } = await reorderWaves(admin, seriesId, orderedWaveIds, actor)
        return NextResponse.json({ waves })
      }

      // Add an EXISTING survey to an existing series, and take one out again.
      // Before these, series_id could only be set by promoting a project to a
      // NEW series or by the auto-spawn cron — a hand-created wave, or one whose
      // link a merge had dropped, could only be fixed with SQL (which is what
      // BAM's PR00388 needed). seriesOps refuses rather than guesses when the
      // survey is already in another series or belongs to another client, and
      // those messages are written to be read by a person, so they pass through
      // verbatim via SeriesOpError below.
      case 'attach_wave': {
        const seriesId = typeof body.seriesId === 'string' ? body.seriesId : ''
        const projectId = typeof body.projectId === 'string' ? body.projectId : ''
        if (!seriesId) return NextResponse.json({ error: 'seriesId is required.' }, { status: 400 })
        if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
        // `attached` names every survey that actually moved — attaching sweeps
        // the survey's legacy lineage family, so this can be more than the one
        // the caller asked about, and the UI has to be able to say so.
        const { series, waves, attached } = await attachProjectToSeries(admin, seriesId, projectId, actor)
        return NextResponse.json({ series, waves, attached })
      }

      case 'detach_wave': {
        const projectId = typeof body.projectId === 'string' ? body.projectId : ''
        if (!projectId) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 })
        const { seriesId, waves } = await detachProjectFromSeries(admin, projectId, actor)
        return NextResponse.json({ seriesId, waves })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action || '(none)'}` }, { status: 400 })
    }
  } catch (e) {
    // Validation/not-found failures carry their own status; everything else
    // (DB errors) is a 500, matching the route's original behavior.
    if (e instanceof SeriesOpError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 500 })
  }
}

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { renumberWaves, type Wave } from './series'
import { spawnWaveForSeries, type SpawnWaveResult } from './spawnSeries'
import { baseRerunName } from '@/lib/utils/rerun'
import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import type { Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/types'

// DB-operation layer for the first-class rerun_series model (migration 073).
// Each function takes an admin client and returns plain data (never a
// NextResponse) so BOTH the write route (app/api/reruns/series/route.ts) and
// the MCP connector / in-app assistant (lib/mcp/registry.ts) run ONE copy of
// the lifecycle logic. The logic here is byte-for-byte what used to live inline
// in the route's switch branches; the route now validates its body and
// delegates, preserving its exact response shapes and status codes. See
// docs/superpowers/plans/2026-08-10-rerun-update.md Task 6/8.

export type Admin = ReturnType<typeof createAdminClient>
type SeriesRow = Tables<'rerun_series'>

/** A validation/not-found failure that maps to a specific HTTP status when
 * surfaced by the route (DB errors are plain Errors → 500). */
export class SeriesOpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'SeriesOpError'
    this.status = status
  }
}

function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export function defaultRerunCaptainEmail(): string {
  return process.env.RERUN_CAPTAIN_EMAIL ?? 'sreerag@alpharoc.ai'
}

/** Cadence keyword → cadence_months for the series model. 'adhoc' → null (no
 * cadence). Pure so the MCP put_in_rerun_service tool and any UI can share the
 * mapping and unit-test it. */
export function cadenceToMonths(
  cadence: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'adhoc'
): number | null {
  switch (cadence) {
    case 'monthly': return 1
    case 'quarterly': return 3
    case 'semiannual': return 6
    case 'yearly': return 12
    case 'adhoc': return null
  }
}

export const UPDATE_FIELD_WHITELIST = [
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

/** Every live wave belonging to a series, ordered by wave number — the shape
 * `renumberWaves` needs plus display fields for API/tool responses. */
export async function fetchWaves(admin: Admin, seriesId: string) {
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

export type PendingWave = {
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
export async function findPendingWave(admin: Admin, seriesId: string): Promise<PendingWave> {
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
export async function cancelWave(admin: Admin, waveId: string): Promise<void> {
  await admin
    .from('survey_projects')
    .update({
      status: 'Cancelled',
      cancel_reason: 'Rerun series paused/ended — pending wave cancelled before it started fielding.',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', waveId)
}

export async function applyRenumber(admin: Admin, seriesId: string, originId: string): Promise<void> {
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

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export interface CreateSeriesParams {
  projectId: string
  base_type: string // 'B2B' | 'PS' (validated here + by callers)
  cadence_months?: number | null
  service_mode?: string
  delivery_cadence?: string | null
  template_id?: string | null
  future_defaults?: Record<string, unknown>
}

/** Promote a project to Wave 1 of a new first-class rerun series: insert the
 * series row, sweep any legacy lineage (`id.eq.<root> OR rerun_series_id.eq.<root>`)
 * into series_id, force the promoted project to Wave 1 via renumber, then set
 * next_wave_no = max wave + 1. Returns the final series row + its waves. */
export async function createSeriesFromProject(
  admin: Admin,
  params: CreateSeriesParams,
  actor: string
): Promise<{ series: SeriesRow; waves: Awaited<ReturnType<typeof fetchWaves>> }> {
  const baseType = params.base_type
  if (baseType !== 'B2B' && baseType !== 'PS') {
    throw new SeriesOpError("base_type must be 'B2B' or 'PS'.", 400)
  }

  const { data: project, error: projErr } = await admin
    .from('survey_projects')
    .select('id, client, client_id, project_name, captain_id, rerun_series_id, rerun_number')
    .eq('id', params.projectId)
    .is('deleted_at', null)
    .maybeSingle()
  if (projErr) throw new Error(projErr.message)
  if (!project) throw new SeriesOpError('Project not found.', 404)

  const futureDefaultsIn = (params.future_defaults ?? {}) as Record<string, unknown>
  const insert: TablesInsert<'rerun_series'> = {
    client_id: project.client_id,
    client: project.client,
    survey_name: baseRerunName(project.project_name),
    base_type: baseType,
    origin_project_id: params.projectId,
    cadence_months: typeof params.cadence_months === 'number' ? params.cadence_months : null,
    delivery_cadence: typeof params.delivery_cadence === 'string' ? params.delivery_cadence : null,
    service_mode: typeof params.service_mode === 'string' ? params.service_mode : 'auto',
    template_id: typeof params.template_id === 'string' ? params.template_id : null,
    owner_email: defaultRerunCaptainEmail(),
    auto_armed: true,
    future_defaults: {
      ...futureDefaultsIn,
      // The original (wave-1) captain is seeded into co_captain_ids ONCE at
      // promotion, then carried verbatim to every future wave (§8/§10 of the
      // design spec) — never re-derived, so history never degrades to "the
      // rerun captain is her own co-captain".
      co_captain_ids: project.captain_id ? [project.captain_id] : (futureDefaultsIn.co_captain_ids ?? []),
    } as unknown as TablesInsert<'rerun_series'>['future_defaults'],
    updated_by: actor,
  }
  const { data: newSeries, error: insErr } = await admin
    .from('rerun_series')
    .insert(insert)
    .select('*')
    .single()
  if (insErr) throw new Error(insErr.message)

  // Migrate the whole legacy lineage (if this project already had one) into the
  // new first-class series, so the record isn't just Wave 1 and the first
  // auto-spawn doesn't collide with legacy numbering.
  const legacyRoot = project.rerun_series_id ?? project.id
  const { data: family, error: familyErr } = await admin
    .from('survey_projects')
    .select('id')
    .or(`id.eq.${legacyRoot},rerun_series_id.eq.${legacyRoot}`)
    .is('deleted_at', null)
  if (familyErr) throw new Error(familyErr.message)
  const familyIds = (family ?? []).map((f) => f.id)
  if (familyIds.length > 0) {
    const { error: linkErr } = await admin
      .from('survey_projects')
      .update({ series_id: newSeries.id })
      .in('id', familyIds)
    if (linkErr) throw new Error(linkErr.message)
  }

  // The promoted project is always Wave 1, regardless of where it falls
  // chronologically among any legacy siblings swept in above.
  await applyRenumber(admin, newSeries.id, params.projectId)

  const waves = await fetchWaves(admin, newSeries.id)
  const maxNum = waves.reduce((m, w) => Math.max(m, w.rerun_number), 0)
  const { data: finalSeries, error: bumpErr } = await admin
    .from('rerun_series')
    .update({ next_wave_no: maxNum + 1 })
    .eq('id', newSeries.id)
    .select('*')
    .single()
  if (bumpErr) throw new Error(bumpErr.message)

  return { series: finalSeries, waves }
}

// ---------------------------------------------------------------------------
// update (scalar fields)
// ---------------------------------------------------------------------------

/** Filter caller-supplied fields down to the whitelist + validate base_type.
 * Pure (no DB) so it's unit-testable. */
export function pickSeriesUpdatePatch(
  fields: Record<string, unknown>
): { patch: TablesUpdate<'rerun_series'> } | { error: string } {
  const patch: TablesUpdate<'rerun_series'> = {}
  for (const key of UPDATE_FIELD_WHITELIST) {
    if (key in fields) (patch as Record<string, unknown>)[key] = fields[key]
  }
  // Allow base_type null: a migration-074 "Rerun Service" series has no base
  // type, and editing it (owner, cadence, notes, …) must not be blocked just
  // because base_type stays null. Setting it to PS/B2B still reclassifies it.
  if ('base_type' in patch && patch.base_type != null && patch.base_type !== 'B2B' && patch.base_type !== 'PS') {
    return { error: "base_type must be 'B2B', 'PS', or null." }
  }
  return { patch }
}

export async function updateSeriesFields(
  admin: Admin,
  seriesId: string,
  fields: Record<string, unknown>,
  actor: string
): Promise<{ series: SeriesRow }> {
  const picked = pickSeriesUpdatePatch(fields)
  if ('error' in picked) throw new SeriesOpError(picked.error, 400)
  const patch = picked.patch
  patch.updated_by = actor
  patch.updated_at = new Date().toISOString()
  const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
  if (error) throw new Error(error.message)
  return { series: data }
}

// ---------------------------------------------------------------------------
// set_defaults (overwrite future_defaults jsonb)
// ---------------------------------------------------------------------------

export async function setSeriesDefaults(
  admin: Admin,
  seriesId: string,
  future_defaults: Record<string, unknown>,
  actor: string
): Promise<{ series: SeriesRow }> {
  const { data, error } = await admin
    .from('rerun_series')
    .update({
      future_defaults: (future_defaults ?? {}) as TablesUpdate<'rerun_series'>['future_defaults'],
      updated_by: actor,
      updated_at: new Date().toISOString(),
    })
    .eq('id', seriesId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { series: data }
}

// ---------------------------------------------------------------------------
// pause / end
// ---------------------------------------------------------------------------

export interface PauseEndOpts {
  dryRun?: boolean
  cancelPending?: boolean
}

async function setLifecycle(
  admin: Admin,
  seriesId: string,
  mode: 'pause' | 'end',
  opts: PauseEndOpts,
  actor: string
): Promise<{ series: SeriesRow | null; pendingWave: PendingWave }> {
  const pendingWave = await findPendingWave(admin, seriesId)

  // A dry run only reports whether a pending wave exists, so a UI/assistant can
  // ask "cancel it or leave it?" before committing to pause/end.
  if (opts.dryRun === true) return { series: null, pendingWave }

  if (opts.cancelPending === true && pendingWave) {
    await cancelWave(admin, pendingWave.id)
  }

  const patch: TablesUpdate<'rerun_series'> =
    mode === 'pause'
      ? { paused: true, updated_by: actor, updated_at: new Date().toISOString() }
      : { in_service: false, updated_by: actor, updated_at: new Date().toISOString() }
  const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
  if (error) throw new Error(error.message)
  return { series: data, pendingWave }
}

export function pauseSeries(admin: Admin, seriesId: string, opts: PauseEndOpts, actor: string) {
  return setLifecycle(admin, seriesId, 'pause', opts, actor)
}

export function endSeries(admin: Admin, seriesId: string, opts: PauseEndOpts, actor: string) {
  return setLifecycle(admin, seriesId, 'end', opts, actor)
}

// ---------------------------------------------------------------------------
// resume / reactivate
// ---------------------------------------------------------------------------

async function setResume(
  admin: Admin,
  seriesId: string,
  mode: 'resume' | 'reactivate',
  actor: string
): Promise<{ series: SeriesRow }> {
  // resume_anchor rebases effective_next off today (ET), so a resumed/
  // re-activated series isn't instantly overdue.
  const patch: TablesUpdate<'rerun_series'> =
    mode === 'resume'
      ? { paused: false, resume_anchor: todayET(), updated_by: actor, updated_at: new Date().toISOString() }
      : { in_service: true, resume_anchor: todayET(), updated_by: actor, updated_at: new Date().toISOString() }
  const { data, error } = await admin.from('rerun_series').update(patch).eq('id', seriesId).select('*').single()
  if (error) throw new Error(error.message)
  return { series: data }
}

export function resumeSeries(admin: Admin, seriesId: string, actor: string) {
  return setResume(admin, seriesId, 'resume', actor)
}

export function reactivateSeries(admin: Admin, seriesId: string, actor: string) {
  return setResume(admin, seriesId, 'reactivate', actor)
}

// ---------------------------------------------------------------------------
// spawn_next / arm / reorder
// ---------------------------------------------------------------------------

/** Manually spawn the series' next wave and arm auto-spawn going forward (a
 * manual spawn is the "first wave" review action — spec §18: seeded/fresh
 * series start unarmed until a human creates the first wave by hand). */
export async function spawnNextWave(
  admin: Admin,
  seriesId: string,
  actor: string
): Promise<{ series: SeriesRow; spawn: SpawnWaveResult }> {
  const spawn = await spawnWaveForSeries(admin, seriesId)
  const { data: series, error } = await admin
    .from('rerun_series')
    .update({ auto_armed: true, updated_by: actor, updated_at: new Date().toISOString() })
    .eq('id', seriesId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { series, spawn }
}

export async function armSeries(
  admin: Admin,
  seriesId: string,
  armed: boolean,
  actor: string
): Promise<{ series: SeriesRow }> {
  const { data, error } = await admin
    .from('rerun_series')
    .update({ auto_armed: armed, updated_by: actor, updated_at: new Date().toISOString() })
    .eq('id', seriesId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { series: data }
}

export async function reorderWaves(
  admin: Admin,
  seriesId: string,
  orderedWaveIds: string[],
  actor: string
): Promise<{ waves: Awaited<ReturnType<typeof fetchWaves>> }> {
  // Guard against a caller sneaking in an id from another series.
  const { data: existing, error: exErr } = await admin
    .from('survey_projects')
    .select('id')
    .eq('series_id', seriesId)
    .is('deleted_at', null)
  if (exErr) throw new Error(exErr.message)
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
  return { waves }
}

// ---------------------------------------------------------------------------
// attach / detach — put an existing survey into a series, or take it out
// ---------------------------------------------------------------------------
//
// The gap these close: before this, `series_id` was written in exactly TWO
// places — createSeriesFromProject (promoting a project to Wave 1 of a NEW
// series, which sweeps its legacy family in) and the auto-spawn cron. There was
// no way to put an EXISTING survey into an EXISTING series, so a wave created by
// hand, or one whose link was lost, could only be fixed with SQL. That is
// exactly what happened to BAM's PR00388.
//
// Why this lives here rather than in a migration: the numbering rule
// (renumberWaves in lib/reruns/series.ts) is subtle — a manual `wave_order`
// beats dates once ANY wave has one, the date key falls back
// submitted → launch → deliver → created, and the origin is forced to Wave 1
// when no manual order exists. A second copy of that rule in SQL would drift
// from this one. So attach/detach reuse applyRenumber, exactly like
// reorderWaves does.

/** Put an existing survey into an existing series, then renumber the series.
 *
 * Refuses rather than guesses in the two cases where guessing would be
 * destructive: a survey already in a DIFFERENT series (moving it implicitly is
 * how a wave ends up silently re-homed) and a survey belonging to a different
 * client than the series. Attaching one already in THIS series is a no-op, so a
 * double-click or a retried request is harmless. */
export async function attachProjectToSeries(
  admin: Admin,
  seriesId: string,
  projectId: string,
  actor: string
): Promise<{ series: SeriesRow; waves: Awaited<ReturnType<typeof fetchWaves>> }> {
  const { data: series, error: sErr } = await admin
    .from('rerun_series')
    .select('*')
    .eq('id', seriesId)
    .maybeSingle()
  if (sErr) throw new Error(sErr.message)
  if (!series) throw new SeriesOpError('Series not found.', 404)

  const { data: project, error: pErr } = await admin
    .from('survey_projects')
    .select('id, project_code, project_name, client, client_id, series_id')
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle()
  if (pErr) throw new Error(pErr.message)
  if (!project) throw new SeriesOpError('Survey not found.', 404)

  const label = project.project_code ?? project.project_name

  // Idempotent: already where it should be.
  if (project.series_id === seriesId) {
    return { series: series as SeriesRow, waves: await fetchWaves(admin, seriesId) }
  }

  // Moving a survey between series is a different, riskier operation than adding
  // an unattached one. Make the caller remove it first, deliberately.
  if (project.series_id) {
    throw new SeriesOpError(
      `${label} is already in another series. Remove it from that one first, then add it here.`,
      409
    )
  }

  // A series belongs to a client; a wave from a different client is almost always
  // a mis-click, and the cost of being wrong is a survey appearing under someone
  // else's account.
  if (series.client_id && project.client_id && series.client_id !== project.client_id) {
    throw new SeriesOpError(
      `${label} belongs to ${project.client ?? 'another client'}, but this series is ${series.client ?? 'a different client'}. Move the survey to the right client first.`,
      409
    )
  }

  // Set BOTH halves of the wiring. This is the whole lesson of the PR00388 bug:
  // `series_id` is the first-class FK the client page groups on, while
  // `rerun_series_id` is the legacy lineage pointer holding the FIRST WAVE'S
  // PROJECT ID, which the project page's wave list reads. Filling one and not the
  // other is what makes a survey look grouped on one screen and loose on another.
  // The origin wave keeps a NULL lineage pointer — by convention its own id IS
  // the root (see app/api/projects/link-rerun/route.ts).
  //
  // `wave_order` is deliberately left untouched: renumberWaves sorts a wave with
  // no explicit order after every ordered one, which is the documented
  // "newly-added waves append at the end" behaviour.
  const { error: upErr } = await admin
    .from('survey_projects')
    .update({
      series_id: seriesId,
      rerun_series_id: projectId === series.origin_project_id ? null : series.origin_project_id,
    })
    .eq('id', projectId)
  if (upErr) throw new Error(upErr.message)

  await applyRenumber(admin, seriesId, series.origin_project_id ?? projectId)

  const waves = await fetchWaves(admin, seriesId)
  const maxNum = waves.reduce((m, w) => Math.max(m, w.rerun_number), 0)
  const { data: finalSeries, error: bumpErr } = await admin
    .from('rerun_series')
    .update({ next_wave_no: maxNum + 1, updated_by: actor, updated_at: new Date().toISOString() })
    .eq('id', seriesId)
    .select('*')
    .single()
  if (bumpErr) throw new Error(bumpErr.message)

  return { series: finalSeries, waves }
}

/** Take a survey out of its series and renumber what is left.
 *
 * Clears the first-class link, the legacy lineage pointer and any manual order,
 * and resets the wave number to 1, so the survey becomes genuinely standalone
 * rather than half-attached — half-attached being the exact state this whole area
 * keeps ending up in. Every changed value lands in project_audit (migration 088),
 * so an accidental removal is recoverable from the history. */
export async function detachProjectFromSeries(
  admin: Admin,
  projectId: string,
  actor: string
): Promise<{ seriesId: string; waves: Awaited<ReturnType<typeof fetchWaves>> }> {
  const { data: project, error: pErr } = await admin
    .from('survey_projects')
    .select('id, project_code, project_name, series_id')
    .eq('id', projectId)
    .is('deleted_at', null)
    .maybeSingle()
  if (pErr) throw new Error(pErr.message)
  if (!project) throw new SeriesOpError('Survey not found.', 404)

  const label = project.project_code ?? project.project_name
  const seriesId = project.series_id
  if (!seriesId) throw new SeriesOpError(`${label} is not in a series.`, 400)

  const { data: series, error: sErr } = await admin
    .from('rerun_series')
    .select('id, origin_project_id')
    .eq('id', seriesId)
    .maybeSingle()
  if (sErr) throw new Error(sErr.message)

  // Wave 1 is the series anchor: rerun_series.origin_project_id points at it and
  // renumberWaves forces it first. Removing it would leave the series pointing at
  // a survey no longer in it — legal, but confusing, and not something this
  // function can repair. End the series, or add a replacement first.
  if (series?.origin_project_id === projectId) {
    throw new SeriesOpError(
      `${label} is Wave 1 — the series is anchored to it. Add another survey to the series first, or end the series instead.`,
      409
    )
  }

  // rerun_number goes back to 1, NOT null: migration 040 declares it
  // `integer not null default 1`, so a null here is a not-null violation and the
  // whole detach 500s. 1 is also the right value semantically — it is what every
  // standalone project has, and what Wave 1 of a series has. series_id,
  // rerun_series_id and wave_order ARE nullable and are genuinely cleared.
  const { error: upErr } = await admin
    .from('survey_projects')
    .update({ series_id: null, rerun_series_id: null, rerun_number: 1, wave_order: null })
    .eq('id', projectId)
  if (upErr) throw new Error(upErr.message)

  // Renumber what remains, so the surviving waves are 1..N with no gap.
  await applyRenumber(admin, seriesId, series?.origin_project_id ?? seriesId)

  const waves = await fetchWaves(admin, seriesId)
  const maxNum = waves.reduce((m, w) => Math.max(m, w.rerun_number), 0)
  const { error: bumpErr } = await admin
    .from('rerun_series')
    .update({ next_wave_no: maxNum + 1, updated_by: actor, updated_at: new Date().toISOString() })
    .eq('id', seriesId)
  if (bumpErr) throw new Error(bumpErr.message)

  return { seriesId, waves }
}

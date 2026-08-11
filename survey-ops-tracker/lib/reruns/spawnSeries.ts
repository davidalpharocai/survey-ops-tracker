import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, TablesInsert } from '@/lib/supabase/types'
import { canSpawnNextWave } from './spawn'
import { nextWaveInherit, type PrevWaveForInherit } from './series'
import { copySupplierLaunches, copyProjectBlasts, copyProjectSegments } from '@/lib/server/clone'

// DB-touching orchestration for spawning a series' next wave — the ONE place
// that builds + inserts a wave row, shared by the daily auto-spawn cron
// (app/api/cron/spawn-reruns/route.ts) and the manual "spawn_next" action on
// app/api/reruns/series/route.ts, so the two paths can never drift. Kept out
// of lib/reruns/spawn.ts on purpose — that file is pure/DB-free (unit-tested
// without a database); this one does real reads/writes and composes it with
// the pure decision logic there plus the pure field-inheritance in series.ts.
// See docs/superpowers/plans/2026-08-10-rerun-update.md Task 4/6 + addendum.

type Admin = ReturnType<typeof createAdminClient>
type WaveRow = Pick<
  Database['public']['Tables']['survey_projects']['Row'],
  'id' | 'project_name' | 'rerun_number' | 'rerun_date' | 'launch_date' | 'due_date' | 'deliver_date' | 'captain_id' | 'rerun_spawned_at'
>

export interface SpawnWaveResult {
  created: boolean
  waveId?: string
  waveName?: string
  reason?: string
}

/** Resolve the default rerun captain (Sree by default, configurable via env)
 * by email, falling back to initials 'SC' if the email lookup misses. Mirrors
 * the identically-named helper the cron used to keep inline. */
export async function resolveRerunCaptainId(admin: Admin): Promise<string | null> {
  const email = process.env.RERUN_CAPTAIN_EMAIL ?? 'sreerag@alpharoc.ai'
  const { data: byEmail } = await admin.from('team_members').select('id').eq('email', email).maybeSingle()
  if (byEmail) return byEmail.id
  const { data: byInitials } = await admin.from('team_members').select('id').eq('initials', 'SC').maybeSingle()
  return byInitials?.id ?? null
}

/** Skip reasons that mean "nothing to do" (idempotency guard tripped, or lost
 * a race to another caller) — never surfaced as an error by callers. Everything
 * else returned in `reason` (a query failure, missing series, etc.) is a real
 * error the caller should log. */
export const QUIET_SPAWN_SKIP_REASONS: ReadonlySet<string> = new Set([
  'no-prev-wave',
  'wave-exists',
  'prev-already-spawned',
  'already spawned',
])

/**
 * Spawn the next wave for a `rerun_series`, if one is due: loads the series +
 * its latest live wave, re-applies the same idempotency guard the cron's
 * selection query already narrowed on (`canSpawnNextWave`), builds the new
 * wave via `nextWaveInherit`, resolves a captain when the series has none
 * configured, inserts it, copies child rows (suppliers/blasts/segments) from
 * the prior wave, stamps the prior wave's `rerun_spawned_at`, and advances
 * `next_wave_no`. A 23505 (unique `(series_id, rerun_number)`) from a raced
 * insert is treated as an idempotent no-op, not an error.
 */
export async function spawnWaveForSeries(admin: Admin, seriesId: string): Promise<SpawnWaveResult> {
  const { data: series, error: seriesErr } = await admin
    .from('rerun_series')
    .select('*')
    .eq('id', seriesId)
    .maybeSingle()
  if (seriesErr) return { created: false, reason: seriesErr.message }
  if (!series) return { created: false, reason: 'series not found' }

  const { data: waves, error: wavesErr } = await admin
    .from('survey_projects')
    .select('id, project_name, rerun_number, rerun_date, launch_date, due_date, deliver_date, captain_id, rerun_spawned_at')
    .eq('series_id', seriesId)
    .is('deleted_at', null)
    .order('rerun_number', { ascending: false })
  if (wavesErr) return { created: false, reason: wavesErr.message }

  const liveWaves = (waves ?? []) as WaveRow[]
  const prevWave = liveWaves[0] as WaveRow | undefined
  const decision = canSpawnNextWave({
    hasPrevWave: prevWave != null,
    existingWaveNumbers: liveWaves.map((w) => w.rerun_number),
    nextWaveNo: series.next_wave_no,
    prevWaveSpawnedAt: prevWave?.rerun_spawned_at ?? null,
  })
  if (!decision.spawn || !prevWave) return { created: false, reason: decision.reason ?? 'no-prev-wave' }

  const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const prevWaveForInherit: PrevWaveForInherit = {
    project_name: prevWave.project_name,
    rerun_date: prevWave.rerun_date,
    launch_date: prevWave.launch_date,
    due_date: prevWave.due_date,
    deliver_date: prevWave.deliver_date,
    captain_id: prevWave.captain_id,
  }
  const inherited = nextWaveInherit(series, prevWaveForInherit, todayISO)
  if (inherited.captain_id == null) {
    inherited.captain_id = await resolveRerunCaptainId(admin)
  }

  const { data: newWave, error: insErr } = await admin
    .from('survey_projects')
    .insert(inherited as unknown as TablesInsert<'survey_projects'>)
    .select('id, project_name')
    .single()

  if (insErr) {
    // 23505 = unique_violation on (series_id, rerun_number): another process
    // already spawned this exact wave number — idempotent no-op, not an error.
    if (insErr.code === '23505') return { created: false, reason: 'already spawned' }
    return { created: false, reason: insErr.message }
  }
  if (!newWave) return { created: false, reason: 'insert returned no row' }

  // Copy child rows so the new wave's Money section + segments land populated
  // like the prior wave, run-data zeroed.
  await copySupplierLaunches(admin, prevWave.id, newWave.id, 'system')
  await copyProjectBlasts(admin, prevWave.id, newWave.id, 'system')
  await copyProjectSegments(admin, prevWave.id, newWave.id)

  // Stamp the prior wave so it never spawns a second successor, and advance
  // the series' next wave number.
  await admin.from('survey_projects').update({ rerun_spawned_at: new Date().toISOString() }).eq('id', prevWave.id)
  await admin.from('rerun_series').update({ next_wave_no: series.next_wave_no + 1 }).eq('id', seriesId)

  return { created: true, waveId: newWave.id, waveName: newWave.project_name }
}

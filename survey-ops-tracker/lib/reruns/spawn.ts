// Pure, DB-free decision logic for the daily rerun auto-spawn cron
// (app/api/cron/spawn-reruns/route.ts). Kept separate from the route so the
// selection/idempotency rules are unit-testable without a live database, and
// so the route applies the exact same predicates it's tested against (not a
// hand-mirrored copy that can drift). Composes with lib/reruns/series.ts
// (effectiveNext/nextWaveInherit), which does the scalar wave-inheritance
// math. See docs/superpowers/plans/2026-08-10-rerun-update.md Task 4 +
// review-hardening addendum; spec §8/§18.

const DAY_MS = 86_400_000

/** Shift a YYYY-MM-DD date by n days (UTC-anchored; safe for date-only string
 * comparisons — never construct a Date from a bare date-only string for
 * anything but this kind of arithmetic, or local-TZ parsing bugs creep in). */
export function addDaysISO(isoDate: string, n: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Series-path selection: which rerun_series rows are due to auto-spawn today.
// ---------------------------------------------------------------------------

export interface SeriesDueInput {
  service_mode: string
  auto_armed: boolean
  paused: boolean
  in_service: boolean
  effective_next: string | null
}

/** True when a series should auto-spawn its next wave today. Mirrors the
 * `rerun_series_status` view's own flags so the cron and the read model never
 * disagree: auto mode, armed, not paused, in service, and due within the
 * lead window. */
export function isSeriesDueForSpawn(series: SeriesDueInput, todayISO: string, leadDays: number): boolean {
  if (series.service_mode !== 'auto') return false
  if (!series.auto_armed) return false
  if (series.paused) return false
  if (!series.in_service) return false
  if (!series.effective_next) return false
  return series.effective_next <= addDaysISO(todayISO, leadDays)
}

/** Filter a batch of series-status rows down to the ones due for auto-spawn.
 * The route also applies this narrowing as a SQL WHERE clause for query
 * efficiency, but re-applies this function client-side as the authoritative
 * gate — the SQL filter is a performance optimization, not a second source
 * of truth. */
export function selectDueSeries<T extends SeriesDueInput>(rows: T[], todayISO: string, leadDays: number): T[] {
  return rows.filter((r) => isSeriesDueForSpawn(r, todayISO, leadDays))
}

// ---------------------------------------------------------------------------
// Series-path idempotency: never create a duplicate wave.
// ---------------------------------------------------------------------------

export interface SpawnDecisionInput {
  /** rerun_number of every live (deleted_at is null) wave in this series. */
  existingWaveNumbers: number[]
  /** rerun_series.next_wave_no — the wave number about to be assigned. */
  nextWaveNo: number
  /** The latest existing wave's rerun_spawned_at, or null if it hasn't
   * spawned its successor yet. */
  prevWaveSpawnedAt: string | null
  /** False if no live wave could be found at all for this series (should not
   * happen for a real series, since promotion always creates wave 1, but a
   * defensive guard against spawning off nothing). */
  hasPrevWave: boolean
}

export type SpawnSkipReason = 'no-prev-wave' | 'wave-exists' | 'prev-already-spawned'

export interface SpawnDecision {
  spawn: boolean
  reason?: SpawnSkipReason
}

/** The idempotency gate: decides whether a series' next wave should be
 * created. Two independent guards, either of which blocks a spawn:
 *   1. A live wave already exists at `next_wave_no` (the query-time check;
 *      the DB's `unique (series_id, rerun_number) where deleted_at is null`
 *      partial index is the hard backstop for a race between two overlapping
 *      cron runs — an insert that loses that race comes back as a Postgres
 *      23505 and must be treated as "already spawned", not an error).
 *   2. The prior wave has already recorded `rerun_spawned_at` — it has
 *      already produced (or attempted to produce) a successor, so spawning
 *      again would duplicate work even if, for some reason, the wave-number
 *      check above didn't already catch it. */
export function canSpawnNextWave(input: SpawnDecisionInput): SpawnDecision {
  if (!input.hasPrevWave) return { spawn: false, reason: 'no-prev-wave' }
  if (input.existingWaveNumbers.includes(input.nextWaveNo)) return { spawn: false, reason: 'wave-exists' }
  if (input.prevWaveSpawnedAt != null) return { spawn: false, reason: 'prev-already-spawned' }
  return { spawn: true }
}

// ---------------------------------------------------------------------------
// Legacy path exclusion: a row owned by a series must never also spawn via
// the old `longitudinal` flag path.
// ---------------------------------------------------------------------------

export interface LegacyRowInput {
  longitudinal: boolean
  rerun_date: string | null
  rerun_spawned_at: string | null
  series_id: string | null
  status: string
  board_column: string
}

/** True when a `survey_projects` row should spawn via the legacy
 * `longitudinal=true` + `rerun_date` path. A row that has been migrated into
 * a rerun_series (series_id set) is excluded unconditionally — even if it's
 * also `longitudinal=true` and its `rerun_date` is due — because the series
 * path now owns it exclusively (spec §18: a row that's both must spawn
 * exactly once, via the series path). Otherwise mirrors the existing SQL
 * predicate: due within the lead window, not yet spawned, not Cancelled, and
 * not Closed unless it's sitting in Delivery (a delivered wave hitting its
 * rerun_date is exactly when the next wave should spawn). */
export function isLegacyEligible(row: LegacyRowInput, todayISO: string, leadDays: number): boolean {
  if (!row.longitudinal) return false
  if (row.series_id != null) return false
  if (row.rerun_spawned_at != null) return false
  if (!row.rerun_date) return false
  if (row.rerun_date > addDaysISO(todayISO, leadDays)) return false
  if (row.status === 'Cancelled') return false
  if (row.status === 'Closed' && row.board_column !== 'Delivery') return false
  return true
}

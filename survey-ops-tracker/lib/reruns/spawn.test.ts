import { describe, it, expect } from 'vitest'
import { addDaysISO, isSeriesDueForSpawn, selectDueSeries, canSpawnNextWave, isLegacyEligible } from './spawn'

describe('addDaysISO', () => {
  it('shifts a date-only string forward by n days', () => {
    expect(addDaysISO('2026-08-10', 7)).toBe('2026-08-17')
  })

  it('rolls over month/year boundaries', () => {
    expect(addDaysISO('2026-12-28', 7)).toBe('2027-01-04')
  })

  it('n=0 returns the same date', () => {
    expect(addDaysISO('2026-08-10', 0)).toBe('2026-08-10')
  })
})

// ---------------------------------------------------------------------------
// isSeriesDueForSpawn / selectDueSeries
// ---------------------------------------------------------------------------
describe('isSeriesDueForSpawn', () => {
  const base = {
    service_mode: 'auto',
    auto_armed: true,
    paused: false,
    in_service: true,
    effective_next: '2026-08-12' as string | null,
  }
  const today = '2026-08-10'
  const leadDays = 7

  it('is due when auto, armed, not paused, in service, and within the lead window', () => {
    expect(isSeriesDueForSpawn(base, today, leadDays)).toBe(true)
  })

  it('is NOT due when auto_armed is false — scenario (c)', () => {
    expect(isSeriesDueForSpawn({ ...base, auto_armed: false }, today, leadDays)).toBe(false)
  })

  it('is NOT due when paused — scenario (c)', () => {
    expect(isSeriesDueForSpawn({ ...base, paused: true }, today, leadDays)).toBe(false)
  })

  it('is NOT due when service_mode is manual', () => {
    expect(isSeriesDueForSpawn({ ...base, service_mode: 'manual' }, today, leadDays)).toBe(false)
  })

  it('is NOT due when not in_service (ended)', () => {
    expect(isSeriesDueForSpawn({ ...base, in_service: false }, today, leadDays)).toBe(false)
  })

  it('is NOT due when effective_next is null (no cadence / no anchor)', () => {
    expect(isSeriesDueForSpawn({ ...base, effective_next: null }, today, leadDays)).toBe(false)
  })

  it('is NOT due when effective_next is beyond the lead window', () => {
    expect(isSeriesDueForSpawn({ ...base, effective_next: '2026-08-25' }, today, leadDays)).toBe(false)
  })

  it('is due exactly at the lead-window boundary (today + leadDays)', () => {
    expect(isSeriesDueForSpawn({ ...base, effective_next: '2026-08-17' }, today, leadDays)).toBe(true)
  })

  it('selectDueSeries filters a batch down to only the due ones', () => {
    const rows = [
      { ...base, effective_next: '2026-08-12' }, // due
      { ...base, auto_armed: false }, // not armed
      { ...base, paused: true }, // paused
      { ...base, effective_next: '2026-09-01' }, // too far out
    ]
    expect(selectDueSeries(rows, today, leadDays)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// canSpawnNextWave — idempotency
// ---------------------------------------------------------------------------
describe('canSpawnNextWave', () => {
  it('does NOT spawn when a live wave already exists at next_wave_no — scenario (a)', () => {
    const decision = canSpawnNextWave({
      hasPrevWave: true,
      existingWaveNumbers: [1, 2],
      nextWaveNo: 2,
      prevWaveSpawnedAt: null,
    })
    expect(decision.spawn).toBe(false)
    expect(decision.reason).toBe('wave-exists')
  })

  it('does NOT spawn when the prior wave already recorded rerun_spawned_at', () => {
    const decision = canSpawnNextWave({
      hasPrevWave: true,
      existingWaveNumbers: [1],
      nextWaveNo: 2,
      prevWaveSpawnedAt: '2026-08-01T00:00:00Z',
    })
    expect(decision.spawn).toBe(false)
    expect(decision.reason).toBe('prev-already-spawned')
  })

  it('does NOT spawn when there is no prior wave to spawn from', () => {
    const decision = canSpawnNextWave({
      hasPrevWave: false,
      existingWaveNumbers: [],
      nextWaveNo: 2,
      prevWaveSpawnedAt: null,
    })
    expect(decision.spawn).toBe(false)
    expect(decision.reason).toBe('no-prev-wave')
  })

  it('spawns when the next wave number does not exist yet and the prior wave has not spawned', () => {
    const decision = canSpawnNextWave({
      hasPrevWave: true,
      existingWaveNumbers: [1],
      nextWaveNo: 2,
      prevWaveSpawnedAt: null,
    })
    expect(decision.spawn).toBe(true)
    expect(decision.reason).toBeUndefined()
  })

  it('two back-to-back calls on the same state both agree: first spawns is modeled by the caller re-querying, so a second call against the SAME (unchanged) input still says spawn — the DB unique index is what prevents an actual duplicate row on a race', () => {
    const input = { hasPrevWave: true, existingWaveNumbers: [1], nextWaveNo: 2, prevWaveSpawnedAt: null }
    expect(canSpawnNextWave(input).spawn).toBe(true)
    expect(canSpawnNextWave(input).spawn).toBe(true)
    // But once the wave exists (as it would after the first run re-queries), it's blocked:
    expect(canSpawnNextWave({ ...input, existingWaveNumbers: [1, 2] }).spawn).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isLegacyEligible — legacy path exclusion for series-owned rows
// ---------------------------------------------------------------------------
describe('isLegacyEligible', () => {
  const base = {
    longitudinal: true,
    rerun_date: '2026-08-12' as string | null,
    rerun_spawned_at: null as string | null,
    series_id: null as string | null,
    status: 'Open',
    board_column: 'Delivery',
  }
  const today = '2026-08-10'
  const leadDays = 7

  it('is eligible for the legacy path: longitudinal, due, un-spawned, no series', () => {
    expect(isLegacyEligible(base, today, leadDays)).toBe(true)
  })

  it('is EXCLUDED when series_id is set, even though longitudinal=true and due — scenario (b)', () => {
    expect(isLegacyEligible({ ...base, series_id: 'series-1' }, today, leadDays)).toBe(false)
  })

  it('is excluded when longitudinal is false', () => {
    expect(isLegacyEligible({ ...base, longitudinal: false }, today, leadDays)).toBe(false)
  })

  it('is excluded when already spawned', () => {
    expect(isLegacyEligible({ ...base, rerun_spawned_at: '2026-08-01T00:00:00Z' }, today, leadDays)).toBe(false)
  })

  it('is excluded when there is no rerun_date', () => {
    expect(isLegacyEligible({ ...base, rerun_date: null }, today, leadDays)).toBe(false)
  })

  it('is excluded when rerun_date is beyond the lead window', () => {
    expect(isLegacyEligible({ ...base, rerun_date: '2026-09-01' }, today, leadDays)).toBe(false)
  })

  it('is excluded when Cancelled', () => {
    expect(isLegacyEligible({ ...base, status: 'Cancelled' }, today, leadDays)).toBe(false)
  })

  it('is excluded when Closed and not in Delivery', () => {
    expect(isLegacyEligible({ ...base, status: 'Closed', board_column: 'Scoping' }, today, leadDays)).toBe(false)
  })

  it('is included when Closed but sitting in Delivery (a delivered wave hitting its rerun_date)', () => {
    expect(isLegacyEligible({ ...base, status: 'Closed', board_column: 'Delivery' }, today, leadDays)).toBe(true)
  })
})

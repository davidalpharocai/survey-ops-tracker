// Pure, DB-free helpers for the rerun_series model (migration 073). Reused by
// the auto-spawn cron, the manual "Create next wave" route, and the series UI
// so the date math / ordering / inheritance rules live in exactly one place
// and match the `rerun_series_status` SQL view. See
// docs/superpowers/specs/2026-08-10-rerun-update-design.md §6/§8/§18.

import { addMonths, format, parseISO } from 'date-fns'
import type { Tables } from '@/lib/supabase/types'
import { baseRerunName, nextRerunName } from '../utils/rerun'

// ---------------------------------------------------------------------------
// Date-only helpers (dates are "YYYY-MM-DD" strings throughout this module).
// ---------------------------------------------------------------------------

/** Add whole calendar months to a date-only string, clamping month-end
 * overflow the same way Postgres `date + make_interval(months => n)` does
 * (e.g. Jan 31 + 1 month -> Feb 28). */
function addMonthsToDateStr(dateStr: string, months: number): string {
  return format(addMonths(parseISO(dateStr), months), 'yyyy-MM-dd')
}

/** Greatest of two nullable date-only strings; null only when both are null.
 * Plain string comparison is valid because YYYY-MM-DD sorts lexicographically
 * in calendar order. */
function maxDateStr(a: string | null, b: string | null): string | null {
  if (a == null) return b
  if (b == null) return a
  return a >= b ? a : b
}

// ---------------------------------------------------------------------------
// 1) effectiveNext — mirrors rerun_series_status.effective_next exactly.
// ---------------------------------------------------------------------------

export interface EffectiveNextInput {
  lastOn: string | null
  anchorDate: string | null
  resumeAnchor: string | null
  cadenceMonths: number | null
  paused: boolean
  inService: boolean
}

/** The next date a series is due to field, or null if it can't be computed
 * (paused, ended, no cadence, or no anchor at all). Mirrors the SQL:
 * `greatest(coalesce(last_on, anchor_date), resume_anchor) + cadence_months months`. */
export function effectiveNext(input: EffectiveNextInput): string | null {
  const { lastOn, anchorDate, resumeAnchor, cadenceMonths, paused, inService } = input
  if (paused || !inService) return null
  const cadenceAnchor = maxDateStr(lastOn ?? anchorDate, resumeAnchor)
  if (cadenceMonths == null || cadenceAnchor == null) return null
  return addMonthsToDateStr(cadenceAnchor, cadenceMonths)
}

// ---------------------------------------------------------------------------
// 2) renumberWaves — generalizes renumberSeries (app/api/projects/link-rerun)
//    from the legacy rerun_series_id root-pointer to any series, plus a
//    manual wave_order override for drag-reorder.
// ---------------------------------------------------------------------------

export interface Wave {
  id: string
  rerun_number: number
  wave_order: number | null
  submitted_date: string | null
  launch_date: string | null
  deliver_date: string | null
  created_at: string
}

/** Best available date signal for a wave, in priority order. Some series
 * (e.g. weekly trackers with no submitted/launch dates) share an import
 * created_at, so the full fallback chain keeps ordering stable. */
function dateKey(w: Wave): string {
  return w.submitted_date ?? w.launch_date ?? w.deliver_date ?? w.created_at ?? ''
}

/** Recompute every wave's `rerun_number` from 1..N by chronological position
 * (or by an explicit manual `wave_order` once any wave has one), so numbers
 * never go stale, self-heal gaps, and are deterministic given the same
 * inputs. Called after every link/unlink/drag/spawn. */
export function renumberWaves(
  waves: Wave[],
  originId: string
): Array<{ id: string; rerun_number: number }> {
  const hasManualOrder = waves.some((w) => w.wave_order != null)

  const byDateThenCreated = (a: Wave, b: Wave): number => {
    const dk = dateKey(a).localeCompare(dateKey(b))
    if (dk !== 0) return dk
    return a.created_at.localeCompare(b.created_at)
  }

  const sorted = [...waves].sort((a, b) => {
    if (hasManualOrder) {
      // Waves without an explicit order (e.g. a freshly appended wave) sort
      // after every explicitly-ordered wave — matches "new auto-created
      // waves append at the end" (spec §11).
      const ao = a.wave_order ?? Number.POSITIVE_INFINITY
      const bo = b.wave_order ?? Number.POSITIVE_INFINITY
      if (ao !== bo) return ao - bo
      return byDateThenCreated(a, b)
    }
    // No manual order anywhere: date order, with the origin forced first
    // regardless of its own date (it's Wave 1 by definition).
    if (a.id === originId && b.id !== originId) return -1
    if (b.id === originId && a.id !== originId) return 1
    return byDateThenCreated(a, b)
  })

  return sorted.map((w, i) => ({ id: w.id, rerun_number: i + 1 }))
}

// ---------------------------------------------------------------------------
// 3) nextWaveInherit — the scalar survey_projects insert fields for a newly
//    spawned/created wave (spec §8). Child rows (suppliers/blasts/segments)
//    are copied separately by the caller via lib/server/clone.ts — NOT here.
// ---------------------------------------------------------------------------

/** The subset of `rerun_series.future_defaults` (jsonb) this module reads. */
export interface FutureDefaults {
  n_target?: number | null
  audience?: string | null
  audience_size?: number | null
  budget?: number | null
  template_id?: string | null
  captain_id?: string | null
  co_captain_ids?: string[] | null
  compliance_required_override?: boolean | null
}

/** The prior wave fields a new wave's dates/name are derived from. */
export type PrevWaveForInherit = Pick<
  Tables<'survey_projects'>,
  'project_name' | 'rerun_date' | 'launch_date' | 'due_date' | 'deliver_date' | 'captain_id'
>

/** Advance a nullable date-only string by cadence months; null if either
 * input is missing (there is nothing concrete to advance). */
function advanceOptional(dateStr: string | null, cadenceMonths: number | null): string | null {
  if (!dateStr || cadenceMonths == null) return null
  return addMonthsToDateStr(dateStr, cadenceMonths)
}

/** The new wave's fielding/rerun date. Always concrete (never null) so the
 * "next due" provably advances (spec §18 spawn idempotency) — even for an
 * ad-hoc series (no cadence) or a prior wave with no dates at all, in which
 * case `todayISO` is the last-resort base. */
function nextRerunDate(
  series: Pick<Tables<'rerun_series'>, 'cadence_months' | 'anchor_date' | 'resume_anchor'>,
  prevWave: PrevWaveForInherit,
  todayISO: string
): string {
  const computed = effectiveNext({
    lastOn: prevWave.rerun_date ?? prevWave.launch_date ?? null,
    anchorDate: series.anchor_date,
    resumeAnchor: series.resume_anchor,
    cadenceMonths: series.cadence_months,
    paused: false,
    inService: true,
  })
  if (computed != null) return computed

  // No cadence anchor could be derived (e.g. ad-hoc series with no prior
  // dates). Fall back to whatever prior date exists, advanced by cadence if
  // known; if truly nothing is available, use today so the field is never
  // blank.
  const base = prevWave.rerun_date ?? prevWave.launch_date ?? prevWave.deliver_date ?? todayISO
  return series.cadence_months != null ? addMonthsToDateStr(base, series.cadence_months) : base
}

/** The scalar `survey_projects` insert fields for the next wave of a series,
 * given the series record and the latest existing wave. Pure: no DB calls. */
export function nextWaveInherit(
  series: Tables<'rerun_series'>,
  prevWave: PrevWaveForInherit,
  todayISO: string
): Record<string, unknown> {
  const fd = (series.future_defaults ?? {}) as FutureDefaults

  return {
    client: series.client,
    client_id: series.client_id,
    project_name: nextRerunName(baseRerunName(prevWave.project_name), series.next_wave_no),
    project_type: series.base_type, // B2B or PS — never the legacy 'Rerun' value
    series_id: series.id,
    rerun_number: series.next_wave_no,
    // Null here means "use the default rerun captain" (e.g. Sree) — resolved
    // by the caller (cron/route), not this pure function.
    captain_id: fd.captain_id ?? null,
    // Carried verbatim from the series' future_defaults, never derived from
    // prevWave's captain — the original wave-1 captain is seeded into this
    // list once, at promotion, so it doesn't need re-deriving per wave.
    co_captain_ids: fd.co_captain_ids ?? [],
    n_target: fd.n_target ?? null,
    audience: fd.audience ?? null,
    audience_size: fd.audience_size ?? null,
    budget: fd.budget ?? null,
    survey_tool_id: null,
    n_collected: null,
    n_actual: null,
    board_column: 'Submitted',
    status: 'Open',
    phase: 'Active',
    stage_doc_programming: false,
    stage_survey_programming: false,
    stage_edwin_qa: false,
    stage_fielding: false,
    stage_data_qa: false,
    stage_delivery: false,
    rerun_date: nextRerunDate(series, prevWave, todayISO),
    due_date: advanceOptional(prevWave.due_date, series.cadence_months),
    deliver_date: advanceOptional(prevWave.deliver_date, series.cadence_months),
    compliance_required_override: fd.compliance_required_override ?? null,
  }
}

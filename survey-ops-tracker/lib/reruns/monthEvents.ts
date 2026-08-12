import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'

// ---------------------------------------------------------------------------
// Pure month-bucketing for the first-class rerun model. No React / Supabase
// imports so the whole module is unit-testable in isolation (see
// monthEvents.test.ts) — the sibling of lib/calendar/events.ts, but keyed off
// the rerun_series_status VIEW's computed effective_next / is_overdue rather
// than raw project date columns.
// ---------------------------------------------------------------------------

export interface RerunMonthEvent {
  seriesId: string
  client: string
  survey_name: string
  /** null for a legacy Rerun-Service series with no base type set yet (mig 074). */
  base_type: string | null
  rerun_service: boolean
  /** YYYY-MM-DD — the computed next-wave date this event sits on. */
  effective_next: string
  is_overdue: boolean
  days_to_next: number | null
}

/** YYYY-MM-DD from a date-only or ISO timestamp string (dates are UTC-anchored). */
function dayKey(value: string): string {
  return value.slice(0, 10)
}

/**
 * Bucket in-service, non-paused series that have a computed next-wave date by
 * that date (YYYY-MM-DD). Ad-hoc (null cadence → null effective_next), paused,
 * ended (not in service), and no-date series are omitted — they never land on
 * the grid. Within a day, overdue events sort first, then by client · survey.
 */
export function seriesMonthEvents(series: SeriesListRow[]): Record<string, RerunMonthEvent[]> {
  const byDate: Record<string, RerunMonthEvent[]> = {}
  for (const s of series) {
    if (!s.in_service || s.paused || !s.effective_next) continue
    const key = dayKey(s.effective_next)
    ;(byDate[key] ??= []).push({
      seriesId: s.id,
      client: s.client,
      survey_name: s.survey_name,
      base_type: s.base_type,
      rerun_service: s.rerun_service,
      effective_next: key,
      is_overdue: !!s.is_overdue,
      days_to_next: s.days_to_next,
    })
  }
  for (const key of Object.keys(byDate)) {
    byDate[key].sort(
      (a, b) =>
        (a.is_overdue === b.is_overdue ? 0 : a.is_overdue ? -1 : 1) ||
        `${a.client} ${a.survey_name}`.localeCompare(`${b.client} ${b.survey_name}`)
    )
  }
  return byDate
}

/**
 * The series needing action now: strictly the overdue ones (the view's
 * is_overdue already ignores a completed wave and excludes paused). An ad-hoc
 * (null-cadence) in-service series is NOT flagged — running ad-hoc is a
 * deliberate first-class choice, so nagging it forever is wrong; it only needs
 * action once it actually goes overdue. Sorted overdue-first, then by
 * days_to_next ascending so the most-overdue lead comes first.
 */
export function needsActionSeries(series: SeriesListRow[]): SeriesListRow[] {
  const needing = series.filter((s) => s.is_overdue)
  return needing.sort((a, b) => {
    const ra = a.is_overdue ? 0 : 1
    const rb = b.is_overdue ? 0 : 1
    if (ra !== rb) return ra - rb
    const da = a.days_to_next
    const db = b.days_to_next
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })
}

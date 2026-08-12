// Pure filter + deep-search predicates shared by the three /reruns views
// (Calendar / List / Series). No React / Supabase imports so the whole module
// is unit-testable in isolation (see filterViews.test.ts). The page owns the
// RerunFilterState (so switching views keeps the query); every view runs its
// series (and, for List's wave granularity, its waves) through these helpers.
// (matchesDuePreset is a pure date-fns helper — the same one the main board's
// Due filter uses — so the reruns Next-due filter agrees with the board.)

import { matchesDuePreset } from '@/lib/utils/date'

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export type RerunTypeFilter = 'all' | 'PS' | 'B2B' | 'service'
export type RerunStatusFilter = 'all' | 'in_service' | 'paused' | 'ended' | 'overdue'
export type RerunCadenceFilter = 'all' | '1' | '3' | '6' | '12' | 'adhoc'

export interface RerunFilterState {
  /** Deep-search text (case-insensitive substring, all whitespace tokens must match). */
  search: string
  type: RerunTypeFilter
  status: RerunStatusFilter
  cadence: RerunCadenceFilter
  /** 'all' or a specific owner_email. */
  owner: string
  /** 'all' or a specific client (the series' denormalized client string). */
  client: string
  /** 'all' or a specific salesperson — matched against the series' waves. */
  salesperson: string
  /** Next-due (effective_next) filter: '' = all, else a matchesDuePreset key
   *  ('overdue' | 'today' | 'tomorrow' | 'twodays' | 'week' | 'month' | 'none'
   *  | 'custom'). 'custom' uses dueFrom/dueTo (ISO yyyy-mm-dd, '' = open end). */
  due: string
  dueFrom: string
  dueTo: string
}

export const EMPTY_RERUN_FILTER: RerunFilterState = {
  search: '',
  type: 'all',
  status: 'all',
  cadence: 'all',
  owner: 'all',
  client: 'all',
  salesperson: 'all',
  due: '',
  dueFrom: '',
  dueTo: '',
}

/** True when any filter or the search box is narrowing the result set. */
export function isFilterActive(f: RerunFilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.type !== 'all' ||
    f.status !== 'all' ||
    f.cadence !== 'all' ||
    f.owner !== 'all' ||
    f.client !== 'all' ||
    f.salesperson !== 'all' ||
    f.due !== ''
  )
}

// ---------------------------------------------------------------------------
// Structural field shapes — kept minimal so tests (and every view) can pass a
// SeriesListRow / SeriesWave row directly, or a hand-rolled partial.
// ---------------------------------------------------------------------------

export interface SeriesFilterFields {
  base_type: string | null
  cadence_months: number | null
  in_service: boolean
  paused: boolean
  is_overdue: boolean | null
  owner_email: string | null
  /** Denormalized client string on the series (for the Client filter). */
  client: string
  /** Computed next-due date (for the Next-due filter). */
  effective_next: string | null
}

export interface SeriesSearchFields {
  client: string
  survey_name: string
  template_id: string | null
  owner_email: string | null
  base_type: string | null
}

export interface WaveSearchFields {
  project_code: string | null
  project_name: string | null
  survey_tool_id: string | null
  /** Salesperson on this wave (survey_projects.salesperson) — for the
   *  Salesperson filter, matched at the series level (any wave) or per-wave. */
  salesperson: string | null
}

// ---------------------------------------------------------------------------
// Labels (shared with the view components so the badge/label text agrees with
// what the deep search matches on).
// ---------------------------------------------------------------------------

/** The base-type label used both in the UI badge and the search haystack. */
export function baseTypeLabel(baseType: string | null): string {
  if (baseType === 'PS') return 'PS'
  if (baseType === 'B2B') return 'B2B'
  return 'Rerun Service'
}

export function cadenceLabel(months: number | null): string {
  if (months == null) return 'Ad-hoc'
  return ({ 1: 'Monthly', 3: 'Quarterly', 6: 'Every 6 mo', 12: 'Yearly' } as Record<number, string>)[months] ?? `Every ${months} mo`
}

export type SeriesStatusKey = 'overdue' | 'paused' | 'ended' | 'in_service'

/** One canonical status per series. Overdue wins (it's the actionable one),
 * then paused, then ended (out of service), else in service. */
export function seriesStatusKey(s: Pick<SeriesFilterFields, 'in_service' | 'paused' | 'is_overdue'>): SeriesStatusKey {
  if (s.is_overdue) return 'overdue'
  if (s.paused) return 'paused'
  if (!s.in_service) return 'ended'
  return 'in_service'
}

export const SERIES_STATUS_META: Record<SeriesStatusKey, { label: string; chip: string }> = {
  overdue: { label: 'Overdue', chip: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  paused: { label: 'Paused', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  ended: { label: 'Ended', chip: 'bg-muted text-muted-foreground' },
  in_service: { label: 'In service', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** The dropdown filters (Type / Status / Cadence / Owner) — search excluded. */
export function seriesMatchesFilters(s: SeriesFilterFields, f: RerunFilterState): boolean {
  // Type — PS / B2B / Rerun Service (base_type null)
  if (f.type === 'PS' && s.base_type !== 'PS') return false
  if (f.type === 'B2B' && s.base_type !== 'B2B') return false
  if (f.type === 'service' && s.base_type != null) return false

  // Status — overdue / paused / ended / in service (mutually reachable; a series
  // can be in_service AND overdue, so each option tests its own flag).
  if (f.status === 'overdue' && !s.is_overdue) return false
  if (f.status === 'paused' && !s.paused) return false
  if (f.status === 'ended' && s.in_service) return false
  if (f.status === 'in_service' && !(s.in_service && !s.paused)) return false

  // Cadence — monthly / quarterly / 6mo / yearly / ad-hoc (null)
  if (f.cadence === 'adhoc' && s.cadence_months != null) return false
  if (f.cadence !== 'all' && f.cadence !== 'adhoc' && s.cadence_months !== Number(f.cadence)) return false

  // Owner
  if (f.owner !== 'all' && (s.owner_email ?? '') !== f.owner) return false

  // Client — exact match on the series' denormalized client string.
  if (f.client !== 'all' && s.client !== f.client) return false

  // Next-due — reuse the board's Due-preset predicate against effective_next
  // ('' preset matches everything; 'none' matches series with no next date).
  if (!matchesDuePreset(s.effective_next, f.due || null, f.dueFrom || null, f.dueTo || null)) return false

  return true
}

/** Salesperson lives on the waves, not the series. A series matches the
 *  Salesperson filter when ANY of its waves was sold by that salesperson.
 *  'all' short-circuits to true (and a series with no waves can't match a
 *  specific salesperson). */
export function seriesMatchesSalesperson(
  waves: readonly Pick<WaveSearchFields, 'salesperson'>[],
  f: RerunFilterState,
): boolean {
  if (f.salesperson === 'all') return true
  return waves.some((w) => (w.salesperson ?? '') === f.salesperson)
}

function tokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

function haystack(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase()
}

/** Deep search over a series (and its waves): every whitespace token must appear
 * as a substring somewhere across client / survey_name / template_id /
 * owner_email / base-type label, plus each wave's project_code / project_name /
 * survey_tool_id. Empty search matches everything. */
export function seriesMatchesSearch(
  s: SeriesSearchFields,
  waves: readonly WaveSearchFields[],
  query: string,
): boolean {
  const ts = tokens(query)
  if (ts.length === 0) return true
  const parts: (string | null | undefined)[] = [
    s.client,
    s.survey_name,
    s.template_id,
    s.owner_email,
    baseTypeLabel(s.base_type),
  ]
  for (const w of waves) parts.push(w.project_code, w.project_name, w.survey_tool_id)
  const h = haystack(parts)
  return ts.every((t) => h.includes(t))
}

/** Deep search over a single wave in the context of its parent series — the
 * same field set as seriesMatchesSearch but scoped to one wave (for the List
 * view's wave granularity, where each row is a wave). */
export function waveMatchesSearch(
  w: WaveSearchFields,
  s: SeriesSearchFields,
  query: string,
): boolean {
  const ts = tokens(query)
  if (ts.length === 0) return true
  const h = haystack([
    s.client,
    s.survey_name,
    s.template_id,
    s.owner_email,
    baseTypeLabel(s.base_type),
    w.project_code,
    w.project_name,
    w.survey_tool_id,
  ])
  return ts.every((t) => h.includes(t))
}

/** A series passes when it clears the dropdown filters (incl. Salesperson,
 * matched across its waves) AND the deep search. */
export function seriesPasses(
  s: SeriesFilterFields & SeriesSearchFields,
  waves: readonly WaveSearchFields[],
  f: RerunFilterState,
): boolean {
  return (
    seriesMatchesFilters(s, f) &&
    seriesMatchesSalesperson(waves, f) &&
    seriesMatchesSearch(s, waves, f.search)
  )
}

/** A wave row passes when its parent series clears the dropdown filters, THIS
 * wave matches the Salesperson filter (a wave row is a single wave, so it's the
 * wave's own salesperson — not "any wave in the series"), AND the deep search
 * matches the wave (in its series context). */
export function wavePasses(
  w: WaveSearchFields,
  s: SeriesFilterFields & SeriesSearchFields,
  f: RerunFilterState,
): boolean {
  return (
    seriesMatchesFilters(s, f) &&
    seriesMatchesSalesperson([w], f) &&
    waveMatchesSearch(w, s, f.search)
  )
}

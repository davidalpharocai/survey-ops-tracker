'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

// The rerun_series record (migration 073): reads the series + its live waves;
// mutations post to app/api/reruns/series for every lifecycle action. Follows
// the query-key / mutation style of lib/hooks/useReruns.ts and
// lib/hooks/useRerunLineage.ts. See
// docs/superpowers/plans/2026-08-10-rerun-update.md Task 6.

// The read model is the rerun_series_status VIEW (the series row + the computed
// last_on/effective_next/days_to_next/is_overdue), so the record, the month
// view, and the digest all agree on "due" the same way rerun_status does for
// the legacy sheet mirror.
export type SeriesStatusRow = Database['public']['Views']['rerun_series_status']['Row']

export interface SeriesWave {
  id: string
  project_code: string | null
  project_name: string
  rerun_number: number
  wave_order: number | null
  submitted_date: string | null
  launch_date: string | null
  due_date: string | null
  deliver_date: string | null
  delivered_at: string | null
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
  survey_tool_id: string | null
  status: string | null
  board_column: string | null
  is_placeholder: boolean
  salesperson: string | null
}

const WAVE_COLS =
  'id, project_code, project_name, rerun_number, wave_order, submitted_date, launch_date, due_date, deliver_date, delivered_at, n_target, n_collected, n_actual, survey_tool_id, status, board_column, is_placeholder, salesperson'

export interface RerunSeriesRecord {
  series: SeriesStatusRow
  waves: SeriesWave[]
}

/** The series row (with its computed due-date fields) + its live waves,
 * ordered by wave number. Disabled until a seriesId is known (e.g. a project
 * that hasn't been put into rerun service yet). */
export function useRerunSeriesRecord(seriesId: string | null | undefined) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-series-record', seriesId],
    enabled: !!seriesId,
    queryFn: async (): Promise<RerunSeriesRecord> => {
      const id = seriesId as string
      const [{ data: series, error: seriesErr }, { data: waves, error: wavesErr }] = await Promise.all([
        supabase.from('rerun_series_status').select('*').eq('id', id).single(),
        supabase
          .from('survey_projects')
          .select(WAVE_COLS)
          .eq('series_id', id)
          .is('deleted_at', null)
          .order('rerun_number', { ascending: true }),
      ])
      if (seriesErr) throw seriesErr
      if (wavesErr) throw wavesErr
      return { series: series as SeriesStatusRow, waves: (waves ?? []) as SeriesWave[] }
    },
    staleTime: 30_000,
  })
}

export interface SeriesListRow extends SeriesStatusRow {
  /** Live wave count — computed client-side from survey_projects.series_id
   * since the status view is per-series scalar fields only. */
  wave_count: number
}

/** Every first-class rerun series (the new model), for the /reruns/series
 * list — sibling to (not a replacement of) the legacy useAllRerunSeries()
 * lineage grouping in useRerunLineage.ts. Distinct query key on purpose so
 * the two lists never collide in the cache. */
export function useRerunSeriesList() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-series-list'],
    queryFn: async (): Promise<SeriesListRow[]> => {
      const [{ data: series, error: seriesErr }, { data: waveRows, error: waveErr }] = await Promise.all([
        supabase.from('rerun_series_status').select('*').order('client', { ascending: true }),
        supabase.from('survey_projects').select('series_id').not('series_id', 'is', null).is('deleted_at', null),
      ])
      if (seriesErr) throw seriesErr
      if (waveErr) throw waveErr
      const counts = new Map<string, number>()
      for (const row of (waveRows ?? []) as { series_id: string | null }[]) {
        if (row.series_id) counts.set(row.series_id, (counts.get(row.series_id) ?? 0) + 1)
      }
      return ((series ?? []) as SeriesStatusRow[]).map((s) => ({ ...s, wave_count: counts.get(s.id) ?? 0 }))
    },
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Mutations — one endpoint (app/api/reruns/series), discriminated by `action`.
// ---------------------------------------------------------------------------

export interface PendingWave {
  id: string
  project_code: string | null
  project_name: string
  rerun_number: number
  board_column: string
}

export interface SpawnWaveResult {
  created: boolean
  waveId?: string
  waveName?: string
  reason?: string
}

export type RerunSeriesFieldsPatch = Partial<{
  cadence_months: number | null
  delivery_cadence: string | null
  service_mode: string
  template_id: string | null
  owner_email: string | null
  base_type: 'B2B' | 'PS'
  survey_name: string
  notes: string | null
  data_qa_note: string | null
  anchor_date: string | null
}>

export type RerunSeriesActionInput =
  | {
      action: 'create'
      projectId: string
      base_type: 'B2B' | 'PS'
      cadence_months?: number | null
      service_mode?: string
      delivery_cadence?: string | null
      template_id?: string | null
      future_defaults?: Record<string, unknown>
    }
  | { action: 'update'; seriesId: string; fields: RerunSeriesFieldsPatch }
  | { action: 'set_defaults'; seriesId: string; future_defaults: Record<string, unknown> }
  | { action: 'pause' | 'end'; seriesId: string; dryRun?: boolean; cancelPending?: boolean }
  | { action: 'resume' | 'reactivate'; seriesId: string }
  | { action: 'spawn_next'; seriesId: string }
  | { action: 'arm'; seriesId: string; armed: boolean }
  | { action: 'reorder'; seriesId: string; orderedWaveIds: string[] }
  // Add an EXISTING survey to a series, or take one out. `detach_wave` carries no
  // seriesId on purpose — the survey knows which series it is in, and asking the
  // caller to supply it would let a stale UI detach from the wrong one.
  | { action: 'attach_wave'; seriesId: string; projectId: string }
  | { action: 'detach_wave'; projectId: string }

export interface RerunSeriesActionResult {
  series?: Database['public']['Tables']['rerun_series']['Row']
  /** Returned by `detach_wave`, which has no seriesId in its input and no series
   *  row in its response — without this the series record would never be
   *  invalidated and the wave list would keep showing the removed wave. */
  seriesId?: string
  /** Returned by `attach_wave`: every survey that actually moved. Attaching
   *  sweeps the survey's legacy lineage family, so this is often longer than the
   *  one the user picked — report the real number, not the one they named. */
  attached?: string[]
  waves?: SeriesWave[]
  pendingWave?: PendingWave | null
  spawn?: SpawnWaveResult
  error?: string
}

/** One mutation for every rerun_series lifecycle action (create / update /
 * set_defaults / pause / resume / end / reactivate / spawn_next / arm /
 * reorder) — mirrors useLinkRerun's fetch-then-invalidate shape. Invalidates
 * the record itself (keyed off the series id in the response for `create`,
 * else the `seriesId` in the call), the cross-client series list, the board's
 * project lists, and the legacy rerun snapshot (waves are normal projects, so
 * they show up in all three). */
export function useRerunSeriesActions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: RerunSeriesActionInput): Promise<RerunSeriesActionResult> => {
      const res = await fetch('/api/reruns/series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const json = (await res.json().catch(() => ({}))) as RerunSeriesActionResult
      if (!res.ok) throw new Error(json.error || 'Could not update the rerun series. Please try again.')
      return json
    },
    onSuccess: (data, variables) => {
      const seriesId =
        'seriesId' in variables ? variables.seriesId : (data.series?.id ?? data.seriesId)
      if (seriesId) queryClient.invalidateQueries({ queryKey: ['rerun-series-record', seriesId] })
      queryClient.invalidateQueries({ queryKey: ['all-rerun-series'] })
      queryClient.invalidateQueries({ queryKey: ['rerun-series-list'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['rerun-snapshot'] })
      // attach_wave / detach_wave change the PROJECT's own series_id, and the
      // project detail page decides between the first-class and legacy wave
      // history off that field — so its own query has to be refetched or the
      // page keeps rendering the branch it was on before. The legacy lineage
      // queries go too, since a detach clears rerun_series_id as well.
      if ('projectId' in variables && variables.projectId) {
        queryClient.invalidateQueries({ queryKey: ['project', variables.projectId] })
      }
      queryClient.invalidateQueries({ queryKey: ['project'] })
      queryClient.invalidateQueries({ queryKey: ['rerun-series'] })
      queryClient.invalidateQueries({ queryKey: ['rerun-candidates'] })
      // The CLIENT page is the whole point of series membership — it is the only
      // surface that groups waves, and it reads its own keys that none of the
      // above match. Without these, attaching a wave then navigating to the
      // client page shows the OLD grouping for up to the 30s global staleTime,
      // i.e. the user does the fix and sees it not work.
      queryClient.invalidateQueries({ queryKey: ['client-projects'] })
      queryClient.invalidateQueries({ queryKey: ['client-rerun-series'] })
      // The nav Reruns badge sums first-class + legacy overdue counts; a
      // lifecycle action (pause/resume/end/spawn/…) can flip a series' overdue
      // state, so refresh it too.
      queryClient.invalidateQueries({ queryKey: ['rerun-overdue-count'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Candidates for "add another survey to THIS series"
// ---------------------------------------------------------------------------

export interface SeriesAddCandidate {
  id: string
  project_code: string | null
  project_name: string
  client: string
  submitted_date: string | null
  launch_date: string | null
  board_column: string | null
}

/** Surveys that could be added to a series: same firm, not already in ANY
 *  first-class series, newest first.
 *
 *  Deliberately NOT useRerunCandidates (lib/hooks/useRerunLineage.ts). That one
 *  excludes the project's legacy lineage family, which is right for "link this as
 *  a rerun of another survey" — you cannot be a rerun of something already in
 *  your own lineage. Here the opposite is true: a legacy sibling that never got a
 *  series link is the single most likely thing you want to add, and excluding it
 *  would hide exactly the surveys this control exists to fix. PR00010 and PR00207
 *  were in precisely that state.
 *
 *  `series_id is null` is the only hard filter, so a survey already in a
 *  DIFFERENT series never appears — attachProjectToSeries would refuse it, and
 *  offering a choice the server rejects is worse than not offering it. */
export function useSeriesAddCandidates(client: string | null | undefined, enabled: boolean) {
  const supabase = createClient()
  // Client strings are "Firm - Contact"; a series belongs to the firm.
  const firm = (client ?? '').split(' - ')[0].trim()
  return useQuery({
    queryKey: ['series-add-candidates', firm],
    enabled: enabled && firm.length > 0,
    queryFn: async (): Promise<SeriesAddCandidate[]> => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select('id, project_code, project_name, client, submitted_date, launch_date, board_column')
        .ilike('client', `${firm.replace(/([%_\\])/g, '\\$1')}%`)
        .is('series_id', null)
        .is('deleted_at', null)
        .order('submitted_date', { ascending: false, nullsFirst: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as SeriesAddCandidate[]
    },
    staleTime: 30_000,
  })
}

'use client'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SeriesWave } from '@/lib/hooks/useRerunSeriesRecord'

// Every wave across every first-class rerun series, in ONE query — the
// wave-granularity companion to useRerunSeriesList() (which is series-level).
// The List view's Waves mode reads these rows directly; the Series view expands
// a series into its waves. Build a Map<series_id, waves[]> client-side from this
// (already ordered by series_id, then rerun_number). Mirrors the react-query
// style of useRerunSeriesRecord.ts.

/** A SeriesWave plus the series it belongs to (series_id) and its client — so a
 * flat wave list can render/group without a second lookup. is_placeholder is
 * already on SeriesWave. */
export interface SeriesWaveRow extends SeriesWave {
  series_id: string
  client: string | null
}

// WAVE_COLS (see useRerunSeriesRecord.ts) + series_id + client. is_placeholder
// is already in WAVE_COLS; listed here to match the query the record hook uses.
const WAVE_COLS_ALL =
  'id, project_code, project_name, rerun_number, wave_order, submitted_date, launch_date, due_date, deliver_date, delivered_at, n_target, n_collected, n_actual, survey_tool_id, status, board_column, is_placeholder, series_id, client'

export function useAllRerunWaves() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-waves-all'],
    queryFn: async (): Promise<SeriesWaveRow[]> => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(WAVE_COLS_ALL)
        .not('series_id', 'is', null)
        .is('deleted_at', null)
        .order('series_id', { ascending: true })
        .order('rerun_number', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as SeriesWaveRow[]
    },
    staleTime: 30_000,
  })
}

/** Group a flat wave list into series_id -> waves[] (already ordered by
 * rerun_number from the query). */
export function wavesBySeriesId(waves: SeriesWaveRow[]): Map<string, SeriesWaveRow[]> {
  const m = new Map<string, SeriesWaveRow[]>()
  for (const w of waves) {
    const list = m.get(w.series_id)
    if (list) list.push(w)
    else m.set(w.series_id, [w])
  }
  return m
}

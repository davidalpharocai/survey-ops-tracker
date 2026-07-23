import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

// A rerun series is anchored to the ORIGINAL survey: the original has
// rerun_series_id = null (its own id IS the series id), later waves store that
// root id + a rerun_number. So the family is `id = root OR rerun_series_id = root`.

export interface Wave {
  id: string
  project_code: string | null
  project_name: string
  client: string
  rerun_series_id: string | null
  rerun_number: number | null
  project_type: string | null
  status: string | null
  board_column: string | null
  due_date: string | null
  deliver_date: string | null
  delivered_at: string | null
  launch_date: string | null
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
}

const WAVE_COLS =
  'id, project_code, project_name, client, rerun_series_id, rerun_number, project_type, status, board_column, due_date, deliver_date, delivered_at, launch_date, n_target, n_collected, n_actual'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const esc = (s: string) => s.replace(/([%_\\])/g, '\\$1')

/** All waves in a project's rerun series, ordered by wave number. */
export function useRerunSeries(projectId: string, rerunSeriesId: string | null) {
  const supabase = createClient()
  const root = rerunSeriesId ?? projectId
  return useQuery({
    queryKey: ['rerun-series', root],
    queryFn: async (): Promise<Wave[]> => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(WAVE_COLS)
        .or(`id.eq.${root},rerun_series_id.eq.${root}`)
        .is('deleted_at', null)
        .order('rerun_number', { ascending: true })
      if (error) throw error
      return (data ?? []) as Wave[]
    },
    staleTime: 30_000,
  })
}

/** Candidate "original" surveys to link the current project under: same client
 *  firm, not itself, not already in its series — ranked by name-word overlap so
 *  the obvious match (e.g. the prior Wealth Manager wave) floats to the top. */
export function useRerunCandidates(
  project: { id: string; client: string; project_name: string; rerun_series_id: string | null },
  enabled: boolean
) {
  const supabase = createClient()
  const root = project.rerun_series_id ?? project.id
  const firm = project.client.split(' - ')[0].trim()
  return useQuery({
    queryKey: ['rerun-candidates', project.id, firm],
    enabled,
    queryFn: async (): Promise<Wave[]> => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(WAVE_COLS)
        .ilike('client', `${esc(firm)}%`)
        .is('deleted_at', null)
        .neq('id', project.id)
        .limit(200)
      if (error) throw error
      const rows = (data ?? []) as Wave[]
      const words = new Set(norm(project.project_name).split(' ').filter((w) => w.length > 2))
      return rows
        .filter((r) => r.id !== root && r.rerun_series_id !== root) // not already in this series
        .map((r) => {
          const overlap = norm(r.project_name)
            .split(' ')
            .filter((w) => words.has(w)).length
          return { r, overlap }
        })
        .sort((a, b) => b.overlap - a.overlap)
        .map((x) => x.r)
    },
    staleTime: 30_000,
  })
}

export type RerunSeriesGroup = {
  rootId: string
  /** Client of the series' root/original wave. */
  client: string
  /** Root wave's project name (raw; the board strips a trailing "— week N"). */
  name: string
  waves: Wave[]
}

/** Every multi-wave rerun series (grouped by root), for the /reruns Series board.
 *  A series = a root (its own id) plus the waves whose rerun_series_id points to it. */
export function useAllRerunSeries() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['all-rerun-series'],
    queryFn: async (): Promise<RerunSeriesGroup[]> => {
      const { data: children, error } = await supabase
        .from('survey_projects')
        .select(WAVE_COLS)
        .not('rerun_series_id', 'is', null)
        .is('deleted_at', null)
      if (error) throw error
      // seen: id → wave for every wave we've fetched (children + their ancestors).
      const seen = new Map<string, Wave>()
      for (const k of (children ?? []) as Wave[]) seen.set(k.id, k)
      // Pull in referenced ancestors, following the chain — robust to a stray
      // 2-level link where a wave points at a mid-series wave instead of the root.
      const pending = () =>
        Array.from(new Set([...seen.values()].map(w => w.rerun_series_id).filter((x): x is string => !!x))).filter(id => !seen.has(id))
      for (let round = 0, miss = pending(); round < 5 && miss.length; round++, miss = pending()) {
        const { data } = await supabase.from('survey_projects').select(WAVE_COLS).in('id', miss).is('deleted_at', null)
        for (const r of (data ?? []) as Wave[]) seen.set(r.id, r)
      }
      // Ultimate root: follow rerun_series_id until null (or a wave we don't have).
      const rootOf = (w: Wave): string => {
        let cur = w
        for (let i = 0; i < 12 && cur.rerun_series_id && seen.has(cur.rerun_series_id); i++) cur = seen.get(cur.rerun_series_id)!
        return cur.rerun_series_id && !seen.has(cur.rerun_series_id) ? cur.rerun_series_id : cur.id
      }
      // Group by ultimate root; a per-root Map dedups by wave id (so a wave that
      // is both a child and a stray-chain target can't appear twice).
      const byRoot = new Map<string, Map<string, Wave>>()
      for (const w of seen.values()) {
        const root = rootOf(w)
        if (!byRoot.has(root)) byRoot.set(root, new Map())
        byRoot.get(root)!.set(w.id, w)
      }
      return [...byRoot.entries()]
        .map(([rootId, m]) => {
          const waves = [...m.values()].sort((a, b) => (a.rerun_number ?? 0) - (b.rerun_number ?? 0))
          const root = waves.find(w => w.id === rootId) ?? waves[0]
          return { rootId, client: root.client, name: root.project_name, waves }
        })
        .filter(s => s.waves.length > 1)
        .sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name))
    },
    staleTime: 30_000,
  })
}

/** Link the current project as a rerun of a parent (parentId), or detach it (null). */
export function useLinkRerun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { childId: string; parentId: string | null }) => {
      const res = await fetch('/api/projects/link-rerun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not update the rerun link. Please try again.')
      return json
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rerun-series'] })
      queryClient.invalidateQueries({ queryKey: ['rerun-candidates'] })
      queryClient.invalidateQueries({ queryKey: ['all-rerun-series'] })
      queryClient.invalidateQueries({ queryKey: ['project'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

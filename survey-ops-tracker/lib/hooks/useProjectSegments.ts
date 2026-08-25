import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

// Row already carries n_internal_target / audience / audience_size (migration 062).
export type ProjectSegment = Database['public']['Tables']['project_segments']['Row']
export type SegmentInput = {
  label: string
  /** The MINIMUM of the agreed N range (migration 078). */
  n_target: number | null
  /** The maximum of that range. Null means "one agreed number" = the min. */
  n_target_max: number | null
  n_internal_target: number | null
  n_collected: number
  n_actual: number | null
  audience: string | null
  audience_size: number | null
}

/**
 * Arg for useAddSegment: either a bare `sort_order` (adds an empty segment —
 * used by the "+ Add segment" control in NSegmentsEditor) or a partial payload
 * + `sort_order` (used to restore a just-removed segment via Undo, preserving
 * its full N + audience).
 */
export type AddSegmentInput = number | (Partial<SegmentInput> & { sort_order: number })

// A segment write changes the parent's summed totals (via DB trigger), so
// refresh the segment list, the project detail, and both board caches.
function invalidateAll(qc: QueryClient, projectId: string) {
  qc.invalidateQueries({ queryKey: ['segments', projectId] })
  qc.invalidateQueries({ queryKey: ['project', projectId] })
  qc.invalidateQueries({ queryKey: ['projects'] })
  qc.invalidateQueries({ queryKey: ['internal-projects'] })
}

export function useProjectSegments(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['segments', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_segments')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order')
      if (error) throw error
      return data as ProjectSegment[]
    },
    enabled: !!projectId,
    retry: false,
  })
}

/** Split a single-N project into two segments, seeding the first with the
 *  project's current N so nothing is lost; the second starts empty. */
export function useSplitProject(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (seed: { n_target: number | null; n_target_max: number | null; n_internal_target: number | null; n_collected: number; n_actual: number | null; audience: string | null; audience_size: number | null }) => {
      // Both ends of the N range travel together, here as everywhere: seeding
      // only the min would leave segment 1 open-ended and roll a null max back
      // up to the project, silently dropping the maximum we agreed.
      const rows = [
        { project_id: projectId, label: '', n_target: seed.n_target, n_target_max: seed.n_target_max, n_internal_target: seed.n_internal_target, n_collected: seed.n_collected ?? 0, n_actual: seed.n_actual, audience: seed.audience, audience_size: seed.audience_size, sort_order: 0 },
        { project_id: projectId, label: '', n_target: null, n_target_max: null, n_internal_target: null, n_collected: 0, n_actual: null, audience: null, audience_size: null, sort_order: 1 },
      ]
      const { error } = await supabase.from('project_segments').insert(rows)
      if (error) throw error
    },
    onError: () => toast("Couldn't split into segments — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

export function useAddSegment(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (arg: AddSegmentInput) => {
      // Number → a fresh empty segment; object → restore a removed one (Undo),
      // threading through the full N + audience payload.
      const p: Partial<SegmentInput> & { sort_order: number } =
        typeof arg === 'number' ? { sort_order: arg } : arg
      const row: Database['public']['Tables']['project_segments']['Insert'] = {
        project_id: projectId,
        label: p.label ?? '',
        n_target: p.n_target ?? null,
        n_target_max: p.n_target_max ?? null,
        n_internal_target: p.n_internal_target ?? null,
        n_collected: p.n_collected ?? 0,
        n_actual: p.n_actual ?? null,
        audience: p.audience ?? null,
        audience_size: p.audience_size ?? null,
        sort_order: p.sort_order,
      }
      const { error } = await supabase.from('project_segments').insert(row)
      if (error) throw error
    },
    onError: () => toast("Couldn't add a segment — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

export function useUpdateSegment(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<SegmentInput> }) => {
      // Migration 078's enforce_n_target_range trigger raises when max < min and
      // only sees the columns this PATCH carries, so a one-ended write can fail
      // purely on ordering (widening fails min-first, narrowing fails max-first).
      // NRangeCell always sends the pair; this makes a future caller that forgets
      // fail loudly right here instead of as an intermittent save error nobody
      // can reproduce.
      if (('n_target' in updates) !== ('n_target_max' in updates)) {
        throw new Error('N Target must be saved as a pair (n_target + n_target_max).')
      }
      const { error } = await supabase.from('project_segments').update(updates).eq('id', id)
      if (error) throw error
    },
    // The DB guard writes a readable message ("N Target max (100) cannot be
    // below N Target min (1,000)"), and so does the pair assertion above — pass
    // either straight through rather than burying it under the generic line.
    onError: (e) => {
      const msg = (e as Error)?.message ?? ''
      toast(msg.startsWith('N Target') ? msg : "Couldn't save the segment — please try again.")
    },
    onSettled: () => invalidateAll(qc, projectId),
  })
}

export function useRemoveSegment(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_segments').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't remove the segment — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

/** Collapse back to a single N — removes all segment rows (parent keeps its last total). */
export function useUnsplitProject(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('project_segments').delete().eq('project_id', projectId)
      if (error) throw error
    },
    onError: () => toast("Couldn't merge the segments — please try again."),
    onSettled: () => invalidateAll(qc, projectId),
  })
}

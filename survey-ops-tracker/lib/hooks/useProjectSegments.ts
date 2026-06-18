import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type ProjectSegment = Database['public']['Tables']['project_segments']['Row']
export type SegmentInput = { label: string; n_target: number | null; n_collected: number; n_actual: number | null }

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
    mutationFn: async (seed: { n_target: number | null; n_collected: number; n_actual: number | null }) => {
      const rows = [
        { project_id: projectId, label: '', n_target: seed.n_target, n_collected: seed.n_collected ?? 0, n_actual: seed.n_actual, sort_order: 0 },
        { project_id: projectId, label: '', n_target: null, n_collected: 0, n_actual: null, sort_order: 1 },
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
    mutationFn: async (sortOrder: number) => {
      const { error } = await supabase
        .from('project_segments')
        .insert({ project_id: projectId, label: '', n_collected: 0, sort_order: sortOrder })
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
      const { error } = await supabase.from('project_segments').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the segment — please try again."),
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

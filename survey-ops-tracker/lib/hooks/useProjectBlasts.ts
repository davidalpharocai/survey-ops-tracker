import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type Blast = Database['public']['Tables']['project_blasts']['Row']
type BlastInsert = Database['public']['Tables']['project_blasts']['Insert']
type BlastUpdate = Database['public']['Tables']['project_blasts']['Update']

export function useProjectBlasts(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['blasts', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_blasts')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Blast[]
    },
    // If the migration hasn't run yet the table is absent — fail once and show
    // the "needs migration" fallback rather than retrying forever.
    retry: false,
  })
}

export function useAddBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (b: Omit<BlastInsert, 'project_id'>) => {
      const { error } = await supabase.from('project_blasts').insert({ ...b, project_id: projectId })
      if (error) throw error
    },
    onError: () => toast("Couldn't add the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: BlastUpdate }) => {
      const { error } = await supabase.from('project_blasts').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteBlast(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_blasts').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't delete the blast — please try again."),
    onSettled: () => {
      // A blast write changes actual_spend (via DB trigger), so refresh the
      // detail + board caches too — the hero "Budget left" reads that column.
      qc.invalidateQueries({ queryKey: ['blasts', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

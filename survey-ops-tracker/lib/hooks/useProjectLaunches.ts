import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Tables } from '@/lib/supabase/types'

export type ProjectLaunch = Tables<'project_launches'>

export function useProjectLaunches(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project-launches', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_launches')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as ProjectLaunch[]
    },
    retry: false, // table absent pre-migration → show the fallback, don't spin
  })
}

// Removing a launch cascade-deletes its supplier rows, which changes actual_spend
// (via DB trigger), so refresh the supplier list + the detail/board caches too.
const inval = (qc: QueryClient, projectId: string) => {
  qc.invalidateQueries({ queryKey: ['project-launches', projectId] })
  qc.invalidateQueries({ queryKey: ['project-suppliers', projectId] })
  qc.invalidateQueries({ queryKey: ['project', projectId] })
  qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useAddLaunch(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    // Returns the created launch so the caller can copy the previous launch's
    // supplier rows into it (Add-launch pre-fills the panel).
    mutationFn: async (launch: { label?: string | null; launch_date?: string | null; target?: number | null; created_by: string }) => {
      const { data, error } = await supabase
        .from('project_launches')
        .insert({ ...launch, project_id: projectId })
        .select()
        .single()
      if (error) throw error
      return data as ProjectLaunch
    },
    onError: () => toast("Couldn't add the launch — please try again."),
    onSettled: () => inval(qc, projectId),
  })
}

export function useUpdateLaunch(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { label?: string | null; launch_date?: string | null; target?: number | null } }) => {
      const { error } = await supabase.from('project_launches').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the launch change."),
    onSettled: () => inval(qc, projectId),
  })
}

export function useRemoveLaunch(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_launches').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't remove the launch."),
    onSettled: () => inval(qc, projectId),
  })
}

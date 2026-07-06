import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

type MergeArgs = { survivorId: string; loserId: string; survivorUpdate: Record<string, unknown> }

export function useMergeProjects() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ survivorId, loserId, survivorUpdate }: MergeArgs) => {
      if (Object.keys(survivorUpdate).length > 0) {
        const { error } = await supabase.from('survey_projects').update(survivorUpdate as never).eq('id', survivorId)
        if (error) throw error
      }
      const { error } = await supabase.rpc('merge_projects', { p_survivor: survivorId, p_loser: loserId })
      if (error) throw error
    },
    onError: (e: unknown) => toast(`Couldn't merge — ${(e as Error).message ?? 'please try again.'}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['internal-projects'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

export function useMergeClients() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ survivorId, loserId, survivorUpdate }: MergeArgs) => {
      if (Object.keys(survivorUpdate).length > 0) {
        const { error } = await supabase.from('clients').update(survivorUpdate as never).eq('id', survivorId)
        if (error) throw error
      }
      const { error } = await supabase.rpc('merge_clients', { p_survivor: survivorId, p_loser: loserId })
      if (error) throw error
    },
    onError: (e: unknown) => toast(`Couldn't merge — ${(e as Error).message ?? 'please try again.'}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

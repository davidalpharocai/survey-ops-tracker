import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Tables } from '@/lib/supabase/types'

export type ProjectSupplier = Tables<'project_suppliers'> & { suppliers?: { name: string } | null }

export function useProjectSuppliers(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project-suppliers', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_suppliers')
        .select('*, suppliers(name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as unknown as ProjectSupplier[]
    },
    retry: false, // table absent pre-migration → show the fallback, don't spin
  })
}

const inval = (qc: QueryClient, projectId: string) => qc.invalidateQueries({ queryKey: ['project-suppliers', projectId] })

export function useAddProjectSupplier(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (row: { supplier_id: string; cpi: number; completes_cap: number; created_by: string }) => {
      const { error } = await supabase.from('project_suppliers').insert({ ...row, project_id: projectId })
      if (error) throw error
    },
    onError: () => toast("Couldn't add the supplier to this project."),
    onSettled: () => inval(qc, projectId),
  })
}

export function useUpdateProjectSupplier(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: { cpi?: number; completes_cap?: number } }) => {
      const { error } = await supabase.from('project_suppliers').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the supplier change."),
    onSettled: () => inval(qc, projectId),
  })
}

export function useRemoveProjectSupplier(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_suppliers').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't remove the supplier."),
    onSettled: () => inval(qc, projectId),
  })
}

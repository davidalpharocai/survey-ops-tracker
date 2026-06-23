import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

// The Bid Budget (the allowed $/bid the PM may charge) lives in project_bids as a
// dated change log — each entry is a value + note + who. The current allowance is
// the most recent entry. `amount` is the $/bid; the legacy `blasts` column is unused.
export type BidBudgetEntry = Database['public']['Tables']['project_bids']['Row']

export function useBidBudget(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['bid-budget', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_bids')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as BidBudgetEntry[]
    },
    retry: false,
  })
}

/** The current allowed $/bid — the most recent log entry, or null if none. */
export function currentBidBudget(entries: BidBudgetEntry[] | undefined): number | null {
  return entries && entries.length > 0 ? entries[0].amount : null
}

export function useAddBidBudget(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ amount, note, createdBy }: { amount: number; note: string | null; createdBy: string }) => {
      const { error } = await supabase
        .from('project_bids')
        .insert({ project_id: projectId, amount, note, created_by: createdBy })
      if (error) throw error
    },
    onError: () => toast("Couldn't update the bid budget — please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ['bid-budget', projectId] }),
  })
}

export function useUpdateBidBudget(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, amount, note }: { id: string; amount: number; note: string | null }) => {
      const { error } = await supabase.from('project_bids').update({ amount, note }).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save that entry — please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ['bid-budget', projectId] }),
  })
}

export function useDeleteBidBudget(projectId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_bids').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't delete that entry — please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ['bid-budget', projectId] }),
  })
}

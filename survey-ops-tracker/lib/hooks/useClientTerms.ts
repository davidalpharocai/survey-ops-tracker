import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type ClientTerm = Database['public']['Tables']['client_terms']['Row']
type TermInsert = Database['public']['Tables']['client_terms']['Insert']
type TermUpdate = Database['public']['Tables']['client_terms']['Update']

/**
 * Contracts on a client. The UI says "contract"; the table is `client_terms`.
 *
 * That split is deliberate and matches the house pattern — CCM's UI says
 * "Account" while its column says `client`, and SOCC shows "Archived" for a
 * status stored as `Closed`. David and the CCM export both call these
 * contracts, so the screen does too; renaming the table would touch migration
 * 100, three views and the sales portal for a label.
 *
 * THE DOLLARS ARE NOT HERE. 100 put `dollars_total` in client_term_financials,
 * a separate finance-gated table, precisely because RLS cannot hide a column
 * from a row it admits — putting contract value on client_terms would have
 * handed it to every analyst and every salesperson. useTermDollars below reads
 * it separately and returns null when the caller may not see it, which is
 * indistinguishable from "not set" ON PURPOSE: a UI that could tell those apart
 * would leak the fact that a number exists.
 */
export function useClientTerms(clientId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['client-terms', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_terms')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        // Newest contract first — the current one is what anybody is looking for.
        .order('starts_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ClientTerm[]
    },
    enabled: !!clientId,
    staleTime: 30_000,
  })
}

export function useCreateClientTerm(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (t: Omit<TermInsert, 'client_id'>) => {
      const { data, error } = await supabase
        .from('client_terms')
        .insert({ ...t, client_id: clientId })
        .select()
        .single()
      if (error) throw error
      return data as ClientTerm
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-terms', clientId] })
      toast('Contract added')
    },
    onError: e => toast(`Couldn't add the contract: ${(e as Error).message}`),
  })
}

export function useUpdateClientTerm(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: TermUpdate }) => {
      const { error } = await supabase.from('client_terms').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-terms', clientId] })
      qc.invalidateQueries({ queryKey: ['term-dollars'] })
    },
    onError: e => toast(`Couldn't save: ${(e as Error).message}`),
  })
}

/** Soft delete, matching every other record in this app — a contract that
 *  surveys point at must not vanish out from under them, and 100's
 *  merge_clients re-points terms by hand for the same reason. */
export function useDeleteClientTerm(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('client_terms')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-terms', clientId] })
      toast('Contract removed')
    },
    onError: e => toast(`Couldn't remove it: ${(e as Error).message}`),
  })
}

/**
 * The dollar value of each contract — finance capability only.
 *
 * A denied read comes back as zero rows rather than an error (the policy admits
 * nothing), so this returns an empty map and the UI simply has no dollars to
 * show. `retry: false` because a denial is not a transient failure.
 */
export function useTermDollars(termIds: string[]) {
  const supabase = createClient()
  const key = [...termIds].sort().join(',')
  return useQuery({
    queryKey: ['term-dollars', key],
    queryFn: async (): Promise<Record<string, number | null>> => {
      if (termIds.length === 0) return {}
      const { data, error } = await supabase
        .from('client_term_financials')
        .select('term_id, dollars_total')
        .in('term_id', termIds)
      if (error) return {}
      return Object.fromEntries((data ?? []).map(r => [r.term_id, r.dollars_total]))
    },
    enabled: termIds.length > 0,
    retry: false,
    staleTime: 30_000,
  })
}

export function useSetTermDollars() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ termId, dollars }: { termId: string; dollars: number | null }) => {
      // Upsert on the primary key: a term may or may not already have a
      // financials row, and the caller should not have to know which.
      const { error } = await supabase
        .from('client_term_financials')
        .upsert({ term_id: termId, dollars_total: dollars }, { onConflict: 'term_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['term-dollars'] }),
    onError: e => toast(`Couldn't save the contract value: ${(e as Error).message}`),
  })
}

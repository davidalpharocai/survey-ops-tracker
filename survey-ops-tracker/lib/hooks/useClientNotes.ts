import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type ClientNote = Database['public']['Tables']['client_notes']['Row']

export function useClientNotes(clientId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['client-notes', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_notes')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ClientNote[]
    },
    enabled: !!clientId,
    // If the migration hasn't been applied the table doesn't exist — fail once
    // and show the fallback note instead of hammering retries.
    retry: false,
  })
}

// All note mutations update the UI instantly (optimistic) and reconcile with the
// database in the background; on failure the change rolls back.
export function useClientNoteMutations(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  const key = ['client-notes', clientId]

  function optimistic(mutate: (notes: ClientNote[]) => ClientNote[]) {
    const previous = qc.getQueryData<ClientNote[]>(key)
    qc.setQueryData<ClientNote[]>(key, old => mutate(old ?? []))
    return previous
  }

  const add = useMutation({
    mutationFn: async ({ body, createdBy }: { body: string; createdBy: string }) => {
      const { error } = await supabase.from('client_notes').insert({ client_id: clientId, body, created_by: createdBy })
      if (error) throw error
    },
    onMutate: async ({ body, createdBy }) => {
      await qc.cancelQueries({ queryKey: key })
      return optimistic(notes => [
        {
          id: `optimistic-${Math.random().toString(36).slice(2)}`,
          client_id: clientId,
          body,
          created_by: createdBy,
          created_at: new Date().toISOString(),
        } as ClientNote,
        ...notes,
      ])
    },
    onError: (_e, _v, previous) => {
      qc.setQueryData(key, previous)
      toast("Couldn't add that note — it was removed.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const update = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const { error } = await supabase.from('client_notes').update({ body }).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: key })
      return optimistic(notes => notes.map(n => (n.id === id ? { ...n, body } : n)))
    },
    onError: (_e, _v, previous) => {
      qc.setQueryData(key, previous)
      toast("Couldn't save that note — it was reverted.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_notes').delete().eq('id', id)
      if (error) throw error
    },
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: key })
      return optimistic(notes => notes.filter(n => n.id !== id))
    },
    onError: (_e, _v, previous) => {
      qc.setQueryData(key, previous)
      toast("Couldn't delete that note — it was restored.")
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  return { add, update, remove }
}

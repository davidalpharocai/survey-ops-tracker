import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type ClientContact = Database['public']['Tables']['client_contacts']['Row']
type ContactInsert = Database['public']['Tables']['client_contacts']['Insert']
type ContactUpdate = Database['public']['Tables']['client_contacts']['Update']

/** All contacts for a client (archived included), ordered by name. The picker
 *  filters to active; a project row can still resolve an archived contact. */
export function useClientContacts(clientId: string | null | undefined) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['client-contacts', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_contacts')
        .select('*')
        .eq('client_id', clientId!)
        .order('last_name')
        .order('first_name')
      if (error) throw error
      return data as ClientContact[]
    },
    enabled: !!clientId,
  })
}

export type AllContact = {
  id: string
  first_name: string | null
  last_name: string | null
  title: string | null
  client_id: string
  clients: { name: string } | null
}

/** Every active contact across all clients (+ its client's name) — for the nav search. */
export function useAllContacts() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['all-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_contacts')
        .select('id, first_name, last_name, title, client_id, archived, clients(name)')
        .eq('archived', false)
      if (error) throw error
      return (data ?? []) as unknown as AllContact[]
    },
    staleTime: 60_000,
  })
}

export function useCreateClientContact(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (contact: Omit<ContactInsert, 'client_id'>) => {
      const { data, error } = await supabase
        .from('client_contacts')
        .insert({ ...contact, client_id: clientId })
        .select()
        .single()
      if (error) throw error
      return data as ClientContact
    },
    onError: () => toast("Couldn't add the contact — please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ['client-contacts', clientId] }),
  })
}

export function useUpdateClientContact(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ContactUpdate }) => {
      const { error } = await supabase.from('client_contacts').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the contact — please try again."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['client-contacts', clientId] })
      // A name edit should reflect on any project page showing this contact.
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

export function useArchiveClientContact(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from('client_contacts').update({ archived }).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't update the contact — please try again."),
    onSettled: () => qc.invalidateQueries({ queryKey: ['client-contacts', clientId] }),
  })
}

/** Hard delete — for genuine mistakes/dupes. The FK is ON DELETE SET NULL, so any
 *  project that pointed here keeps its requested_by_name snapshot for history. */
export function useDeleteClientContact(clientId: string) {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_contacts').delete().eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't delete the contact — please try again."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['client-contacts', clientId] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
  })
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import { firmNameFrom } from '@/lib/utils/clientName'
import type { Database } from '@/lib/supabase/types'

export type Client = Database['public']['Tables']['clients']['Row']
export type NewClientInput = {
  name: string
  compliance_before_fielding?: boolean
  compliance_after_fielding?: boolean
  compliance_contact?: string | null
  compliance_notes?: string | null
}

export function useClients() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return data as Client[]
    },
  })
}

export function useClient(id: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return data as Client | null
    },
    enabled: !!id,
  })
}

export function useUpdateClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Client> }) => {
      const { error } = await supabase.from('clients').update(updates).eq('id', id)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the client — please try again."),
    onSettled: (_d, _e, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', id] })
    },
  })
}

/**
 * Rename a client and keep the denormalized `client` text on its projects in
 * sync — projects store "FIRM - Contact", so we swap the firm part and preserve
 * any " - Contact" suffix. (Rename is rare and low-volume; done client-side.)
 */
export function useRenameClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('clients').update({ name }).eq('id', id)
      if (error) throw error

      const { data: projects, error: pErr } = await supabase
        .from('survey_projects')
        .select('id, client')
        .eq('client_id', id)
      if (pErr) throw pErr

      for (const p of projects ?? []) {
        const cur = p.client ?? ''
        const idx = cur.indexOf(' - ')
        const nextText = idx === -1 ? name : name + cur.slice(idx)
        if (nextText !== cur) {
          const { error: uErr } = await supabase
            .from('survey_projects')
            .update({ client: nextText })
            .eq('id', p.id)
          if (uErr) throw uErr
        }
      }
    },
    onError: () => toast("Couldn't rename the client — please try again."),
    onSettled: (_d, _e, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      queryClient.invalidateQueries({ queryKey: ['client-projects', id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['internal-projects'] })
    },
  })
}

/**
 * Create a client directly (the "+ New Client" modal, and any future
 * pick-or-create pickers). Deliberately does NOT set `code` — migration
 * 047's `assign_client_code` trigger assigns the next "Cl#####" on insert.
 * Until that migration is applied, the insert still succeeds; the row just
 * has a null code until it's applied.
 */
export function useCreateClient() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewClientInput) => {
      const name = firmNameFrom(input.name)
      const { data, error } = await supabase
        .from('clients')
        .insert({
          name,
          compliance_before_fielding: input.compliance_before_fielding,
          compliance_after_fielding: input.compliance_after_fielding,
          compliance_contact: input.compliance_contact ?? null,
          compliance_notes: input.compliance_notes ?? null,
        })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') throw new Error(`A client named "${name}" already exists.`)
        throw error
      }
      return data as Client
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
  })
}

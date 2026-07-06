import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

export type Client = Database['public']['Tables']['clients']['Row']

export function useClients() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name')
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

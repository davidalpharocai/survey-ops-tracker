import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

export type ContactProjectRow = {
  id: string
  project_code: string | null
  project_name: string
}

/** Every project that named this contact as the requester — for the
 *  Requested-by popover's "Projects" list. Analysts can read all projects,
 *  so there's no RLS concern here. */
export function useProjectsByContact(contactId: string | null) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['projects-by-contact', contactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select('id, project_code, project_name')
        .eq('requested_by_contact_id', contactId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ContactProjectRow[]
    },
    enabled: !!contactId,
  })
}

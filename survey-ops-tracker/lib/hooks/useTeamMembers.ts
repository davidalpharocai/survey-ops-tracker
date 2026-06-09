import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type TeamMember = Database['public']['Tables']['team_members']['Row']

export function useTeamMembers() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['team-members'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_members')
        .select('*')
        .order('name')
      if (error) throw error
      return data
    },
  })
}

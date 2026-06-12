import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type TeamMember = Database['public']['Tables']['team_members']['Row']

/**
 * Members who can be assigned to projects. Former employees stay in the
 * roster (their names still resolve on historical projects) but are hidden
 * from assignment dropdowns — marked by "(former" in their name.
 */
export function assignableMembers(members: TeamMember[]): TeamMember[] {
  return members.filter(m => !m.name.toLowerCase().includes('(former'))
}

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

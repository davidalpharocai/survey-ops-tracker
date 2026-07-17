import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type TeamMember = Database['public']['Tables']['team_members']['Row']

/** Two-letter initials from a full name ("Brooke Smith" -> "BS"); a sensible
 *  default the add form pre-fills (still editable). */
export function suggestInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

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

async function postJson(method: 'POST' | 'PATCH', body: unknown) {
  const res = await fetch('/api/admin/team-members', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Something went wrong. Please try again.')
  return json.member as TeamMember
}

/** Add a new roster member (becomes selectable as a project captain). */
export function useAddTeamMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (m: { name: string; email: string; initials: string }) => postJson('POST', m),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-members'] }),
  })
}

/** Edit a roster member's display name / initials. */
export function useUpdateTeamMember() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (m: { id: string; name?: string; initials?: string }) => postJson('PATCH', m),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-members'] }),
  })
}

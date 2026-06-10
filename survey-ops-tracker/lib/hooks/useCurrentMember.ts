import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

// The team_members row matching the logged-in user (by email), or null
export function useCurrentMember() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['current-member'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) return null
      const { data } = await supabase
        .from('team_members')
        .select('id, name, initials, email')
        .eq('email', user.email)
        .maybeSingle()
      return data ?? null
    },
    staleTime: 5 * 60_000,
  })
}

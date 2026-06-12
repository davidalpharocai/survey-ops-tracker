import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useCurrentMember } from './useCurrentMember'

type SeenRow = { project_id: string; seen_at: string }

// The logged-in user's auth identity — email keys project_seen rows,
// uid identifies who made assignments (captain_assigned_by).
function useAuthIdentity() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['auth-identity'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      return user ? { email: user.email ?? null, uid: user.id } : null
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * All project_seen rows for the logged-in user — which projects they've
 * opened, and when. Used to decide whether a freshly assigned project still
 * shows its NEW! badge. retry: false + select-only so a missing table
 * (pre-migration) degrades to "nothing seen" instead of breaking views.
 */
export function useSeenProjects() {
  const supabase = createClient()
  const { data: identity } = useAuthIdentity()
  const email = identity?.email ?? null
  return useQuery({
    queryKey: ['seen', email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_seen')
        .select('project_id, seen_at')
        .eq('user_email', email!)
      if (error) throw error
      return (data ?? []) as SeenRow[]
    },
    enabled: !!email,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Returns a predicate: is this project "new for me"? True when the project
 * is captained by the current user, the assignment is stamped, was made by
 * someone ELSE (self-assignments don't count), and the user hasn't opened
 * the project since that assignment.
 */
export function useIsNewForMe() {
  const { data: currentMember } = useCurrentMember()
  const { data: identity } = useAuthIdentity()
  const { data: seenRows } = useSeenProjects()

  const seenAtById = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of seenRows ?? []) map.set(row.project_id, row.seen_at)
    return map
  }, [seenRows])

  return useCallback(
    (p: {
      id: string
      captain?: { id: string } | null
      captain_assigned_at?: string | null
      captain_assigned_by?: string | null
    }): boolean => {
      if (!currentMember) return false
      if (p.captain?.id !== currentMember.id) return false
      if (!p.captain_assigned_at) return false
      // You assigned it to yourself — nothing to announce
      if (p.captain_assigned_by && identity?.uid && p.captain_assigned_by === identity.uid) {
        return false
      }
      const seenAt = seenAtById.get(p.id)
      if (!seenAt) return true
      return new Date(seenAt).getTime() < new Date(p.captain_assigned_at).getTime()
    },
    [currentMember, identity, seenAtById]
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

/**
 * When N Collected was last changed on this project.
 *
 * David, 2026-09-23: "we should add a time stamp to when the N was last
 * updated." Asked while looking at a survey whose N read 7 in one place and 6 in
 * another -- a number with no date on it gives a reader no way to tell a figure
 * that is current from one that stopped being true a week ago.
 *
 * The sales tier already had this: migration 111 built
 * sales_n_collected_freshness for exactly this line, and the sales survey page
 * has shown "updated <date>" under N Collected since. This is the analyst half
 * of the same idea, reading the same source -- the audit log -- so the two
 * cannot report different dates for the same edit.
 *
 * NO ROW MEANS NEVER RECORDED, WHICH IS NOT THE SAME AS ZERO. A survey nobody
 * has touched returns null here and the caller shows nothing, rather than
 * dating the number to the project's creation and implying someone checked.
 *
 * KEYED UNDER ['project', id] ON PURPOSE. RealtimeSync invalidates that key
 * whenever the row changes, and TanStack matches by prefix, so this refetches
 * with the number it annotates instead of drifting behind it.
 */
export function useNCollectedUpdatedAt(projectId: string | null | undefined) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project', projectId, 'n-collected-updated'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('project_audit')
        .select('changed_at')
        .eq('project_id', projectId as string)
        .eq('field', 'n_collected')
        .order('changed_at', { ascending: false })
        .limit(1)
      // A failed read must not render as "never updated" -- that is a statement
      // about the data, and this would be a statement about the network.
      if (error) return null
      return data?.[0]?.changed_at ?? null
    },
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

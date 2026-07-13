'use client'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { Database } from '@/lib/supabase/types'

export type RerunSnapshot = Database['public']['Tables']['rerun_snapshot']['Row']

// Reads the sheet-mirror table directly via the browser client (RLS: analysts
// only). The overdue/upcoming/done bucketing is a read-time decision in the page
// against next_run_date, so the radar ages correctly between syncs.
export function useReruns() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['rerun-snapshot'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rerun_snapshot')
        .select('*')
        .order('next_run_date', { ascending: true, nullsFirst: false })
      if (error) {
        // Before migration 049 is applied the table doesn't exist yet — treat
        // that as "no data yet" (friendly empty state) rather than a hard error.
        // Any other failure still surfaces.
        if (error.code === '42P01' || /does not exist/i.test(error.message)) return []
        throw error
      }
      return data as RerunSnapshot[]
    },
    staleTime: 60_000,
  })
}

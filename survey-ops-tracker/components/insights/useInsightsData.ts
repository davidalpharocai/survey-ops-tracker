'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { loadInsightsRaw, type InsightsRaw } from '@/lib/insights/load'

/**
 * The one read behind /insights. Every column it asks for is declared in
 * lib/insights/load.ts and none of them is a money column (a test holds that
 * line). The load never throws for a single table — a failed table comes back
 * in `blocked`, so the page can name it instead of drawing zeros.
 */
export function useInsightsData() {
  return useQuery<InsightsRaw>({
    // A new key: the old ['insights'] cache held a different row shape.
    queryKey: ['insights', 'dashboard-v2'],
    queryFn: () => loadInsightsRaw(createClient()),
    staleTime: 60_000,
  })
}

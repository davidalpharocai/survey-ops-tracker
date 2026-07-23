import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { StageHistoryRow } from '@/lib/utils/stageTiming'

/**
 * Raw stage-history rows for a project (migration 062 `project_stage_history`),
 * ordered oldest-first so `stageDurations` can walk them directly. The table
 * only starts logging once a project advances into Doc Programming, and may
 * not exist at all before 062 is applied — both cases surface as an empty
 * array rather than an error state.
 */
export function useStageHistory(projectId: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['stage-history', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_stage_history')
        .select('stage, entered_at')
        .eq('project_id', projectId)
        .order('entered_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as StageHistoryRow[]
    },
    // If the migration hasn't run yet the table is absent — fail once and let
    // the panel fall back to its empty state rather than retrying forever.
    retry: false,
    enabled: !!projectId,
  })
}

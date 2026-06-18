import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { SprintConfig } from '@/lib/utils/sprints'

// The single sprint-cadence row (id = 1). retry:false so a pre-migration DB
// shows the fallback instead of hammering retries.
export function useSprintConfig() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['sprint-config'],
    queryFn: async (): Promise<SprintConfig | null> => {
      const { data, error } = await supabase
        .from('sprint_config')
        .select('anchor_date, length_days')
        .eq('id', 1)
        .maybeSingle()
      if (error) throw error
      return data as SprintConfig | null
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useUpdateSprintConfig() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (anchor_date: string) => {
      const { error } = await supabase
        .from('sprint_config')
        .update({ anchor_date })
        .eq('id', 1)
      if (error) throw error
    },
    onError: () => toast("Couldn't save the sprint cadence — please try again."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['sprint-config'] }),
  })
}

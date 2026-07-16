import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useProjects } from './useProjects'
import { useCurrentMember } from './useCurrentMember'
import {
  deriveEvents,
  bucketByDate,
  type CalendarFilterState,
  type CalendarReminder,
} from '@/lib/calendar/events'

// Re-export the pure derivation layer so callers can import everything calendar
// from one place; the logic itself lives in lib/calendar/events.ts (React-free
// so it's unit-testable).
export * from '@/lib/calendar/events'

/**
 * The caller's own open reminders. Degrades gracefully — if the table/permission
 * isn't there the calendar still renders (reminders just don't show), matching
 * the fail-soft pattern used elsewhere (e.g. the AppMenu badges).
 */
function useMyReminders() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['calendar-reminders'],
    queryFn: async (): Promise<CalendarReminder[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return []
      const { data, error } = await supabase
        .from('reminders')
        .select('id, text, due_date, project_id')
        .eq('user_id', user.id)
        .eq('done', false)
      if (error) return []
      return (data ?? []) as CalendarReminder[]
    },
    staleTime: 60_000,
  })
}

/**
 * Derives the calendar's events from the (already React-Query-cached) projects
 * plus the caller's reminders, applies the active filters, and returns them both
 * flat (chronological-ready) and bucketed by YYYY-MM-DD for the month grid.
 */
export function useCalendarEvents(filters: CalendarFilterState) {
  const projectsQ = useProjects()
  const remindersQ = useMyReminders()
  const { data: me } = useCurrentMember()

  const events = useMemo(
    () => deriveEvents(projectsQ.data ?? [], remindersQ.data ?? [], filters, me?.id ?? null),
    [projectsQ.data, remindersQ.data, filters, me?.id]
  )
  const byDate = useMemo(() => bucketByDate(events), [events])

  return {
    events,
    byDate,
    isLoading: projectsQ.isLoading,
    error: projectsQ.error as Error | null,
  }
}

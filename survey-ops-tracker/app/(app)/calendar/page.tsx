'use client'
import { useEffect, useMemo, useState } from 'react'
import { startOfMonth } from 'date-fns'
import { CalendarFilters } from '@/components/calendar/CalendarFilters'
import { CalendarGrid } from '@/components/calendar/CalendarGrid'
import { CalendarAgenda } from '@/components/calendar/CalendarAgenda'
import { Skeleton } from '@/components/shared/Skeleton'
import {
  useCalendarEvents,
  DEFAULT_FILTERS,
  type CalendarFilterState,
} from '@/lib/hooks/useCalendarEvents'

const STORAGE_KEY = 'sot.calendarFilters'

/** Merge stored filters over the defaults so a new field can be added safely. */
function mergeFilters(stored: unknown): CalendarFilterState {
  if (!stored || typeof stored !== 'object') return DEFAULT_FILTERS
  const s = stored as Partial<CalendarFilterState>
  return {
    ...DEFAULT_FILTERS,
    ...s,
    types: { ...DEFAULT_FILTERS.types, ...(s.types ?? {}) },
    statusScope: { ...DEFAULT_FILTERS.statusScope, ...(s.statusScope ?? {}) },
  }
}

export default function CalendarPage() {
  const [filters, setFilters] = useState<CalendarFilterState>(DEFAULT_FILTERS)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))

  // Load persisted filters after mount (keeps SSR markup stable).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setFilters(mergeFilters(JSON.parse(raw)))
    } catch {
      // corrupted storage — defaults are fine
    }
  }, [])

  function updateFilters(next: CalendarFilterState) {
    setFilters(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // storage full / unavailable — filters still apply this session
    }
  }

  const { byDate, events, isLoading, error } = useCalendarEvents(filters)
  const total = useMemo(() => events.length, [events])

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Calendar</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isLoading
            ? 'Loading dated events…'
            : `${total} dated event${total === 1 ? '' : 's'} in view — deadlines, deliveries, launches, reruns, and your reminders.`}
        </p>
      </div>

      <CalendarFilters filters={filters} onChange={updateFilters} />

      {error ? (
        <div className="bg-card border border-border shadow-sm rounded-xl p-4">
          <p className="text-sm text-destructive">
            Couldn&apos;t load projects: {String(error.message)}
          </p>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-[560px] w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* Month grid on wide screens; agenda fallback on narrow (the grid
              doesn't shrink to phones). */}
          <div className="hidden lg:block">
            <CalendarGrid byDate={byDate} viewMonth={viewMonth} onMonthChange={setViewMonth} />
          </div>
          <div className="lg:hidden">
            <CalendarAgenda byDate={byDate} />
          </div>
        </>
      )}
    </div>
  )
}

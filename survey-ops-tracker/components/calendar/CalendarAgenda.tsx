'use client'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { EVENT_TYPE_META, type CalendarEvent } from '@/lib/calendar/events'

const URGENCY_RING: Record<string, string> = {
  overdue: 'ring-1 ring-red-500',
  tomorrow: 'ring-1 ring-orange-500',
  twodays: 'ring-1 ring-amber-400',
}

function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

interface CalendarAgendaProps {
  byDate: Record<string, CalendarEvent[]>
}

/**
 * Chronological, grouped-by-day agenda — the mobile / narrow fallback (the grid
 * doesn't shrink to phones). Today first, then upcoming days ascending.
 */
export function CalendarAgenda({ byDate }: CalendarAgendaProps) {
  const router = useRouter()
  const today = todayKey()
  const days = Object.keys(byDate)
    .filter(d => d >= today)
    .sort()

  if (days.length === 0) {
    return (
      <div className="bg-card border border-border shadow-sm rounded-xl p-4">
        <p className="text-sm text-muted-foreground">
          Nothing coming up. Past-due items still show on the month grid.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map(day => {
        const date = parseISO(day)
        const isToday = day === today
        return (
          <section key={day}>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
              {isToday ? 'Today · ' : ''}
              {format(date, 'EEEE, MMMM d')}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {byDate[day].map(e => {
                const meta = EVENT_TYPE_META[e.type]
                const clickable = !!e.projectId
                const ring = e.urgency ? URGENCY_RING[e.urgency] ?? '' : ''
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => clickable && router.push(`/projects/${e.projectId}`)}
                      className={`w-full flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors ${
                        clickable ? 'hover:border-ring cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium shrink-0 ${meta.chip} ${ring}`}
                      >
                        <span aria-hidden="true">{meta.icon}</span>
                        {meta.short}
                      </span>
                      <span className="text-sm text-foreground truncate min-w-0">{e.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

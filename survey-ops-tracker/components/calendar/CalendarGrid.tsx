'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  format,
  isSameMonth,
  isSameDay,
} from 'date-fns'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  EVENT_TYPE_META,
  splitDay,
  type CalendarEvent,
} from '@/lib/calendar/events'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Urgency ring for due/deliver chips so overdue/soon still shouts on the grid.
const URGENCY_RING: Record<string, string> = {
  overdue: 'ring-1 ring-red-500',
  tomorrow: 'ring-1 ring-orange-500',
  twodays: 'ring-1 ring-amber-400',
}

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function EventChip({
  event,
  onNavigate,
  compact = true,
}: {
  event: CalendarEvent
  onNavigate: (e: CalendarEvent) => void
  compact?: boolean
}) {
  const meta = EVENT_TYPE_META[event.type]
  const clickable = !!event.projectId
  const ring = event.urgency ? URGENCY_RING[event.urgency] ?? '' : ''
  const label = compact ? event.title : `${meta.short}: ${event.title}`
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={ev => {
        ev.stopPropagation()
        if (clickable) onNavigate(event)
      }}
      title={`${meta.short} · ${event.title}${clickable ? '' : ' (no linked project)'}`}
      className={`w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] leading-tight truncate transition-colors ${meta.chip} ${ring} ${
        clickable ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'
      }`}
    >
      <span aria-hidden="true" className="shrink-0">
        {meta.icon}
      </span>
      <span className="truncate min-w-0">{label}</span>
    </button>
  )
}

function DayPopover({
  day,
  events,
  onClose,
  onNavigate,
}: {
  day: Date
  events: CalendarEvent[]
  onClose: () => void
  onNavigate: (e: CalendarEvent) => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Events on ${format(day, 'EEEE, MMMM d, yyyy')}`}
    >
      <div
        className="w-full max-w-sm bg-popover border border-border rounded-xl shadow-xl p-4 flex flex-col gap-2"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {format(day, 'EEEE, MMMM d')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground rounded px-1.5 leading-none"
          >
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {events.map(e => (
            <li key={e.id}>
              <EventChip event={e} onNavigate={onNavigate} compact={false} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

interface CalendarGridProps {
  byDate: Record<string, CalendarEvent[]>
  viewMonth: Date
  onMonthChange: (d: Date) => void
}

export function CalendarGrid({ byDate, viewMonth, onMonthChange }: CalendarGridProps) {
  const router = useRouter()
  const [popoverDay, setPopoverDay] = useState<Date | null>(null)

  const navigate = (e: CalendarEvent) => {
    if (e.projectId) router.push(`/projects/${e.projectId}`)
  }

  const monthStart = startOfMonth(viewMonth)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 })
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const today = new Date()

  return (
    <div className="flex flex-col gap-3">
      {/* Month nav */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground tabular-nums">
          {format(viewMonth, 'MMMM yyyy')}
        </h2>
        <InfoTooltip text="Every dated project event (due, deliver, launch, rerun) plus your own reminders, on a month grid. Click an event to open its project; click a day to see all of it." />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(monthStart, -1))}
            aria-label="Previous month"
            className="border border-border text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-2.5 py-1 transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
            className="border border-border text-xs text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-3 py-1.5 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(addMonths(monthStart, 1))}
            aria-label="Next month"
            className="border border-border text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-2.5 py-1 transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px text-[11px] uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS.map(w => (
          <div key={w} className="px-2 py-1 text-center">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
        {days.map(day => {
          const key = dayKey(day)
          const dayEvents = byDate[key] ?? []
          const { shown, overflow } = splitDay(dayEvents)
          const inMonth = isSameMonth(day, monthStart)
          const isToday = isSameDay(day, today)
          const hasEvents = dayEvents.length > 0
          return (
            <div
              key={key}
              onClick={() => hasEvents && setPopoverDay(day)}
              className={`min-h-[92px] p-1.5 flex flex-col gap-1 transition-colors ${
                inMonth ? 'bg-card' : 'bg-muted/40'
              } ${hasEvents ? 'cursor-pointer hover:bg-accent/50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs tabular-nums ${
                    isToday
                      ? 'flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-semibold'
                      : inMonth
                        ? 'text-foreground/80'
                        : 'text-muted-foreground/50'
                  }`}
                >
                  {format(day, 'd')}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {shown.map(e => (
                  <EventChip key={e.id} event={e} onNavigate={navigate} />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={ev => {
                      ev.stopPropagation()
                      setPopoverDay(day)
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground text-left px-1.5"
                  >
                    ＋{overflow} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {popoverDay && (
        <DayPopover
          day={popoverDay}
          events={byDate[dayKey(popoverDay)] ?? []}
          onClose={() => setPopoverDay(null)}
          onNavigate={e => {
            setPopoverDay(null)
            navigate(e)
          }}
        />
      )}
    </div>
  )
}

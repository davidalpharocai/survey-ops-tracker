'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { seriesMonthEvents, type RerunMonthEvent } from '@/lib/reruns/monthEvents'
import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'

// A rerun-specific month grid — the same date-fns grid math + controls pattern
// as components/calendar/CalendarGrid.tsx, but keyed off the first-class
// rerun_series_status view (each cell = a series' computed next-wave date) and
// linking to the series record instead of a project. Deliberately NOT importing
// CalendarGrid (coupled to CalendarEvent + /projects nav).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_CHIPS = 3

function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

function SeriesChip({ e }: { e: RerunMonthEvent }) {
  const label = `${e.client} — ${e.survey_name}`
  const overdueNote = e.is_overdue
    ? `⚠ overdue${typeof e.days_to_next === 'number' ? ` ${Math.abs(e.days_to_next)}d` : ''} · `
    : ''
  return (
    <Link
      href={`/reruns/series/${e.seriesId}`}
      title={`${overdueNote}${label} — open the rerun series record`}
      onClick={(ev) => ev.stopPropagation()}
      className={`w-full flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-[12px] leading-tight truncate transition-colors hover:brightness-95 ${
        e.is_overdue
          ? 'bg-red-500/15 text-red-700 dark:text-red-300'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      }`}
    >
      <BaseTypeTag baseType={e.base_type} rerunService={e.rerun_service} className="shrink-0 px-1 py-0 text-[10px]" />
      <span className="truncate min-w-0">{label}</span>
    </Link>
  )
}

function DayPopover({
  day,
  events,
  onClose,
}: {
  day: Date
  events: RerunMonthEvent[]
  onClose: () => void
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
      aria-label={`Reruns due ${format(day, 'EEEE, MMMM d, yyyy')}`}
    >
      <div
        className="w-full max-w-sm bg-popover border border-border rounded-xl shadow-xl p-4 flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{format(day, 'EEEE, MMMM d')}</h3>
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
          {events.map((e) => (
            <li key={e.seriesId}>
              <SeriesChip e={e} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function RerunMonthView({ series }: { series: SeriesListRow[] }) {
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [popoverDay, setPopoverDay] = useState<Date | null>(null)

  const byDate = useMemo(() => seriesMonthEvents(series), [series])

  const monthStart = startOfMonth(viewMonth)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
  const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 0 })
  const days: Date[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const today = new Date()
  // Any reruns land in the FOCUS month? Drives the empty-state line. Only
  // in-month days count — a rerun on an adjacent-month spillover cell must not
  // suppress the "No reruns scheduled in {month}" message for an empty focus month.
  const monthHasReruns = days.some(
    (d) => isSameMonth(d, monthStart) && (byDate[dayKey(d)]?.length ?? 0) > 0
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Month nav */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground tabular-nums">{format(viewMonth, 'MMMM yyyy')}</h2>
        <InfoTooltip text="Each first-class rerun series on its computed next-wave date (effective_next). Ad-hoc series with no cadence, paused, and ended series don't appear. Click one to open its record." />
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(monthStart, -1))}
            aria-label="Previous month"
            className="border border-border text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-2.5 py-1 transition-colors"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setViewMonth(startOfMonth(new Date()))}
            className="border border-border text-xs text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-3 py-1.5 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setViewMonth(addMonths(monthStart, 1))}
            aria-label="Next month"
            className="border border-border text-muted-foreground hover:text-foreground hover:border-ring rounded-lg px-2.5 py-1 transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px text-[12px] uppercase tracking-wider text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-1 text-center">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
        {days.map((day) => {
          const key = dayKey(day)
          const dayEvents = byDate[key] ?? []
          const shown = dayEvents.length > MAX_CHIPS ? dayEvents.slice(0, MAX_CHIPS - 1) : dayEvents
          const overflow = dayEvents.length - shown.length
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
                {shown.map((e) => (
                  <SeriesChip key={e.seriesId} e={e} />
                ))}
                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation()
                      setPopoverDay(day)
                    }}
                    className="text-[12px] text-muted-foreground hover:text-foreground text-left px-1.5"
                  >
                    ＋{overflow} more
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {!monthHasReruns && (
        <p className="text-sm text-muted-foreground">
          No reruns scheduled in {format(viewMonth, 'MMMM yyyy')}. Cadenced series show up on their next-wave date; use ‹ ›
          to look ahead.
        </p>
      )}

      {popoverDay && (
        <DayPopover day={popoverDay} events={byDate[dayKey(popoverDay)] ?? []} onClose={() => setPopoverDay(null)} />
      )}
    </div>
  )
}

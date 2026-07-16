import { differenceInCalendarDays, parseISO, isAfter, isBefore, startOfDay, endOfMonth } from 'date-fns'

/** Relative age for queue items: "today" / "1d ago" / "6d ago". */
export function daysAgoLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return days <= 0 ? 'today' : `${days}d ago`
}

/** Whole days since an ISO timestamp (0 if in the future) — for "oldest Xd". */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

export type DueDateStatus = 'overdue' | 'soon' | 'normal' | null

export function getDueDateStatus(dueDate: string | null): DueDateStatus {
  if (!dueDate) return null
  const today = startOfDay(new Date())
  const due = startOfDay(parseISO(dueDate))
  if (!isAfter(due, today)) return 'overdue'
  if (differenceInCalendarDays(due, today) <= 3) return 'soon'
  return 'normal'
}

export type DueUrgency = 'overdue' | 'tomorrow' | 'twodays' | 'normal' | null

// Granular urgency for kanban card borders:
// overdue = due today or already past, tomorrow = due in 1 day, twodays = due in 2 days
export function getDueUrgency(dueDate: string | null): DueUrgency {
  if (!dueDate) return null
  const today = startOfDay(new Date())
  const due = startOfDay(parseISO(dueDate))
  const days = differenceInCalendarDays(due, today)
  if (days <= 0) return 'overdue'
  if (days === 1) return 'tomorrow'
  if (days === 2) return 'twodays'
  return 'normal'
}

export type DueFilterPreset =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'twodays'
  | 'week'
  | 'month'
  | 'none'
  | 'custom'

// Predicate for the Due filter dropdown (board + list). Deliberately separate
// from getDueUrgency, which drives the colored due-date edges and only
// distinguishes overdue/tomorrow/twodays/normal — this covers the fuller set
// of filter presets plus an arbitrary custom [from, to] range. "Today" uses
// the same local-midnight notion of "now" as getDueUrgency so the filter and
// the card colors never disagree about what day it is.
export function matchesDuePreset(
  dueDate: string | null,
  preset: string | null,
  from?: string | null,
  to?: string | null
): boolean {
  if (!preset) return true
  if (preset === 'none') return !dueDate
  if (!dueDate) return false
  const today = startOfDay(new Date())
  const due = startOfDay(parseISO(dueDate))
  const days = differenceInCalendarDays(due, today)
  switch (preset) {
    case 'overdue':
      // Today or earlier — matches getDueUrgency's overdue bucket and the
      // "⚠ Overdue" card badge, so the filter and the card colors agree. The
      // separate 'today' preset narrows to just today.
      return days <= 0
    case 'today':
      return days === 0
    case 'tomorrow':
      return days === 1
    case 'twodays':
      return days === 2
    case 'week':
      return days >= 0 && days <= 6
    case 'month':
      return !isBefore(due, today) && !isAfter(due, endOfMonth(today))
    case 'custom': {
      if (from && isBefore(due, startOfDay(parseISO(from)))) return false
      if (to && isAfter(due, startOfDay(parseISO(to)))) return false
      return true
    }
    default:
      return true
  }
}

// Days a project is past its due date (0 if not past / no date). Used to
// escalate the overdue treatment for badly-overdue work.
export function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0
  const today = startOfDay(new Date())
  const due = startOfDay(parseISO(dueDate))
  const d = differenceInCalendarDays(today, due)
  return d > 0 ? d : 0
}

// A project is "badly overdue" past this many days — escalates to the heavy
// full-red treatment so the worst items still stand out among many overdue.
export const BADLY_OVERDUE_DAYS = 7

// Shared word-label prefix for the due-date cell/footer, so urgency isn't
// conveyed by color alone — and board and list read identically.
export function urgencyPrefix(urgency: DueUrgency, dueDate: string | null): string {
  if (urgency === 'overdue') {
    const d = daysOverdue(dueDate)
    return d > 1 ? `⚠ ${d}d overdue · ` : '⚠ Overdue · '
  }
  if (urgency === 'tomorrow') return 'Due tomorrow · '
  if (urgency === 'twodays') return 'Due in 2d · '
  return ''
}

export function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function autoStamp(
  userName: string,
  existing: string | null,
  newText: string
): string {
  const today = new Date().toISOString().split('T')[0]
  const entry = `[${today}] ${userName}: ${newText}`
  return existing ? `${existing}\n${entry}` : entry
}

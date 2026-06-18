import { differenceInCalendarDays, parseISO, isAfter, startOfDay } from 'date-fns'

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

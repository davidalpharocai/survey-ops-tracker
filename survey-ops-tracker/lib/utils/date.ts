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

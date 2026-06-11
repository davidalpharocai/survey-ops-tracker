/**
 * Flags projects that look abandoned: open and active, but with no due date,
 * no launch date, and no record updates in 30+ days. Surfaced as a "Stale?"
 * chip on the board so someone reviews whether the project is still real.
 */
export type StaleInput = {
  status: string
  phase: string
  due_date: string | null
  launch_date: string | null
  updated_at: string
}

export const STALE_AFTER_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function isStale(p: StaleInput): boolean {
  if (p.status !== 'Open' || p.phase !== 'Active') return false
  if (p.due_date || p.launch_date) return false
  const ageMs = Date.now() - new Date(p.updated_at).getTime()
  return ageMs > STALE_AFTER_DAYS * MS_PER_DAY
}

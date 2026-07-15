// Pure helpers for the weekly rerun-review ritual. The ritual is armed each
// Monday (facilitator: Sree) and disarms once someone records a review that
// week. Kept free of React/DB so the "is it time to review?" logic is
// unit-testable and shared by the in-app banner.

export const RERUN_REVIEW_FACILITATOR = 'Sree'

/** The most recent Monday at 00:00 local time, on or before `now`. */
export function mostRecentMonday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay(): 0=Sun … 6=Sat. Days elapsed since Monday: Mon→0, Tue→1 … Sun→6.
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday)
  return d
}

/** True if a review was recorded on or after this week's Monday. */
export function isReviewedThisWeek(lastReviewedIso: string | null | undefined, now: Date): boolean {
  if (!lastReviewedIso) return false
  const last = new Date(lastReviewedIso)
  if (Number.isNaN(last.getTime())) return false
  return last.getTime() >= mostRecentMonday(now).getTime()
}

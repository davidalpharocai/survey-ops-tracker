export interface StageHistoryRow {
  stage: string
  /** ISO timestamptz */
  entered_at: string
}

export interface StageDuration {
  stage: string
  days: number
  ongoing: boolean
}

/** Whole-day difference between two dates, computed in UTC (avoids local-TZ drift), clamped to >= 0. */
function utcDayDiff(from: Date, to: Date): number {
  const fromUTC = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const toUTC = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  const diff = Math.round((toUTC - fromUTC) / 86400000)
  return Math.max(0, diff)
}

/**
 * Computes the number of days spent in each pipeline stage from a project's
 * stage-history rows. The clock starts at Doc Programming — any `Submitted`
 * row is defensively dropped. The last row (by entered_at) is the current
 * stage and is measured through to `now`.
 *
 * Pure: `now` is a parameter, never read from the system clock internally.
 */
export function stageDurations(rows: StageHistoryRow[], now: Date | string): StageDuration[] {
  const nowDate = typeof now === 'string' ? new Date(now) : now

  const sorted = rows
    .filter((r) => r.stage !== 'Submitted')
    .slice()
    .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime())

  return sorted.map((row, i) => {
    const isLast = i === sorted.length - 1
    const start = new Date(row.entered_at)
    const end = isLast ? nowDate : new Date(sorted[i + 1].entered_at)
    return {
      stage: row.stage,
      days: utcDayDiff(start, end),
      ongoing: isLast,
    }
  })
}

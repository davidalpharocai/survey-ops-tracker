// Sprint cadence math. Sprints are defined centrally by a single anchor (start
// of Sprint 1) and a length (default 14 days), so "Sprint 15" means the same
// dates for everyone. The project stores only the sprint number; ranges derive.
import { differenceInCalendarDays, addDays, parseISO, format } from 'date-fns'

export interface SprintConfig {
  anchor_date: string // ISO 'YYYY-MM-DD' — start of Sprint 1
  length_days: number
}

const len = (cfg: SprintConfig) => (cfg.length_days > 0 ? cfg.length_days : 14)

export function sprintNumberForDate(date: Date, cfg: SprintConfig): number {
  const diff = differenceInCalendarDays(date, parseISO(cfg.anchor_date))
  return Math.floor(diff / len(cfg)) + 1
}

export function currentSprintNumber(cfg: SprintConfig): number {
  // Clamp to >= 1: if the anchor is mis-set into the future the raw number
  // would go <= 0, which breaks labels and the options window.
  return Math.max(1, sprintNumberForDate(new Date(), cfg))
}

export function sprintRange(n: number, cfg: SprintConfig): { start: Date; end: Date } {
  const start = addDays(parseISO(cfg.anchor_date), (n - 1) * len(cfg))
  return { start, end: addDays(start, len(cfg) - 1) }
}

/** ISO date ('YYYY-MM-DD') of a sprint's first day — used to inherit a project's start. */
export function sprintStartISO(n: number, cfg: SprintConfig): string {
  // format() renders in local time; .toISOString() would shift to UTC and
  // land on the previous day in any timezone behind UTC (e.g. all of the US).
  return format(sprintRange(n, cfg).start, 'yyyy-MM-dd')
}

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Sprint 15 · Jul 1 – Jul 14" */
export function sprintLabel(n: number, cfg: SprintConfig): string {
  const { start, end } = sprintRange(n, cfg)
  return `Sprint ${n} · ${fmt(start)} – ${fmt(end)}`
}

/**
 * Dropdown options around the current sprint (a few past, several upcoming),
 * always including `include` (the project's stored sprint) even if outside the window.
 */
export function sprintOptions(
  cfg: SprintConfig,
  include?: number | null,
  past = 2,
  future = 6
): { number: number; label: string }[] {
  const cur = currentSprintNumber(cfg)
  const nums = new Set<number>()
  for (let n = cur - past; n <= cur + future; n++) if (n >= 1) nums.add(n)
  if (include != null && include >= 1) nums.add(include)
  return [...nums]
    .sort((a, b) => a - b)
    .map(n => ({ number: n, label: sprintLabel(n, cfg) }))
}

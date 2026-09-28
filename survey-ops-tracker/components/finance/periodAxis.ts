/**
 * Labels for a PERIOD axis — months and weeks — in two forms.
 *
 * David, on the Insights charts (2026-09-28): "if im looking at last 12 months
 * as a date range, then it needs to show the month-year in the chart. how else
 * would i follow it". The same rule binds every dated axis in the finance hub,
 * and it bites hardest here: the coverage heatmap draws EVERY month with
 * delivered work whatever dates are picked, so its axis always crosses a year,
 * and a column reading "Jun" is two different months.
 *
 * So each period carries two labels:
 *
 *   LONG   "Sep 2026" / "7 Sep 2026" — never ambiguous. The tooltip, the
 *          accessible summary and the chart's table twin always use this one,
 *          so nothing the axis leaves out is lost.
 *   SHORT  what the chart DRAWS. Terse, because the axis thins labels that
 *          would collide and a narrower label means more of them survive — but
 *          it keeps a two-digit year whenever the axis spans more than one
 *          calendar year, because a label that cannot be told apart is worse
 *          than no label at all.
 *
 * The year is decided by the AXIS, not the period: a window sitting inside one
 * calendar year prints "Sep", and the same month inside a window that crosses
 * one prints "Sep 26". `spansYears` takes the keys the chart is about to draw.
 */

import { monthLabel } from '@/lib/finance/coverage'
import { dayLabel } from '@/lib/finance/improve'

/** Does this axis cross a calendar year? Keys that carry no year (the Undated
 *  bucket) say nothing either way and are ignored. */
export function spansYears(keys: readonly string[]): boolean {
  const years = new Set<string>()
  for (const k of keys) if (/^\d{4}-\d\d/.test(k)) years.add(k.slice(0, 4))
  return years.size > 1
}

/** "Sep 2026" for a 'YYYY-MM' key — the form every tooltip and table uses. */
export const monthLong = (key: string): string => monthLabel(key)

/** "Sep", or "Sep 26" when the axis crosses a year. The Undated bucket keeps
 *  the short word it has always had. */
export function monthShort(key: string, withYear: boolean): string {
  if (!/^\d{4}-\d\d/.test(key)) return key === 'undated' ? 'Und.' : monthLabel(key)
  const name = monthLabel(key).slice(0, 3)
  return withYear ? `${name} ${key.slice(2, 4)}` : name
}

/** "7 Sep 2026" for a 'YYYY-MM-DD' day — a week is named by its Monday. */
export function dayLong(iso: string): string {
  return /^\d{4}-\d\d-\d\d/.test(iso) ? `${dayLabel(iso)} ${iso.slice(0, 4)}` : iso
}

/** "7 Sep", or "7 Sep 26" when the axis crosses a year. */
export function dayShort(iso: string, withYear: boolean): string {
  if (!/^\d{4}-\d\d-\d\d/.test(iso)) return iso
  return withYear ? `${dayLabel(iso)} ${iso.slice(2, 4)}` : dayLabel(iso)
}

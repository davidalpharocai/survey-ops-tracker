/**
 * Date ranges for the account view and its PDF export.
 *
 * David asked for "a date range (prefixed options + a custom option)". Two
 * things about that turn out to need a decision rather than a default, and both
 * are handled here rather than in a component so they can be tested and so the
 * screen and the printed page can never disagree.
 *
 * WHICH DATE. A survey has three, and they give different answers: when it was
 * submitted, when it launched, and when it was delivered. "Everything in Q3" is
 * three different lists. So the basis is an explicit, visible choice rather than
 * a hidden assumption, and it defaults to DELIVERED — a salesperson showing a
 * client what they got in a period means what actually landed, not what was
 * asked for.
 *
 * A ROW WITH NO DATE ON THE CHOSEN BASIS IS EXCLUDED, not silently kept. An
 * in-flight survey has no delivery date; including it in "delivered last
 * quarter" would be wrong, and the caller is told how many were dropped so the
 * omission is visible rather than a quiet shortfall.
 *
 * Pure, and takes `today` as an argument: a module that reads the clock cannot
 * be tested for the quarter boundary, which is exactly where this kind of code
 * is wrong.
 */

export type DateBasis = 'delivered' | 'submitted' | 'launched'

export const DATE_BASES: { id: DateBasis; label: string; hint: string }[] = [
  { id: 'delivered', label: 'Delivered', hint: 'When the survey was actually delivered. What the client received in the period.' },
  { id: 'submitted', label: 'Submitted', hint: 'When the request came in. What the client ASKED for in the period, delivered or not.' },
  { id: 'launched', label: 'Launched', hint: 'When fielding started.' },
]

export type PresetId = 'all' | 'last30' | 'last90' | 'qtd' | 'ytd' | 'lastyear' | 'custom'

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last90', label: 'Last 90 days' },
  { id: 'qtd', label: 'This quarter' },
  { id: 'ytd', label: 'This year' },
  { id: 'lastyear', label: 'Last year' },
  { id: 'custom', label: 'Custom…' },
]

export interface Range {
  /** Inclusive ISO date, or null for unbounded. */
  from: string | null
  /** Inclusive ISO date, or null for unbounded. */
  to: string | null
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Resolve a preset against a given day. `today` is an ISO date string, passed
 *  in rather than read from the clock so quarter and year boundaries are
 *  testable. */
export function rangeFor(preset: PresetId, today: string, custom?: Range): Range {
  if (preset === 'custom') return { from: custom?.from ?? null, to: custom?.to ?? null }
  if (preset === 'all') return { from: null, to: null }

  // Parsed at midday UTC so a timezone offset can never roll the date back a
  // day — the classic off-by-one in anything that does date maths on strings.
  const t = new Date(today + 'T12:00:00Z')
  const y = t.getUTCFullYear()

  switch (preset) {
    case 'last30':
    case 'last90': {
      const days = preset === 'last30' ? 30 : 90
      const from = new Date(t)
      // 29 days back for a 30-day window: the window INCLUDES today, so
      // subtracting the full count would return 31 days of data.
      from.setUTCDate(from.getUTCDate() - (days - 1))
      return { from: iso(from), to: today }
    }
    case 'qtd': {
      const q = Math.floor(t.getUTCMonth() / 3)
      return { from: iso(new Date(Date.UTC(y, q * 3, 1, 12))), to: today }
    }
    case 'ytd':
      return { from: iso(new Date(Date.UTC(y, 0, 1, 12))), to: today }
    case 'lastyear':
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  }
}

/** The date a row is filtered on, for a given basis. Null when the row has no
 *  such date — which excludes it from any bounded range. */
export function dateOf(
  row: { delivered_at?: string | null; deliver_date?: string | null; submitted_date?: string | null; launch_date?: string | null },
  basis: DateBasis
): string | null {
  if (basis === 'submitted') return row.submitted_date ?? null
  if (basis === 'launched') return row.launch_date ?? null
  // Delivered: the ACTUAL date where we have it, falling back to the promised
  // one. A project marked delivered carries delivered_at; one still in flight
  // has only a target, and using it means "expected to deliver in this window",
  // which is the useful reading for a forward-looking range.
  return (row.delivered_at ?? '').slice(0, 10) || row.deliver_date || null
}

export interface FilterResult<T> {
  rows: T[]
  /** Rows dropped for having no date on the chosen basis. Surfaced so a short
   *  list is explained rather than merely short. */
  undated: number
}

export function filterByRange<
  T extends { delivered_at?: string | null; deliver_date?: string | null; submitted_date?: string | null; launch_date?: string | null },
>(rows: T[], basis: DateBasis, range: Range): FilterResult<T> {
  if (range.from == null && range.to == null) return { rows, undated: 0 }
  let undated = 0
  const kept = rows.filter(r => {
    const d = dateOf(r, basis)
    if (!d) { undated++; return false }
    if (range.from && d < range.from) return false
    if (range.to && d > range.to) return false
    return true
  })
  return { rows: kept, undated }
}

/** "Delivered 1 Jul – 30 Sep 2026", for the export header. A PDF that states
 *  its own filter can be checked; one that does not is a table of unexplained
 *  numbers. */
export function describeRange(basis: DateBasis, range: Range): string {
  const label = DATE_BASES.find(b => b.id === basis)?.label ?? basis
  if (!range.from && !range.to) return `${label} · all time`
  const fmt = (d: string) =>
    new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (range.from && range.to) return `${label} ${fmt(range.from)} – ${fmt(range.to)}`
  if (range.from) return `${label} from ${fmt(range.from)}`
  return `${label} up to ${fmt(range.to as string)}`
}

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
 *
 * EVERY DATE HERE IS A NEW YORK DATE. The team works in Eastern Time and so do
 * the clients reading the PDF. `new Date().toLocaleDateString('en-CA')` is the
 * SERVER's zone, which on Vercel is UTC, so from 8pm ET onward "today" was
 * already tomorrow: a This quarter export run on the evening of 30 September
 * came out as Q4, and a survey delivered at 9:53pm ET on 24 August printed as
 * delivered on the 25th. `todayET` and `etDate` are the one place that
 * conversion happens.
 */
import { bucketOf } from './buckets'

const NY = 'America/New_York'

/** YYYY-MM-DD of an instant, in New York. Built from formatToParts rather than
 *  trusting a locale's date order, so no ICU update can reshuffle it. */
function ymdInNewYork(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Today's date in Eastern Time. Takes `now` so a test can stand at 11pm ET. */
export function todayET(now: Date = new Date()): string {
  return ymdInNewYork(now)
}

/** The Eastern-Time calendar date of a timestamp such as `delivered_at`.
 *  A bare date passes through untouched (it has no time to convert), and
 *  anything unparseable is null rather than "Invalid Date". */
export function etDate(ts: string | null | undefined): string | null {
  if (!ts) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? null : ymdInNewYork(d)
}

/** The Eastern-Time CLOCK TIME of a timestamp, as "8:24 AM".
 *
 *  Alex, 2026-09-28: he wants to see when N collected was last touched without
 *  opening the survey, "the date and time". A date alone does not answer it —
 *  several of his studies are updated more than once a day (PR00383, PR00392,
 *  PR00427 and PR00461 all changed within the same minute this morning), so
 *  "updated today" and "updated an hour ago" look identical.
 *
 *  Same New York rule and the same formatToParts discipline as `etDate`: the
 *  server clock is UTC, and a 9pm ET edit rendered in the server's zone reads
 *  as the next morning. Returns null for a bare date (it has no time to show)
 *  rather than inventing midnight. */
export function etTime(ts: string | null | undefined): string | null {
  if (!ts) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const period = get('dayPeriod')
  return `${get('hour')}:${get('minute')}${period ? ' ' + period.toUpperCase() : ''}`
}

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

export interface DatedRow {
  delivered_at?: string | null
  deliver_date?: string | null
  submitted_date?: string | null
  launch_date?: string | null
  /** Read on the delivered basis only: a row counts as delivered by where it
   *  sits (bucketOf), never by whether it happens to carry a date. */
  board_column?: string | null
  status?: string | null
  phase?: string | null
}

const isDelivered = (row: DatedRow) =>
  bucketOf({ status: row.status ?? null, phase: row.phase ?? null, board_column: row.board_column ?? null }) === 'delivered'

/** The date a row is filtered on, for a given basis. Null when the row has no
 *  such date — which excludes it from any bounded range. */
export function dateOf(row: DatedRow, basis: DateBasis): string | null {
  if (basis === 'submitted') return row.submitted_date ?? null
  if (basis === 'launched') return row.launch_date ?? null
  // Delivered means DELIVERED. This used to fall back to the promised date for
  // a survey still in flight, which read "expected to deliver in this window"
  // into a filter labelled Delivered — so DE Shaw's This quarter export listed
  // PR00257, in field and past due, among the work the client had received,
  // and its 13 credits rode into "drawn this quarter". A survey that has not
  // been delivered has no delivered date, whatever it was promised for.
  //
  // For one that has: the actual date, in Eastern Time, where we have it; the
  // promised date where the card reached Delivery without a timestamp.
  if (!isDelivered(row)) return null
  return etDate(row.delivered_at) ?? row.deliver_date ?? null
}

export interface FilterResult<T> {
  rows: T[]
  /** Rows dropped for having no date on the chosen basis. Surfaced so a short
   *  list is explained rather than merely short. On the delivered basis this
   *  counts only DELIVERED rows with no date — see notDelivered. */
  undated: number
  /** Delivered basis only: rows dropped because they have not been delivered.
   *  Kept apart from `undated` because the two need different fixes — one is
   *  work still in flight, the other a record missing its date. Always 0 on the
   *  other bases and for an unbounded range. */
  notDelivered: number
}

export function filterByRange<T extends DatedRow>(rows: T[], basis: DateBasis, range: Range): FilterResult<T> {
  if (range.from == null && range.to == null) return { rows, undated: 0, notDelivered: 0 }
  let undated = 0
  let notDelivered = 0
  const kept = rows.filter(r => {
    if (basis === 'delivered' && !isDelivered(r)) { notDelivered++; return false }
    const d = dateOf(r, basis)
    if (!d) { undated++; return false }
    if (range.from && d < range.from) return false
    if (range.to && d > range.to) return false
    return true
  })
  return { rows: kept, undated, notDelivered }
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

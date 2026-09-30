/**
 * Date ranges for the Insights dashboard — pure, no React, no database.
 *
 * ── WHY NOT lib/finance/filters.ts ──────────────────────────────────────────
 * The finance filter module imports the finance money code (hub.ts), and
 * Insights must stay a page with no dollar figure anywhere in its import
 * graph. It also needs two things finance does not have: a "Last 12 months"
 * preset, and a PREVIOUS period for every range, so a tile can say "up from 38
 * in 1–27 Aug". The small date helpers are therefore repeated here rather than
 * imported; they follow the same rules (Eastern time, inclusive ISO bounds).
 *
 * ── A SURVEY'S PLACE IN TIME ────────────────────────────────────────────────
 * A delivered survey is placed by its DELIVER date (`deliver_date`) — the day
 * the client had it. Never `delivered_at` (bulk-stamped: dozens of surveys
 * carry the same September day) and never `created_at` (hundreds of surveys
 * were bulk-created in June). A delivered survey with no deliver date cannot
 * be placed, so any bounded range leaves it out, and the page says how many.
 */

export type RangePreset =
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'since-jun-1'
  | 'last-12-months'
  | 'custom'
  | 'all'

/** Inclusive ISO bounds. null = unbounded on that side. */
export interface DateRange { from: string | null; to: string | null }

/** What the reader picked. `from` / `to` are only read for 'custom'. */
export interface RangeChoice { preset: RangePreset; from: string | null; to: string | null }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

/** The start of the "Since 1 Jun 2026" preset — the same window the finance
 *  hub defaults to, so the two pages can be read side by side. */
export const SINCE_FROM = '2026-06-01'

/** Insights opens on the current month: "how are we doing this month" is the
 *  question an analyst dashboard answers first (David, 2026-09-24: "# of
 *  surveys delivered this month"). */
export const DEFAULT_PRESET: RangePreset = 'this-month'

export const RANGE_PRESETS: { id: RangePreset; label: string; help: string }[] = [
  { id: 'this-month', label: 'This month', help: 'From the 1st of this month to today.' },
  { id: 'last-month', label: 'Last month', help: 'The whole of last calendar month.' },
  { id: 'this-quarter', label: 'This quarter', help: 'From the first day of this quarter to today.' },
  {
    id: 'since-jun-1',
    // Written from SINCE_FROM, so the label can never disagree with the range.
    label: `Since ${Number(SINCE_FROM.slice(8))} ${MON[Number(SINCE_FROM.slice(5, 7)) - 1]} ${SINCE_FROM.slice(0, 4)}`,
    help: `From ${Number(SINCE_FROM.slice(8))} ${MONTH[Number(SINCE_FROM.slice(5, 7)) - 1]} ${SINCE_FROM.slice(0, 4)} to today — the window the finance pages use.`,
  },
  { id: 'last-12-months', label: 'Last 12 months', help: 'This month so far and the 11 whole months before it.' },
  { id: 'custom', label: 'Custom', help: 'Pick your own start and end dates.' },
  { id: 'all', label: 'All time', help: 'Every delivered study, including those with no deliver date (they are counted but cannot go on a monthly chart).' },
]

export const PRESET_IDS = new Set<string>(RANGE_PRESETS.map(p => p.id))

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in 'YYYY-MM-DD' form, or null. "2026-02-30" is null. */
export function isoOrNull(v: string | null | undefined): string | null {
  if (!v || !ISO.test(v)) return null
  const t = Date.parse(v + 'T00:00:00Z')
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 10) === v ? v : null
}

/** Today in Eastern time — the office's calendar, so a survey delivered at 9pm
 *  in New York is not placed in tomorrow. */
export function todayET(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (iso: string) => iso.split('-').map(Number) as [number, number, number]
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const dayMs = 86_400_000

/** Whole calendar days from `a` to `b` (b − a). Both ISO dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / dayMs)
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10)
}

/** Move a date by whole months, keeping the day but never past the month's
 *  end: 31 Mar − 1 month is 28 Feb, not 3 Mar. */
export function shiftMonths(iso: string, k: number): string {
  const [y, m, d] = ymd(iso)
  const idx = y * 12 + (m - 1) + k
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

const endOfMonth = (y: number, m: number) => `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`

/** The inclusive bounds a choice selects, given today. */
export function resolveRange(choice: RangeChoice, today: string): DateRange {
  const [y, m] = ymd(today)
  switch (choice.preset) {
    case 'this-month': return { from: `${y}-${pad(m)}-01`, to: today }
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1
      return { from: `${ly}-${pad(lm)}-01`, to: endOfMonth(ly, lm) }
    }
    case 'this-quarter': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1
      return { from: `${y}-${pad(q0)}-01`, to: today }
    }
    case 'since-jun-1': return { from: SINCE_FROM, to: today }
    case 'last-12-months': return { from: shiftMonths(`${y}-${pad(m)}-01`, -11), to: today }
    case 'custom': {
      const from = isoOrNull(choice.from), to = isoOrNull(choice.to)
      // Typed back to front, the reader still means the days between them.
      if (from && to && from > to) return { from: to, to: from }
      return { from, to }
    }
    case 'all': return { from: null, to: null }
  }
}

export const isBounded = (r: DateRange) => r.from != null || r.to != null

/** Is an ISO date inside the range? An unbounded range admits a missing date
 *  (All time counts undated surveys); a bounded side never does. */
export function inRange(date: string | null | undefined, r: DateRange): boolean {
  if (r.from && (!date || date < r.from)) return false
  if (r.to && (!date || date > r.to)) return false
  return true
}

/** Does the range run from the 1st of a month to the last day of a month —
 *  one or more WHOLE calendar months? */
export function isWholeMonths(r: DateRange): r is { from: string; to: string } {
  if (!r.from || !r.to || r.from > r.to || !r.from.endsWith('-01')) return false
  const [y, m] = ymd(r.to)
  return r.to === endOfMonth(y, m)
}

/**
 * The period a range is compared against: the same span, immediately before.
 *
 *   whole calendar months (last month, a custom 1–31 May, this month on its
 *   last day, …)
 *     are compared with the same number of whole months before them, whatever
 *     their lengths: May with April, not with 31 Mar–30 Apr. The monthly chart
 *     draws whole months, so this is the figure its April column shows — the
 *     page never puts two different "April" numbers side by side;
 *   calendar presets still running (this month, this quarter, last 12 months)
 *     shift back by whole months, so 1–27 Sep is compared with 1–27 Aug and
 *     this quarter so far with the same days of last quarter — the fair
 *     comparison for a period still running;
 *   since 1 Jun and any other custom range
 *     shift back by the same number of days.
 *
 * All time, and a custom range open on one side, have no previous period.
 */
export function previousRange(choice: RangeChoice, today: string): DateRange | null {
  const cur = resolveRange(choice, today)
  if (!cur.from || !cur.to) return null
  if (isWholeMonths(cur)) {
    const k = monthsBetween(monthKey(cur.from), monthKey(cur.to)).length
    const { from } = monthBounds(addMonths(monthKey(cur.from), -k))
    const { to } = monthBounds(addMonths(monthKey(cur.to), -k))
    return { from, to }
  }
  const months: Partial<Record<RangePreset, number>> = {
    'this-month': 1, 'this-quarter': 3, 'last-12-months': 12,
  }
  const k = months[choice.preset]
  if (k != null) return { from: shiftMonths(cur.from, -k), to: shiftMonths(cur.to, -k) }
  const len = daysBetween(cur.from, cur.to) + 1
  return { from: addDays(cur.from, -len), to: addDays(cur.from, -1) }
}

/* ── MONTHS ─────────────────────────────────────────────────────────────── */


/** '2026-09-27' → '2026-09'. */
export const monthKey = (iso: string) => iso.slice(0, 7)

/**
 * '2026-09' → 'Sep 26', or 'Sep' without the year — the NARROWEST form that
 * still names both month and year, for a chart's x axis.
 *
 * A category axis thins labels that would collide, and what it thins away it
 * cannot name. Measured with components/charts/scale.ts textWidth, at the
 * 10px tick font a narrow panel uses: 'Sep 26' is 32px where 'Sep 2026' is
 * 43px and 'September 2026' is 77px. The two-digit year is never worse, and
 * on the narrowest screen (a ~320px chart, a 23px band) it keeps 6 of 12
 * months named where the four-digit year keeps 4.
 */
export function monthNarrow(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number)
  return withYear ? `${MON[m - 1]} ${String(y).slice(-2)}` : MON[m - 1]
}

/** '2026-09' → 'September', or 'September 2026' with the year. */
export function monthLong(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number)
  return withYear ? `${MONTH[m - 1]} ${y}` : MONTH[m - 1]
}

export function addMonths(key: string, k: number): string {
  return shiftMonths(key + '-01', k).slice(0, 7)
}

/** Every month key from `a` to `b` inclusive (empty when a > b). */
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = []
  for (let k = a; k <= b && out.length < 1200; k = addMonths(k, 1)) out.push(k)
  return out
}

/** A monthly chart shows at least this many months, so "this month" still has
 *  a trend to sit in… */
export const MIN_TREND_MONTHS = 6
/** …and at most this many, so a custom range starting years back stays legible. */
export const MAX_TREND_MONTHS = 36

/**
 * The months the monthly charts and the tile sparklines draw. They end with the
 * range's last month and reach back to its first — or at least six months, so
 * a single month is shown in context (the months outside the range are faded,
 * not hidden). An unbounded start begins at the first month with a delivery.
 */
export function trendMonths(r: DateRange, today: string, firstDataMonth: string | null): string[] {
  const end = monthKey(r.to ?? today)
  const start0 = r.from ? monthKey(r.from) : (firstDataMonth ?? end)
  let start = start0 < addMonths(end, -(MIN_TREND_MONTHS - 1)) ? start0 : addMonths(end, -(MIN_TREND_MONTHS - 1))
  if (start < addMonths(end, -(MAX_TREND_MONTHS - 1))) start = addMonths(end, -(MAX_TREND_MONTHS - 1))
  return monthsBetween(start, end)
}

/** A month's first and last day: '2026-02' → 1–28 Feb 2026. */
export function monthBounds(key: string): { from: string; to: string } {
  const [y, m] = key.split('-').map(Number)
  return { from: `${key}-01`, to: endOfMonth(y, m) }
}

/** How a month sits against the range: wholly inside, partly, or outside. */
export function monthCoverage(key: string, r: DateRange): 'in' | 'partial' | 'out' {
  const [y, m] = key.split('-').map(Number)
  const first = `${key}-01`, last = endOfMonth(y, m)
  if ((r.from && last < r.from) || (r.to && first > r.to)) return 'out'
  if ((r.from && first < r.from) || (r.to && last > r.to)) return 'partial'
  return 'in'
}

/* ── WORDS ──────────────────────────────────────────────────────────────── */

function day(iso: string, withYear: boolean): string {
  const [y, m, d] = ymd(iso)
  return `${d} ${MON[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** "1–27 Sep 2026", "1 Aug–27 Sep 2026", "1 Dec 2025–27 Sep 2026",
 *  "From 1 Jun 2026", "Up to 27 Sep 2026", "All time". */
export function formatRange(r: DateRange): string {
  if (!r.from && !r.to) return 'All time'
  if (r.from && r.to) {
    if (r.from === r.to) return day(r.from, true)
    const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4)
    if (sameYear && r.from.slice(0, 7) === r.to.slice(0, 7)) return `${ymd(r.from)[2]}–${day(r.to, true)}`
    return `${day(r.from, !sameYear)}–${day(r.to, true)}`
  }
  if (r.from) return `From ${day(r.from, true)}`
  return `Up to ${day(r.to as string, true)}`
}

/** The range as the end of a sentence: "so far in September", "in August",
 *  "since 1 June", "to date", "between 3 Aug and 10 Sep 2026". */
export function rangeWords(choice: RangeChoice, today: string): string {
  const r = resolveRange(choice, today)
  switch (choice.preset) {
    case 'this-month': return `so far in ${monthLong(monthKey(today))}`
    case 'last-month': return `in ${monthLong(monthKey(r.from as string))}`
    case 'this-quarter': return 'so far this quarter'
    case 'since-jun-1': return `since ${ymd(SINCE_FROM)[2]} ${monthLong(monthKey(SINCE_FROM))}`
    case 'last-12-months': return 'in the last 12 months'
    case 'all': return 'to date'
    case 'custom': {
      if (r.from && r.to) {
        if (r.from === r.to) return `on ${day(r.from, true)}`
        return `between ${day(r.from, r.from.slice(0, 4) !== r.to.slice(0, 4))} and ${day(r.to, true)}`
      }
      if (r.from) return `since ${day(r.from, true)}`
      if (r.to) return `up to ${day(r.to, true)}`
      return 'to date'
    }
  }
}

/** Does the range run up to today (so its figures are still growing)? */
export const runsToToday = (r: DateRange, today: string) => r.to == null || r.to >= today

// Pure date/datetime input parsing + validation for typed fields on the project
// page (dates, and datetimes for blasts). No I/O, no Date object math for
// validation — everything is done on plain integers so there's no timezone
// ambiguity. Users can type `M/D/YYYY` or `Mon D[, YYYY]` (year defaults to
// 2026 when omitted), optionally followed by a time for the datetime variant.

export type YMD = { y: number; m: number; d: number } // m is 1-12
export type YMDT = { y: number; m: number; d: number; hh: number; mm: number; hasTime: boolean }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

const dim = (m: number, y: number) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

const pad2 = (n: number) => ('0' + n).slice(-2)

/** Parse a typed date string into {y,m,d}, or null if invalid/empty. */
export function parseDateInput(s: string): YMD | null {
  const str = s.trim()
  if (!str || str === '—') return null

  let y: number, m: number, d: number

  const slash = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slash) {
    m = parseInt(slash[1], 10)
    d = parseInt(slash[2], 10)
    y = parseInt(slash[3], 10)
  } else {
    const worded = str.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)
    if (!worded) return null
    const monthStr = worded[1].toLowerCase()
    const monthIdx = MON.findIndex((mo) => monthStr.startsWith(mo.toLowerCase()))
    if (monthIdx === -1) return null
    m = monthIdx + 1
    d = parseInt(worded[2], 10)
    y = worded[3] ? parseInt(worded[3], 10) : 2026
  }

  if (!(m >= 1 && m <= 12)) return null
  if (!(y >= 1900 && y <= 2100)) return null
  if (!(d >= 1 && d <= dim(m, y))) return null

  return { y, m, d }
}

/** Format {y,m,d} as "Jul 6, 2026". */
export function formatDate(p: YMD): string {
  return `${MON[p.m - 1]} ${p.d}, ${p.y}`
}

/** Typed date string -> "YYYY-MM-DD", or '' if invalid/empty. */
export function toISODate(s: string): string {
  const p = parseDateInput(s)
  return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : ''
}

/** "YYYY-MM-DD" -> {y,m,d}, or null if invalid. */
export function fromISODate(iso: string): YMD | null {
  const match = (iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return parseDateInput(`${parseInt(match[2], 10)}/${parseInt(match[3], 10)}/${match[1]}`)
}

// Matches a trailing time token, capturing the date part in group 1:
//   "h:mm[ ][am|pm]"   e.g. "2:00pm", "2:00 PM", "14:30"
//   "h[ ][am|pm]"      e.g. "2pm", "2 a.m."
const TIME_TAIL =
  /^(.+?)[ ,·]+(\d{1,2}:\d{2}\s*[ap]?\.?m?\.?|\d{1,2}\s*[ap]\.?m\.?|\d{1,2}:\d{2})\s*$/i

/** Parse a typed date, or date+time, string into {y,m,d,hh,mm,hasTime}, or null if invalid/empty. */
export function parseDateTimeInput(s: string): YMDT | null {
  const str = s.trim()
  if (!str || str === '—') return null

  const tail = str.match(TIME_TAIL)
  if (!tail) {
    const ymd = parseDateInput(str)
    return ymd ? { ...ymd, hh: 0, mm: 0, hasTime: false } : null
  }

  const ymd = parseDateInput(tail[1])
  if (!ymd) return null

  const raw = tail[2].trim()
  const isPM = /p\.?m?\.?$/i.test(raw)
  const isAM = /a\.?m?\.?$/i.test(raw)
  const numeric = raw.replace(/[ap]\.?m?\.?$/i, '').trim()

  let hh: number, mm: number
  if (numeric.includes(':')) {
    const [hStr, mStr] = numeric.split(':')
    hh = parseInt(hStr, 10)
    mm = parseInt(mStr, 10)
  } else {
    hh = parseInt(numeric, 10)
    mm = 0
  }
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (mm < 0 || mm > 59) return null

  if (isPM || isAM) {
    if (hh < 1 || hh > 12) return null
    if (isPM && hh !== 12) hh += 12
    if (isAM && hh === 12) hh = 0
  } else {
    if (hh < 0 || hh > 23) return null
  }

  return { ...ymd, hh, mm, hasTime: true }
}

/** Format {y,m,d,hh,mm,hasTime} as "Jul 14, 2026 · 2:00 PM" (date-only when hasTime is false). */
export function formatDateTime(p: YMDT): string {
  const base = formatDate(p)
  if (!p.hasTime) return base
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12
  const ampm = p.hh < 12 ? 'AM' : 'PM'
  return `${base} · ${h12}:${pad2(p.mm)} ${ampm}`
}

// ── timestamptz bridge (datetime fields only) ───────────────────────────────
// Everything above is pure integer math with NO timezone assumptions — correct
// for date-only fields, which carry no instant. A blast's `blast_at`, though, is
// a true instant stored in a Postgres `timestamptz`. These helpers DELIBERATELY
// use the JS Date object (and therefore the browser's local timezone) to bridge
// a stored UTC instant and the local wall-clock a user reads and types: we store
// UTC and render each viewer their own local time. Legacy rows written before
// this bridge existed come in one of two shapes and both resolve correctly:
// a true UTC instant (from the old blast widget) converts to local, and a naive
// offset-less string (from the interim redesign) is parsed by JS as local
// wall-clock — so it still displays at its intended time and is rewritten as a
// proper UTC instant the next time it's saved.

/** Typed date+time string (interpreted as browser-local) -> UTC instant ISO
 *  (e.g. "2026-07-14T18:00:00.000Z"), or '' if invalid/empty. */
export function toInstantISO(s: string): string {
  const p = parseDateTimeInput(s)
  if (!p) return ''
  return new Date(p.y, p.m - 1, p.d, p.hh, p.mm).toISOString()
}

/** UTC instant ISO -> local {y,m,d,hh,mm,hasTime:true}, or null if invalid/empty. */
export function instantToLocalYMDT(iso: string | null): YMDT | null {
  if (!iso || !iso.trim()) return null
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return null
  return {
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
    hh: dt.getHours(),
    mm: dt.getMinutes(),
    hasTime: true,
  }
}

/** UTC instant ISO -> local "YYYY-MM-DDTHH:MM" for a datetime-local input, or ''. */
export function instantToLocalWallClock(iso: string | null): string {
  const p = instantToLocalYMDT(iso)
  return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh)}:${pad2(p.mm)}` : ''
}

/** Local wall-clock "YYYY-MM-DDTHH:MM" (from a datetime-local input) -> UTC
 *  instant ISO, or '' if malformed. */
export function localWallClockToInstantISO(wall: string): string {
  const m = (wall || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return ''
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString()
}

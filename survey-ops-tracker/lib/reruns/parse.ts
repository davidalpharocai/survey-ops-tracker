// Pure parser + classifier for Sree's "Manual Rerun(sree)" sheet tab.
// No I/O — takes the raw sheet rows (SheetJS header:1 form) and returns the
// shape stored in public.rerun_snapshot. Shared by the sync route
// (lib/reruns/sheet.ts). The standalone seed script (scripts/sync-reruns.mjs)
// mirrors this same logic in plain JS — keep the two in step.
//
// Column map (positional — the tab has no stable header IDs):
//   0 client · 1 next_cadence · 2 work · 3 freq · 4 platform · 5 cadence
//   6 n · 7 template · 8 note · 9 status_raw · 10 survey_ids

export interface ParsedRerun {
  sheet_row: number
  client: string | null
  next_cadence: string | null
  work: string | null
  freq: string | null
  platform: string | null
  cadence: string | null
  n: string | null
  template: string | null
  note: string | null
  status_raw: string | null
  survey_ids: string | null
  next_run_date: string | null
  status_class: string
}

const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Month index (0-11) from an English month name at a token boundary, else -1. */
export function monthIdx(s: string | null): number {
  if (!s) return -1
  // Leading \b so embedded sequences don't false-match ("Marketing"→Mar,
  // "Declined"→Dec, "Junior"→Jun, "Octopus"→Oct). A bare "may" still matches,
  // which is intended — a lone "May" means the month.
  const m = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)
  return m ? MONS.indexOf(m[1]) : -1
}

/** Quarter-end month index (Q1→Mar, Q2→Jun, Q3→Sep, Q4→Dec) from "Qn", else -1. */
export function quarterEndM(s: string | null): number {
  const m = (s ?? '').toLowerCase().match(/\bq([1-4])\b/)
  return m ? [2, 5, 8, 11][Number(m[1]) - 1] : -1
}

/**
 * Coarse state used only to peel "done"/"closed" rows out of the timing buckets.
 * The overdue/upcoming split is a read-time decision against next_run_date, not
 * this field — so it stays correct as time passes without a re-sync.
 */
export function statusClass(status: string | null, next: string | null): string {
  const s = (status ?? '').toLowerCase()
  const n = (next ?? '').toLowerCase()
  if (/closed|cancel/.test(n) || /closed|cancel/.test(s)) return 'closed'
  if (/done/.test(s)) return 'done'
  if (/pending/.test(s)) return 'pending'
  if (!s && !n) return 'unknown'
  return 'active'
}

/**
 * Best-effort real date for the next collection, derived from the free-text the
 * sheet actually holds ("Today", "May Pending", "Q3 pending", "Early May").
 * Month/quarter granularity only → END of the parsed month/quarter, current year
 * (NO roll-forward: a past "May Pending" must read as overdue, not next year's
 * May). Month-END is deliberate: a rerun only flips to overdue once its month has
 * actually finished — "May Pending" reads as due through May, overdue from June.
 * null when nothing parseable → the row lands in the "needs a date" bucket. UTC
 * to match formatDate()'s UTC rendering.
 */
export function deriveNextRunDate(status: string | null, next: string | null, now: Date): string | null {
  const n = (next ?? '').trim().toLowerCase()
  if (n === 'today') return now.toISOString().slice(0, 10)
  let m = monthIdx(status)
  if (m < 0) m = monthIdx(next)
  if (m < 0) {
    m = quarterEndM(status)
    if (m < 0) m = quarterEndM(next)
  }
  if (m < 0) return null
  // Last day of month m: day 0 of month m+1.
  return new Date(Date.UTC(now.getUTCFullYear(), m + 1, 0)).toISOString().slice(0, 10)
}

/**
 * Guard against the positional column map silently corrupting if the tab is
 * reordered or a column is inserted. Checks the KEY columns are where the parser
 * expects them (0 Client, 1 Next Collection, 5 Cadence, 9 Status) — not mere
 * presence anywhere — so a reordered tab aborts the sync (never storing
 * mislabeled data / wiping the mirror). A cron has no human to eyeball a dry-run.
 */
export function headerLooksValid(header: unknown[]): boolean {
  const at = (i: number) => (header?.[i] == null ? '' : String(header[i]).toLowerCase())
  return /client/.test(at(0)) && /next|collection/.test(at(1)) && /cadence/.test(at(5)) && /status/.test(at(9))
}

/** Parse the full sheet (rows[0] is the header) into rerun_snapshot rows. */
export function parseRerunRows(rows: unknown[][], now: Date): ParsedRerun[] {
  const out: ParsedRerun[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const client = str(r[0])
    const cadence = str(r[5])
    if (!client && !cadence) continue // blank row
    const status_raw = str(r[9])
    const next_cadence = str(r[1])
    out.push({
      sheet_row: i,
      client,
      next_cadence,
      work: str(r[2]),
      freq: str(r[3]),
      platform: str(r[4]),
      cadence,
      n: str(r[6]),
      template: str(r[7]),
      note: str(r[8]),
      status_raw,
      survey_ids: str(r[10]),
      next_run_date: deriveNextRunDate(status_raw, next_cadence, now),
      status_class: statusClass(status_raw, next_cadence),
    })
  }
  return out
}

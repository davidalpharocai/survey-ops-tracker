import type { Database } from '@/lib/supabase/types'

export type SurveyProject = Database['public']['Tables']['survey_projects']['Row']

export const SURVEYS_TAB = 'Surveys'
export const SHEET_WIDTH = 40 // columns A..AN as of 2026-07-15
export const PR_COL_INDEX = 38 // AM — literal project_code; used to locate rows

// Header label expected at each SOCC-written column (live dump 2026-07-15). The
// runtime guard aborts the sync if any of these drift, rather than corrupt data.
export const EXPECTED_HEADERS: Record<number, string> = {
  0: 'Latest/Next Steps', 1: 'Client', 2: 'Survey/Project Name', 3: 'Longitudinal?',
  4: 'Type', 5: 'Status', 6: 'Submitted date', 7: 'Launch date', 8: 'Due Date',
  9: 'Deliver date', 10: 'Voter Survey - Additional QA', 11: 'Citation Lang. Needed',
  12: 'Row-Level Data', 13: 'N', 14: 'N (Internal Target)', 15: 'N Collected',
  16: 'N Actual', 17: 'Audience Size', 18: 'Project captain', 19: 'Terminations',
  23: 'Doc Programming', 24: 'Survey Programming', 25: 'EdWin QA', 26: 'Fielding',
  27: 'DATA QA', 28: 'Delivery', 32: 'Survey Question(s) Document', 34: 'GoogleSheet',
  37: 'AlphaROC Sales/POC', 38: 'Project ID',
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export function headerGuardOk(liveHeader: unknown[]): boolean {
  return Object.entries(EXPECTED_HEADERS).every(([i, label]) => norm(liveHeader[Number(i)]) === norm(label))
}

const fmtDate = (d: string | null) => d ?? '' // 'YYYY-MM-DD'; USER_ENTERED parses as a date
const fmtBool = (b: boolean | null) => (b == null ? '' : b ? 'TRUE' : 'FALSE') // blank = unknown (triBool)
const fmtNum = (n: number | null) => (n == null ? '' : String(n))
const statusFor = (p: SurveyProject) => (p.delivered_at ? 'Done' : 'In Progress')

// Neutralize Sheets formula injection: under USER_ENTERED a free-text cell that
// begins with = + - @ is evaluated as a FORMULA (e.g. a note "=> follow up" becomes
// #ERROR!; "=IMPORTRANGE(...)" runs). Prefix an apostrophe so Sheets stores it as
// literal text — the apostrophe is a display directive, not part of the exported
// value, so the read-back parser sees the clean string. Applied only to free-text
// columns (date/number/bool cells never start with these and must not be quoted).
export const escapeText = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s)

// A clickable Sheets hyperlink for a link cell (written under USER_ENTERED). The
// bare-URL text the team saw isn't clickable, so wrap it in =HYPERLINK(). Empty
// string when there's no URL. Double-quotes in the URL are doubled so they can't
// break out of the formula's string literal (Google Docs URLs never contain them,
// but we defend anyway); NOT run through escapeText (that would quote the '=').
export const hyperlink = (url: string) => (url ? `=HYPERLINK("${url.replace(/"/g, '""')}")` : '')

export function classifyLinkedDocs(links: string[] | null): { doc: string; sheet: string } {
  const arr = links ?? []
  return {
    doc: arr.find((u) => /docs\.google\.com\/document/i.test(u)) ?? '',
    sheet: arr.find((u) => /docs\.google\.com\/spreadsheets/i.test(u)) ?? '',
  }
}

/**
 * Earliest timeline date on/after which a project is "David-era" and eligible
 * for write-back. Projects whose whole timeline predates this are legacy — they
 * belong to the team's authoritative sheet history and the sync must NEVER
 * touch them (David's standing rule). Keep in sync with the reconciliation cutoff.
 */
export const WRITEBACK_MIN_DATE = '2026-05-26'

/**
 * Eligible for SOCC→sheet write-back only if RECENT: at least one timeline date
 * (submitted / launch / due / deliver) is on or after WRITEBACK_MIN_DATE. A
 * project with all four null or earlier is legacy → skipped, so the sync can't
 * overwrite a pre-David sheet row.
 *
 * `created_at` is deliberately NOT considered: the ~186 legacy projects were all
 * imported in 2026-06, so their created_at is "recent" and would wrongly mark
 * every legacy row eligible. Timeline dates reflect the real project era.
 * Consequence: a brand-new project with no dates set yet won't sync until it
 * gets one — acceptable (nothing meaningful to mirror yet) and safe for legacy.
 */
export function isWritebackEligible(p: SurveyProject, minDate: string = WRITEBACK_MIN_DATE): boolean {
  return [p.submitted_date, p.launch_date, p.due_date, p.deliver_date].some(
    (d) => d != null && String(d).slice(0, 10) >= minDate
  )
}

/**
 * The sparse {colIndex -> string} cells SOCC owns for a project. `captainInitials`
 * is pre-resolved by the caller (primary + co-captains, comma-joined) since it
 * needs a team_members lookup — kept out of here so this module stays pure.
 */
export function mappedCells(p: SurveyProject, captainInitials: string): Record<number, string> {
  const { doc, sheet } = classifyLinkedDocs(p.linked_documents)
  return {
    0: escapeText(p.latest_next_steps ?? ''),
    1: escapeText(p.client ?? ''),
    2: escapeText(p.project_name ?? ''),
    3: fmtBool(p.longitudinal),
    4: p.project_type ?? '',
    5: statusFor(p),
    6: fmtDate(p.submitted_date),
    7: fmtDate(p.launch_date),
    8: fmtDate(p.due_date),
    9: fmtDate(p.deliver_date),
    10: fmtBool(p.voter_survey_qa),
    11: fmtBool(p.citation_language_needed),
    12: fmtBool(p.row_level_data),
    13: fmtNum(p.n_target),
    14: fmtNum(p.n_internal_target),
    15: fmtNum(p.n_collected),
    16: fmtNum(p.n_actual),
    17: fmtNum(p.audience_size),
    18: captainInitials,
    19: fmtBool(p.terminations),
    23: fmtBool(p.stage_doc_programming),
    24: fmtBool(p.stage_survey_programming),
    25: fmtBool(p.stage_edwin_qa),
    26: fmtBool(p.stage_fielding),
    27: fmtBool(p.stage_data_qa),
    28: fmtBool(p.stage_delivery),
    32: hyperlink(doc),
    34: hyperlink(sheet),
    37: escapeText(p.salesperson ?? ''),
    38: p.project_code ?? '',
  }
}

/** Full-width row for append: mapped values + blanks everywhere else (keeps positional alignment). */
export function fullRow(cells: Record<number, string>): string[] {
  const row: string[] = new Array(SHEET_WIDTH).fill('')
  for (const [i, v] of Object.entries(cells)) row[Number(i)] = v
  return row
}

/** Stable FNV-1a hash of the mapped cells — change detection independent of updated_at. */
export function rowHash(cells: Record<number, string>): string {
  const canonical = Object.keys(cells)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => `${i}=${cells[i]}`)
    .join('')
  let h = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

const colLetter = (i: number) => {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * batchUpdate value ranges for one existing row (1-based). Only SOCC-owned
 * contiguous runs, so team columns (gaps, Comments, Edwin/Deliverable links,
 * Survey IDs) are never overwritten.
 */
export function updateData(cells: Record<number, string>, rowNumber: number) {
  const runs: [number, number][] = [
    [0, 19],
    [23, 28],
    [32, 32],
    [34, 34],
    [37, 38],
  ]
  return runs.map(([a, b]) => ({
    range: `${SURVEYS_TAB}!${colLetter(a)}${rowNumber}:${colLetter(b)}${rowNumber}`,
    values: [Array.from({ length: b - a + 1 }, (_, k) => cells[a + k] ?? '')],
  }))
}

/**
 * The CSV a cleanup tile exports — and the shape it has to come back in.
 *
 * David, 2026-09-28: "the ability to export as csv so i can update in the csv
 * and return it to you." So this is not a report. It is a WORKSHEET, and it has
 * to survive a round trip through a spreadsheet and back into Claude's hands:
 *
 *   1. `project_code` is the stable key, first column, and is never edited. It
 *      is the only thing tying a returned row back to a survey — the row order
 *      will not survive a sort, and a project name will not survive a rename.
 *   2. The column a person types into is headed with the EXACT database column
 *      name (`due_date`, `salesperson`, `n_actual`). There is no mapping to
 *      guess at when the file comes back, which is how the wrong field gets
 *      written. The one exception is spelled out rather than hidden: a column
 *      that stores an ID and can only be typed as a name is headed
 *      `captain_id (by name)`, so the file says which cells need resolving
 *      before a write instead of looking like a direct-write column.
 *   3. Beside it, `<column> (current)` shows what is there today — so an edit
 *      is visibly an edit, and a blank cell unambiguously means "leave alone"
 *      rather than "clear this field".
 *   4. A read-only field carries its `(current)` column and NO blank cell: it is
 *      there to be copied FROM (`delivered_at`), never typed into.
 *   5. A check with no editable field at all (`fields: []`) exports the context
 *      columns and nothing else, and its `remedy` is what to do instead. That is
 *      how no blank column headed `actual_spend` ever reaches a spreadsheet.
 *   6. Everything else (name, client, stage, status, wave) is context for the
 *      person filling it in and is ignored on the way back.
 *
 * ── EXPORT ONLY ─────────────────────────────────────────────────────────────
 * There is deliberately no import path and no bulk write anywhere in lib/admin.
 * David hands the edited file back in chat and Claude applies it through the
 * ordinary connector writes, where each change is validated and audited like
 * any other. A CSV uploader would be a second, unaudited way into the database.
 *
 * ── FORMULA INJECTION ───────────────────────────────────────────────────────
 * Every cell goes through `csvCell` from lib/utils/exportCsv.ts — the app's one
 * guard, reused rather than re-implemented, so a project name beginning with
 * `=` cannot execute when the file is opened in Excel.
 */

import { csvCell } from '@/lib/utils/exportCsv'
import {
  isRerunWave,
  type CheckResult, type CleanupCheck, type CleanupField, type CleanupReport, type CleanupRow,
  GROUP_LABEL, SEVERITY_LABEL, SOURCE_LABEL,
} from './cleanup'

/** The context columns every cleanup CSV starts with. Read-only: they are there
 *  so the person editing the file knows which survey they are looking at. */
const CONTEXT: { header: string; value: (r: CleanupRow) => unknown }[] = [
  { header: 'project_code', value: r => r.project_code },
  { header: 'project_name', value: r => r.project_name },
  { header: 'client', value: r => r.client },
  { header: 'stage', value: r => r.board_column },
  { header: 'status', value: r => r.status },
  { header: 'rerun_wave', value: r => isRerunWave(r) },
  // Here on every worksheet because one check (`flag_occam_not_onboarded`) sets
  // a field on the CONTACT rather than on the survey, and this names the person
  // whose record changes. It earns its place on the others too: "who asked for
  // this" is the first question when a survey has nothing else filled in.
  { header: 'requested_by', value: r => r.requested_by_name },
]

/** Header text for the read-only "what is there today" column. */
export const currentHeader = (column: string): string => `${column} (current)`

/** Header text for the cell a person types into. `(by name)` marks the columns
 *  that store an id: the cell holds a name, and Claude resolves it on the way
 *  back rather than writing "Sree" into a uuid. */
export const entryHeader = (f: CleanupField): string =>
  f.lookup ? `${f.column} (by name)` : f.column

/**
 * The headers this check's worksheet carries, in order.
 *
 * Exported on its own because the UI shows them as a preview before the
 * download, and because the test asserts the exact shape — a silent change to
 * this list would break every file David has half-edited.
 */
export function cleanupCsvHeaders(check: CleanupCheck): string[] {
  return [
    ...CONTEXT.map(c => c.header),
    ...check.fields.flatMap(f =>
      f.readOnly ? [currentHeader(f.column)] : [currentHeader(f.column), entryHeader(f)]),
  ]
}

/**
 * What to type into each editable column, for the UI to show beside the
 * download. Kept out of the file itself so the CSV stays one header row and
 * parses cleanly on the way back.
 *
 * Read-only fields are left out — there is nothing to type into them — and the
 * column is named exactly as the file heads it, so "fill in `captain_id (by
 * name)`" and the header in the spreadsheet are the same string.
 */
export function cleanupCsvNotes(check: CleanupCheck): { column: string; entry: string }[] {
  return check.fields.filter(f => !f.readOnly).map(f => ({ column: entryHeader(f), entry: f.entry }))
}

export interface CleanupCsvOptions {
  /** Include the repeat waves as well as the actionable rows. Off by default,
   *  matching the tile: the headline number is the work a person picks up. */
  includeWaves?: boolean
}

/** One check's worksheet. */
export function buildCleanupCsv(result: CheckResult, opts: CleanupCsvOptions = {}): string {
  const { check } = result
  const rows = opts.includeWaves ? [...result.rows, ...result.waves] : result.rows
  const headers = cleanupCsvHeaders(check)
  const lines = [headers.map(csvCell).join(',')]
  for (const r of rows) {
    const cells = [
      ...CONTEXT.map(c => csvCell(c.value(r))),
      // current value, then an EMPTY cell to type the new one into — unless the
      // field is read-only, which carries the value and offers no cell at all.
      ...check.fields.flatMap(f => (f.readOnly ? [csvCell(f.current(r))] : [csvCell(f.current(r)), ''])),
    ]
    lines.push(cells.join(','))
  }
  return lines.join('\r\n')
}

/**
 * Every tile as a row: what the dashboard says, in a file.
 *
 * `surveys` and `rerun_waves` are left EMPTY — not 0 — for a check whose source
 * did not load, and `blocked_by` names the read that failed. A spreadsheet full
 * of zeros is exactly the "we are clean" lie this dashboard exists to avoid.
 */
export function buildCleanupSummaryCsv(report: CleanupReport): string {
  const headers = [
    'check_id', 'check', 'group', 'severity', 'surveys', 'rerun_waves', 'applies_to', 'measured',
    'blocked_by', 'what_to_do', 'why',
  ]
  const lines = [headers.map(csvCell).join(',')]
  for (const res of report.results) {
    lines.push([
      csvCell(res.check.id),
      csvCell(res.check.label),
      csvCell(GROUP_LABEL[res.check.group]),
      csvCell(SEVERITY_LABEL[res.check.severity]),
      res.available ? csvCell(res.count) : '',
      res.available ? csvCell(res.waveCount) : '',
      res.available ? csvCell(res.applies) : '',
      csvCell(res.available ? 'yes' : 'no'),
      csvCell(res.blockedBy.map(s => SOURCE_LABEL[s]).join('; ')),
      // Either the columns to fill in, or — where nothing is typed — the remedy
      // in words, so the summary file is self-describing away from the screen.
      csvCell(
        res.check.fields.filter(f => !f.readOnly).length > 0
          ? cleanupCsvNotes(res.check).map(n => `${n.column}: ${n.entry}`).join(' | ')
          : res.check.remedy ?? ''),
      csvCell(res.check.why),
    ].join(','))
  }
  return lines.join('\r\n')
}

/**
 * One row per survey that needs work, with every check it fails.
 *
 * Read-only on purpose — a survey failing six checks would need twelve editable
 * columns, and a worksheet nobody can read is a worksheet nobody fills in. This
 * is the "what is left" file; the per-check worksheets are what gets edited.
 */
export function buildCleanupAllCsv(report: CleanupReport, opts: CleanupCsvOptions = {}): string {
  const failures = new Map<string, { row: CleanupRow; checks: string[] }>()
  for (const res of report.results) {
    if (!res.available) continue
    const rows = opts.includeWaves ? [...res.rows, ...res.waves] : res.rows
    for (const r of rows) {
      const entry = failures.get(r.id) ?? { row: r, checks: [] }
      entry.checks.push(res.check.label)
      failures.set(r.id, entry)
    }
  }
  const headers = [...CONTEXT.map(c => c.header), 'problems', 'checks_failed']
  const lines = [headers.map(csvCell).join(',')]
  const sorted = [...failures.values()].sort(
    (a, b) =>
      b.checks.length - a.checks.length ||
      (a.row.project_code ?? '￿').localeCompare(b.row.project_code ?? '￿'))
  for (const { row, checks } of sorted) {
    lines.push([
      ...CONTEXT.map(c => csvCell(c.value(row))),
      csvCell(checks.length),
      csvCell(checks.join('; ')),
    ].join(','))
  }
  return lines.join('\r\n')
}

/** `socc-cleanup-no-due-date-2026-09-28.csv`. The check id is in the name so a
 *  file handed back weeks later still says which worksheet it is. */
export function cleanupCsvFilename(check: CleanupCheck, today: string): string {
  return `socc-cleanup-${check.id.replace(/_/g, '-')}-${today}.csv`
}

export function cleanupSummaryFilename(today: string): string {
  return `socc-cleanup-summary-${today}.csv`
}

export function cleanupAllFilename(today: string): string {
  return `socc-cleanup-all-${today}.csv`
}

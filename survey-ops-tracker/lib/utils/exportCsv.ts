import type { SurveyProject } from '@/lib/hooks/useProjects'

export interface CsvColumn {
  header: string
  value: (p: SurveyProject) => unknown
  /** Finance-only: omitted entirely unless the user holds `view_financials`. */
  restricted?: true
}

// Column order mirrors the original Survey Ops sheet where possible.
//
// `restricted: true` marks the money that is REVENUE-side or an internal
// intention rather than a cost we actually paid: budget (a spending CEILING,
// not client revenue — see the client-tile tooltip, which says the opposite and
// is wrong), and, once they exist as columns, client price per N, contract
// value and margin. Cost-to-run stays PUBLIC on purpose — actual_spend, blasts,
// launches, supplier CPI and the flat project_costs lines are everyone's job to
// watch, so they are exported for everyone.
//
// The rows themselves always arrive complete: fetchFullProjects() selects '*'
// and other things depend on that, so the restricted values ARE in memory here.
// Stripping happens at the column list, which is the last place the data passes
// through on its way to a file.
const COLUMNS: CsvColumn[] = [
  { header: 'Project ID', value: p => p.project_code },
  { header: 'Project Name', value: p => p.project_name },
  { header: 'Client', value: p => p.client },
  { header: 'Type', value: p => p.project_type },
  { header: 'Phase', value: p => p.phase },
  { header: 'Status', value: p => p.status },
  { header: 'Scoping Stage', value: p => p.scoping_stage },
  { header: 'Board Column', value: p => p.board_column },
  { header: 'Captain', value: p => p.captain?.initials },
  { header: 'Salesperson', value: p => p.salesperson },
  { header: 'Submitted', value: p => p.submitted_date },
  { header: 'Launch Date', value: p => p.launch_date },
  { header: 'Due Date', value: p => p.due_date },
  { header: 'Deliver Date', value: p => p.deliver_date },
  { header: 'N Target', value: p => p.n_target },
  { header: 'N Collected', value: p => p.n_collected },
  { header: 'N Actual', value: p => p.n_actual },
  { header: 'Total Available Audience Size', value: p => p.audience_size },
  { header: 'Audience Size Used', value: p => p.audience_used },
  { header: 'Budget', value: p => p.budget, restricted: true },
  { header: 'Actual Spend', value: p => p.actual_spend },
  { header: 'Longitudinal', value: p => p.longitudinal },
  { header: 'Row-Level Data', value: p => p.row_level_data },
  { header: 'Survey IDs', value: p => p.survey_tool_id },
  { header: 'Slack Channel', value: p => p.slack_channel_url },
  { header: 'Linked Documents', value: p => (p.linked_documents ?? []).join(' ') },
  { header: 'Latest/Next Steps', value: p => p.latest_next_steps },
]

/**
 * The columns this user's CSV gets. `canViewFinancials` must come from
 * useCanViewFinancials(), which is false while the capability query is still in
 * flight — so an export fired before the check resolves is a CSV without the
 * money, never a CSV with it.
 */
export function csvColumnsFor(canViewFinancials: boolean): CsvColumn[] {
  return canViewFinancials ? COLUMNS : COLUMNS.filter(c => !c.restricted)
}

/** True when any column in this file is finance-restricted — what gets logged
 *  as `included_restricted`, computed from the columns actually written rather
 *  than re-deriving the capability. */
export function csvIncludedRestricted(columns: CsvColumn[]): boolean {
  return columns.some(c => c.restricted === true)
}

/**
 * Text that a spreadsheet would run as a formula: a cell starting with `=`,
 * `+`, `-` or `@` (and tab or carriage return, which some spreadsheets strip
 * before looking). A project name, a note or a client label is typed by people,
 * and a CSV opened in Excel executes `=HYPERLINK(...)` or worse on open.
 */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV cell, quoted when it must be and defused when it could be a formula.
 *
 * The guard applies to TEXT only. A value that arrives as a JavaScript number
 * cannot carry a formula, so a negative amount (a recovered reward, a loss)
 * stays a number the spreadsheet can add up, rather than turning into text
 * behind an apostrophe. Text that merely looks like a negative number ("-12")
 * is defused anyway: from text we cannot tell a number from the start of a
 * formula, and a text cell with an apostrophe still reads correctly.
 *
 * Shared by every CSV the app writes (the project lists and the finance hub),
 * so the guard cannot be present in one exporter and missing from another.
 */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (FORMULA_START.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The CSV text (no BOM, no download) — the whole file as a pure function, so
 *  the column gating can be tested without a DOM. */
export function buildProjectsCsv(projects: SurveyProject[], columns: CsvColumn[]): string {
  return [
    columns.map(c => csvCell(c.header)).join(','),
    ...projects.map(p => columns.map(c => csvCell(c.value(p))).join(',')),
  ].join('\r\n')
}

/**
 * Hand a CSV to the browser as a file. A BOM goes first so Excel opens UTF-8
 * correctly (without it, "−$3,586" and every accented name arrive mangled).
 * Returns nothing and never throws on the audit side: logging is the caller's
 * next step, and a download must never wait on it.
 */
export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface ExportCsvOptions {
  /** From useCanViewFinancials(). Required, not defaulted: a new call site that
   *  forgets it is a type error rather than a silent leak. */
  canViewFinancials: boolean
  /** Which surface ran the export, for the audit log: 'list-csv' | 'board-csv'. */
  route: string
  /** The filters in effect, for the audit log. Nulls/empties are dropped server-side. */
  filters?: Record<string, unknown>
}

/** What happened to the audit note for one export. The download never waits
 *  on this and never fails because of it; the caller shows it ("Logged as
 *  export #…", or that the log failed) so a missing audit row is visible. */
export interface ExportLogResult {
  ok: boolean
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  /** The data_exports row id, when the server returned one. */
  id: string | null
  /** Why it failed, in words, when it did. */
  error: string | null
}

/**
 * Note to /api/exports/log. The row is written server-side with the
 * service-role client (data_exports grants `authenticated` no INSERT — an
 * analyst-writable audit log could be forged by the people it audits), and the
 * server takes the actor from the session, so all we send is what was exported
 * and the filters behind it.
 *
 * The response IS read now. For weeks this was fire-and-forget: the route was
 * never deployed (a .gitignore rule swallowed it), production answered 404 to
 * every export, and nothing noticed because nothing looked. A non-2xx answer, a
 * network failure or a body reporting `ok: false` is logged to the console and
 * returned — never thrown, because the file has already been handed to the
 * browser by the time this runs and a lost log row must not surface as a broken
 * button.
 *
 * Exported so the finance exporter shares the one audit path rather than
 * writing a second one that could drift out of step with it.
 */
export async function logExport(entry: {
  route: string
  rowCount: number
  /** Everything that scoped the rows — tab, date range, account, route,
   *  lifecycle, scoping. Nulls and empties are dropped server-side. */
  filters?: Record<string, unknown>
  includedRestricted: boolean
}): Promise<ExportLogResult> {
  try {
    const res = await fetch('/api/exports/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null
    if (!res.ok || body?.ok === false) {
      const error = body?.error ?? `export log returned ${res.status}`
      console.error('[exportCsv] the export was not logged:', error)
      return { ok: false, status: res.status, id: null, error }
    }
    return { ok: true, status: res.status, id: typeof body?.id === 'string' ? body.id : null, error: null }
  } catch (err) {
    // Offline, blocked, route missing. The download already happened.
    const error = err instanceof Error ? err.message : String(err)
    console.error('[exportCsv] the export was not logged:', error)
    return { ok: false, status: 0, id: null, error }
  }
}

/**
 * Build the CSV, hand it to the browser, and record the pull.
 *
 * Logging lives INSIDE this function rather than at the two call sites so that
 * adding a third export button can't quietly skip the audit trail.
 */
export async function exportProjectsCsv(
  projects: SurveyProject[],
  opts: ExportCsvOptions
): Promise<ExportLogResult> {
  const columns = csvColumnsFor(opts.canViewFinancials)
  downloadCsv(
    buildProjectsCsv(projects, columns),
    `survey-ops-export-${new Date().toISOString().split('T')[0]}.csv`,
  )

  return logExport({
    route: opts.route,
    rowCount: projects.length,
    filters: opts.filters,
    includedRestricted: csvIncludedRestricted(columns),
  })
}

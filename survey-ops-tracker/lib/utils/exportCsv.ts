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
  { header: 'Audience Size', value: p => p.audience_size },
  { header: 'Budget', value: p => p.budget, restricted: true },
  { header: 'Actual Spend', value: p => p.actual_spend },
  { header: 'Longitudinal', value: p => p.longitudinal },
  { header: 'Citation Language', value: p => p.citation_language_needed },
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

function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The CSV text (no BOM, no download) — the whole file as a pure function, so
 *  the column gating can be tested without a DOM. */
export function buildProjectsCsv(projects: SurveyProject[], columns: CsvColumn[]): string {
  return [
    columns.map(c => cell(c.header)).join(','),
    ...projects.map(p => columns.map(c => cell(c.value(p))).join(',')),
  ].join('\r\n')
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

/**
 * Fire-and-forget note to /api/exports/log. The row is written server-side with
 * the service-role client (data_exports grants `authenticated` no INSERT — an
 * analyst-writable audit log could be forged by the people it audits), and the
 * server takes the actor from the session, so all we send is what was exported.
 *
 * Awaited by the caller but never allowed to fail the export: the download has
 * already happened by the time this runs, and a lost log row must not surface as
 * a broken button.
 */
async function logExport(entry: {
  route: string
  rowCount: number
  filters?: Record<string, unknown>
  includedRestricted: boolean
}): Promise<void> {
  try {
    await fetch('/api/exports/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    })
  } catch {
    // Offline, blocked, route missing — nothing the exporter can do about it.
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
): Promise<void> {
  const columns = csvColumnsFor(opts.canViewFinancials)
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['﻿' + buildProjectsCsv(projects, columns)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `survey-ops-export-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)

  await logExport({
    route: opts.route,
    rowCount: projects.length,
    filters: opts.filters,
    includedRestricted: csvIncludedRestricted(columns),
  })
}

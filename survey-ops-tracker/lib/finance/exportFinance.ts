/**
 * CSV export for the finance section.
 *
 * ── WHY IT IS NOT `exportProjectsCsv` ───────────────────────────────────────
 * That exporter writes `SurveyProject` columns straight off the row. Everything
 * worth exporting from finance is DERIVED — measured route, recomputed spend,
 * CPC, CPQR, scrub, whether the records reconcile — and none of it exists on a
 * project row. So this builds its own columns from `SurveyPnl`, which is the
 * same object the tabs render, and reuses the two things that matter from the
 * existing exporter: the finance column gate and the server-side audit log.
 *
 * ── THE THREE COLUMNS THAT MAKE THE FILE WORTH SENDING ──────────────────────
 * `route_measured`, `date_basis` and `reconciled` exist nowhere else in SOCC.
 * They are the three things this section is most careful about, and without
 * them the recipient re-cuts the file in Excel and re-derives them wrongly:
 * they would group by `project_type` (wrong on ~15 of 123 surveys with rows),
 * assume every row is dated the same way, and treat an under-recorded survey's
 * cost per complete as real.
 *
 * ── GATING ──────────────────────────────────────────────────────────────────
 * Rate, revenue, margin and budget are `restricted`. A reader without
 * VIEW_FINANCIALS gets a file with those columns ABSENT — not blank, absent, so
 * nothing about their existence leaks through a column header. The audit log
 * records whether restricted columns were included, computed from the columns
 * actually written rather than from the caller's intent.
 */

import { logExport } from '@/lib/utils/exportCsv'
import type { SurveyPnl } from './analysis'
import type { FinProject } from './hub'
import { finDate } from './hub'

export interface FinCsvColumn {
  header: string
  value: (r: SurveyPnl, p?: FinProject) => unknown
  /** Revenue-side or internal-ceiling money. Dropped entirely for a reader
   *  without VIEW_FINANCIALS. */
  restricted?: true
}

/** Which date field a survey landed on. Exported because `finDate` falls back
 *  through three columns, so two rows in the same period may have got there by
 *  different routes, and a recipient re-cutting by month should be able to see
 *  which. */
export function dateBasis(p: FinProject): string {
  if (p.deliver_date) return 'deliver_date'
  if (p.launch_date) return 'launch_date'
  if (p.submitted_date) return 'submitted_date'
  return 'undated'
}

const round2 = (n: number | null | undefined) =>
  n == null ? null : Math.round(n * 100) / 100

export const FIN_COLUMNS: FinCsvColumn[] = [
  { header: 'Project code', value: r => r.code },
  { header: 'Project name', value: r => r.name },
  { header: 'Account', value: r => r.account },
  { header: 'Type (as filed)', value: (_r, p) => p?.project_type ?? null },
  // The measured route, NOT project_type. This is the column that stops a
  // recipient grouping a panel survey under B2B because somebody typed it that
  // way — which is wrong on roughly 15 of the 123 surveys that hold field rows.
  { header: 'Route (measured)', value: r => r.route },
  { header: 'Lifecycle', value: r => r.lifecycle },
  { header: 'Board column', value: (_r, p) => p?.board_column ?? null },
  { header: 'Status', value: (_r, p) => p?.status ?? null },
  { header: 'Date', value: r => r.date },
  { header: 'Date basis', value: (_r, p) => (p ? dateBasis(p) : null) },

  { header: 'N target', value: r => r.target },
  { header: 'N collected', value: r => r.collected },
  { header: 'N actual (post-QA)', value: r => r.actual },
  { header: 'Paid completes', value: r => r.paidCompletes },
  { header: 'Billable N', value: r => r.billableN },

  { header: 'Total cost', value: r => round2(r.cost) },
  { header: 'Cost per complete', value: r => round2(r.cpc) },
  { header: 'CPQR', value: r => round2(r.cpqr) },
  // A recipient cannot tell an under-recorded survey from a cheap one without
  // this, and the difference halves the cost per complete.
  { header: 'Reconciled', value: r => r.reconciled },

  { header: 'Scrub N', value: r => (r.collected != null && r.actual != null ? Math.max(0, r.collected - r.actual) : null) },
  { header: 'Over-target N', value: r => (r.target != null && r.actual != null && r.collected != null ? Math.max(0, Math.min(r.actual, r.collected) - r.target) : null) },
  { header: 'Shortfall N', value: r => (r.target != null && r.actual != null ? Math.max(0, r.target - r.actual) : null) },

  { header: 'Price per N', value: r => r.rate, restricted: true },
  { header: 'Revenue', value: r => round2(r.revenue), restricted: true },
  { header: 'Margin $', value: r => round2(r.margin), restricted: true },
  { header: 'Margin %', value: r => (r.marginPct == null ? null : Math.round(r.marginPct * 1000) / 10), restricted: true },
  { header: 'Budget (ceiling)', value: (_r, p) => p?.budget ?? null, restricted: true },
  {
    header: 'Budget variance',
    value: (r, p) => (p?.budget != null && Number(p.budget) > 0 ? round2(r.cost - Number(p.budget)) : null),
    restricted: true,
  },
]

export const finColumnsFor = (canViewFinancials: boolean): FinCsvColumn[] =>
  canViewFinancials ? FIN_COLUMNS : FIN_COLUMNS.filter(c => !c.restricted)

export const finIncludedRestricted = (cols: FinCsvColumn[]): boolean =>
  cols.some(c => c.restricted === true)

function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The CSV text — a pure function, so the gating is testable without a DOM. */
export function buildFinanceCsv(
  rows: SurveyPnl[], columns: FinCsvColumn[], projects?: Map<string, FinProject>,
): string {
  return [
    columns.map(c => cell(c.header)).join(','),
    ...rows.map(r => columns.map(c => cell(c.value(r, projects?.get(r.id)))).join(',')),
  ].join('\r\n')
}

export interface FinExportOptions {
  /** From useCanViewFinancials(). Required, not defaulted — a call site that
   *  forgets it is a type error rather than a silent leak. */
  canViewFinancials: boolean
  /** Which surface ran it, for the audit log. */
  route: string
  /** Filter state in effect, for the audit log. */
  filters?: Record<string, unknown>
  /** Goes in the filename, so a close pack of several exports stays readable. */
  label?: string
}

/**
 * Build it, hand it to the browser, record the pull.
 *
 * The audit call lives INSIDE this function, not at the call sites, so adding a
 * fourth export button cannot quietly skip the trail.
 */
export async function exportFinanceCsv(
  rows: SurveyPnl[], projects: FinProject[], opts: FinExportOptions,
): Promise<void> {
  const columns = finColumnsFor(opts.canViewFinancials)
  const byId = new Map(projects.map(p => [p.id, p]))
  // BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿' + buildFinanceCsv(rows, columns, byId)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const stamp = new Date().toISOString().slice(0, 10)
  a.download = `socc-finance-${opts.label ?? 'export'}-${stamp}.csv`
  a.click()
  URL.revokeObjectURL(url)

  await logExport({
    route: opts.route,
    rowCount: rows.length,
    filters: opts.filters,
    includedRestricted: finIncludedRestricted(columns),
  })
}

/** Re-exported so a caller can date-stamp a row the same way the table does. */
export { finDate }

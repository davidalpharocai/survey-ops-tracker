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
 *
 * ── "EXPORT WHAT YOU SEE" ───────────────────────────────────────────────────
 * The four-tab page has one export button, and it writes the rows behind the
 * tab's MAIN tile — whatever the tab registered (components/finance/tabs/
 * types.ts FinanceExport) — under a header block that says when the data was
 * read, every filter and the row count. `exportTable` does that; `exportDrill`
 * does the same for the rows in an open drill. Both go through the one audit
 * path (lib/utils/exportCsv.ts logExport) and the one cell writer, which
 * defuses spreadsheet formulas (csvCell). The old whole-page exporter
 * (exportFinanceCsv) had no caller left and is gone; FIN_COLUMNS stays, because
 * it is the per-survey column set a tab can register (pnlExport) and the one
 * the cross-function tests check to the cent.
 */

import { csvCell, downloadCsv, logExport, type ExportLogResult } from '@/lib/utils/exportCsv'
import { fmtNum } from '@/lib/utils/number'
import type { SurveyPnl } from './analysis'
import { CLASS_LABEL, type FinClass } from './lifecycle'
import type { FinProject } from './hub'
import { finDate } from './hub'
import { reconcile, reconcileText, type DrillRow, type DrillSpec } from './drill'
import { money, money2 } from './format'

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

/**
 * The derived lifecycle, in the words the app says out loud.
 *
 * Two things were wrong with printing `r.lifecycle` straight: it is an enum id
 * ('archived'), lowercase and untranslated, in a file written for a busy
 * executive where every other derived column is a sentence; and 'Archived' is a
 * word David retired on 2026-09-28 — "closed = archived and archived = closed.
 * lets not confuse users". A survey that never reached Delivery reads "Closed
 * before delivery", which is what actually happened to it, and the class the
 * classifier calls 'archived' is exactly that set (lifecycle.ts `classify`
 * returns 'delivered' for anything in the Delivery column first).
 *
 * The raw `status` column beside it still exports the stored 'Closed'
 * untouched: it is the database's own value, and a recipient reconciling
 * against a dump needs it to match.
 *
 * SEAM: when the shared `statusLabel(p)` helper lands (one helper, one rule —
 * it also checks the Delivery column before printing "Delivered"), point this
 * column at it and delete the override below.
 */
export const LIFECYCLE_LABEL: Record<FinClass, string> = {
  ...CLASS_LABEL,
  archived: 'Closed before delivery',
}

/** Why a row has (or lacks) a revenue figure, in words a recipient can read.
 *  Restricted: it can say a segment carries a price of its own. The invoice
 *  uses one rate — the survey's — so that price is a note, never the figure. */
export function priceStatus(r: SurveyPnl): string {
  if (!r.priced) {
    return r.segmentPriceDiffers ? 'No price; only a segment carries one. Set the study rate' : 'No price'
  }
  const base = r.revenue == null
    ? (r.revenueReason === 'no-cap' ? 'Priced; no N target' : 'Priced; no delivered N yet')
    : r.free ? 'Given away at $0' : 'Priced'
  return r.segmentPriceDiffers ? `${base}; a segment is priced differently and the bill uses the study rate` : base
}

/** What the segments say about the survey's N, or blank for a survey without
 *  segments. A NOTE: the bill, and every N column in this file, use the
 *  survey's own N actual (David, 2026-09-27) — except CPQR and Scrub N on a
 *  partial roll-up, which are blank and say why here. Plain numbers, no
 *  thousands separator and no commas, so the cell never needs quoting. */
export function segmentNote(r: SurveyPnl): string | null {
  if (r.segments === 0) return null
  if (r.actualSource === 'segments') return 'Study N actual blank; rolled up from the segments'
  if (!r.segmentsDisagree) return 'Segments add up'
  const missing = `${r.segmentsMissingN} of ${r.segments} segments ${r.segmentsMissingN === 1 ? 'has' : 'have'} no N actual`
  if (r.partialRollUp) return `${missing}; the study N actual adds up only the others; CPQR and Scrub N left blank`
  return r.segmentsMissingN > 0
    ? missing
    : `Segments add up to ${r.segmentSum ?? 0}; the study says ${r.actual ?? 0}`
}

export const FIN_COLUMNS: FinCsvColumn[] = [
  { header: 'Project code', value: r => r.code },
  { header: 'Project name', value: r => r.name },
  { header: 'Account', value: r => r.account },
  { header: 'Type (as filed)', value: (_r, p) => p?.project_type ?? null },
  // The measured route, NOT project_type. This is the column that stops a
  // recipient grouping a panel survey under B2B because somebody typed it that
  // way, which is wrong on a meaningful share of the surveys that hold field rows.
  { header: 'Route (measured)', value: r => r.route },
  { header: 'Lifecycle', value: r => LIFECYCLE_LABEL[r.lifecycle] ?? r.lifecycle },
  { header: 'Board column', value: (_r, p) => p?.board_column ?? null },
  { header: 'Status', value: (_r, p) => p?.status ?? null },
  { header: 'Date', value: r => r.date },
  { header: 'Date basis', value: (_r, p) => (p ? dateBasis(p) : null) },

  { header: 'N target', value: r => r.target },
  { header: 'N target (top of range)', value: r => r.cap },
  { header: 'N collected', value: r => r.collected },
  { header: 'N actual (post-QA)', value: r => r.actual },
  { header: 'Paid completes', value: r => r.paidCompletes },
  // min(N actual, top of the sold range), on the survey — lib/finance/revenue.ts.
  // Never the collected (pre-QA) count, and never split by segment.
  { header: 'Billed N', value: r => r.billableN },

  { header: 'Total cost', value: r => round2(r.cost) },
  // Credits inside Total cost, shown so the gross can be backed out.
  { header: 'Rewards recovered', value: r => (r.recovered ? round2(r.recovered) : null) },
  { header: 'Cost per complete', value: r => round2(r.cpc) },
  { header: 'CPQR', value: r => round2(r.cpqr) },
  // A recipient cannot tell an under-recorded survey from a cheap one without
  // this, and the difference halves the cost per complete.
  { header: 'Reconciled', value: r => r.reconciled },

  // Blank, not 0, when an input is missing: 0 would read as "nothing was
  // scrubbed" instead of "nobody recorded it". Blank too on a partial segment
  // roll-up, which would call an uncounted segment scrubbed (Segment check
  // says so) — the same survey the scrub figure on the page leaves out.
  { header: 'Scrub N', value: r => (!r.partialRollUp && r.collected != null && r.actual != null ? Math.max(0, r.collected - r.actual) : null) },
  // Over-target and shortfall follow the rule that caps the bill
  // (lib/finance/revenue.ts): on the SURVEY, never segment by segment, so on
  // every row
  //     Billed N + Over-target N = N actual
  // and a survey that delivered what it sold reads 0 over and 0 short however
  // its segments split.
  { header: 'Over-target N', value: r => r.overN },
  { header: 'Shortfall N', value: r => (r.target != null && r.actual != null ? r.shortN : null) },
  // The segment note. Open to every reader: it is counts, not prices.
  { header: 'Segment check', value: r => segmentNote(r) },

  // A $0 price is a real price and exports as 0, not blank; Margin % stays
  // blank for it, because $0 never divides.
  { header: 'Price per N', value: r => r.rate, restricted: true },
  { header: 'Price status', value: r => priceStatus(r), restricted: true },
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

/** The CSV text — a pure function, so the gating is testable without a DOM.
 *  `header` lines (lib/finance/filters.ts `describe().header`) go above the
 *  column row, then a blank line, so a recipient can see the as-of time, every
 *  filter and the row count without being told. */
export function buildFinanceCsv(
  rows: SurveyPnl[], columns: FinCsvColumn[], projects?: Map<string, FinProject>,
  header: string[] = [],
): string {
  return [
    ...header.map(h => csvCell(h)),
    ...(header.length ? [''] : []),
    columns.map(c => csvCell(c.header)).join(','),
    ...rows.map(r => columns.map(c => csvCell(c.value(r, projects?.get(r.id)))).join(',')),
  ].join('\r\n')
}

/* ── EXPORT WHAT YOU SEE ────────────────────────────────────────────────── */

/**
 * A table as a tab registers it for export. The same shape as
 * components/finance/tabs/types.ts `FinanceExport`, declared here structurally
 * so the library does not import from the components tree.
 */
export interface ExportTable {
  /** File-name stem: 'finance-results-surveys'. */
  name: string
  columns: { key: string; header: string }[]
  rows: Record<string, string | number | null>[]
}

/** The file text: header block, a blank line, the column row, the rows. Every
 *  cell through csvCell, so a survey name that starts with "=" arrives as text. */
export function buildTableCsv(x: ExportTable, header: string[] = []): string {
  return [
    ...header.map(h => csvCell(h)),
    ...(header.length ? [''] : []),
    x.columns.map(c => csvCell(c.header)).join(','),
    ...x.rows.map(r => x.columns.map(c => csvCell(r[c.key])).join(',')),
  ].join('\r\n')
}

/** 'socc-finance-results-surveys-2026-09-28.csv'. Anything but letters, digits
 *  and hyphens becomes a hyphen, so a stem can never name a path. */
export function exportFileName(name: string, stamp: string): string {
  const stem = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'finance'
  return `socc-${stem}-${stamp}.csv`
}

/** The date for a file name, in Eastern time like everything else on the page. */
export const exportStamp = (now: Date = new Date()) =>
  now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

/**
 * The per-survey rows as a table a tab can register: FIN_COLUMNS, in order,
 * one row per survey. The finance page is gated to finance holders, so every
 * column goes in — pass `canViewFinancials: false` for any other surface.
 */
export function pnlExport(
  name: string, rows: SurveyPnl[], projects: Map<string, FinProject> | FinProject[],
  opts: { canViewFinancials: boolean },
): ExportTable {
  const byId = projects instanceof Map ? projects : new Map(projects.map(p => [p.id, p]))
  const cols = finColumnsFor(opts.canViewFinancials)
  const key = (i: number) => `c${i}`
  return {
    name,
    columns: cols.map((c, i) => ({ key: key(i), header: c.header })),
    rows: rows.map(r => {
      const out: Record<string, string | number | null> = {}
      cols.forEach((c, i) => {
        const v = c.value(r, byId.get(r.id))
        out[key(i)] = v == null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)
      })
      return out
    }),
  }
}

export interface ExportAudit {
  /** Which surface ran it, for the audit log: 'finance-results'. */
  route: string
  /** Every filter behind the rows (filters.ts describe().audit, plus extras). */
  filters: Record<string, unknown>
  /** Does the file carry client prices, revenue, margin or budgets? */
  includedRestricted: boolean
}

/**
 * Write the file, hand it to the browser, THEN record the pull.
 *
 * The download never waits on the audit note and never fails because of it:
 * the returned result says whether the note was written, and the page says so
 * ("Logged as export #…" or "Export not logged: …"). The audit call lives
 * inside this function rather than at the button, so a new export surface
 * cannot quietly skip the trail.
 */
export async function exportTable(
  x: ExportTable, header: string[], audit: ExportAudit,
  opts: { now?: Date } = {},
): Promise<ExportLogResult> {
  downloadCsv(buildTableCsv(x, header), exportFileName(x.name, exportStamp(opts.now)))
  return logExport({
    route: audit.route,
    rowCount: x.rows.length,
    filters: { ...audit.filters, export: x.name },
    includedRestricted: audit.includedRestricted,
  })
}

/* ── A DRILL'S ROWS ─────────────────────────────────────────────────────── */

const drillFormat = (f: DrillSpec['format']) =>
  (v: number) => (f === 'number' ? fmtNum(Math.round(v)) : f === 'money2' ? money2(v) : money(v))

/**
 * The rows in an open drill as a table: the survey code, every column the
 * drill shows (the cell as the panel prints it), and the row's contribution to
 * the figure as a plain number rounded to the cent, so the file adds up in a
 * spreadsheet exactly as the strip says it does on screen.
 */
export function drillTable(spec: DrillSpec): ExportTable {
  const cols = [
    { key: 'code', header: 'Study' },
    ...spec.columns.map((c, i) => ({ key: `c${i}`, header: c.header })),
    { key: 'contribution', header: spec.totalLabel },
  ]
  return {
    name: `finance-drill-${spec.key}`,
    columns: cols,
    rows: spec.rows.map((r: DrillRow) => {
      const out: Record<string, string | number | null> = { code: r.code ?? '(no code)' }
      spec.columns.forEach((c, i) => { out[`c${i}`] = c.value(r) })
      out.contribution = Number.isFinite(r.contribution) ? Math.round(r.contribution * 100) / 100 : null
      return out
    }),
  }
}

/** The header block for a drill's file: the page's block, then what the drill
 *  is and what its check said. */
export function drillHeader(spec: DrillSpec, pageHeader: string[]): string[] {
  const rec = reconcile({ rows: spec.rows, expectedTotal: spec.expectedTotal, expectedIds: spec.expectedIds })
  const check = reconcileText(rec, drillFormat(spec.format))
  return [
    ...pageHeader,
    `Drill: ${spec.title}`,
    `Population: ${spec.population}`,
    `Check: ${check.ok ? 'agrees' : 'DOES NOT AGREE'} — ${check.text}`,
  ]
}

/** Download a drill's rows, audit-logged like every other export. */
export async function exportDrill(
  spec: DrillSpec, pageHeader: string[], audit: ExportAudit, opts: { now?: Date } = {},
): Promise<ExportLogResult> {
  const rec = reconcile({ rows: spec.rows, expectedTotal: spec.expectedTotal, expectedIds: spec.expectedIds })
  return exportTable(drillTable(spec), drillHeader(spec, pageHeader), {
    ...audit,
    filters: { ...audit.filters, drill: spec.key, reconciled: rec.ok },
  }, opts)
}

/**
 * What the page says after an export, in plain words. The file has already
 * downloaded by the time this is shown, so a failure says so — it is the audit
 * note that is missing, not the reader's file.
 */
export function exportLogMessage(r: ExportLogResult): { ok: boolean; text: string; title?: string } {
  if (r.ok) {
    return r.id
      ? { ok: true, text: `Logged as export #${r.id.slice(0, 8)}`, title: `Export ${r.id} in the data export log` }
      : { ok: true, text: 'Logged (the server did not return an export number)' }
  }
  const reason =
    r.status === 401 ? 'you appear to be signed out'
      : r.status === 404 ? 'the export log service was not found'
        : r.status === 0 ? `the request did not reach the server${r.error ? ` (${r.error})` : ''}`
          : r.error ? `${r.error.replace(/\.$/, '')} (server answered ${r.status})`
            : `the server answered ${r.status}`
  return { ok: false, text: `Export not logged: ${reason}. Your file still downloaded.` }
}

/** Re-exported so a caller can date-stamp a row the same way the table does. */
export { finDate }

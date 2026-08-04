import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

// Reporting/analytics helpers shared by the connector tools (survey_stats /
// survey_report) and the .xlsx export route. Deliberately flexible on the time
// period so the assistant can answer "PS launched in July 2026", "delivered on
// 2026-07-15", or "everything submitted between X and Y" without rigid parsing.

export type SurveyEvent = 'submitted' | 'launched' | 'delivered'
export type SurveyType = 'PS' | 'B2B' | 'Rerun'

/** Which date column each lifecycle event maps to. "delivered" uses the
 *  client-facing deliver_date (the field users set + see). */
export const EVENT_DATE: Record<SurveyEvent, 'submitted_date' | 'launch_date' | 'deliver_date'> = {
  submitted: 'submitted_date',
  launched: 'launch_date',
  delivered: 'deliver_date',
}

type Row = Record<string, unknown>

/** Selectable report fields — key → { label, get(row) }. Mirrors the app's CSV
 *  export column set so the connector report and the in-app export agree. */
export const REPORT_FIELDS: { key: string; label: string; get: (r: Row) => unknown }[] = [
  { key: 'project_code', label: 'Project ID', get: r => r.project_code },
  { key: 'project_name', label: 'Project Name', get: r => r.project_name },
  { key: 'client', label: 'Client', get: r => r.client },
  { key: 'type', label: 'Type', get: r => r.project_type },
  { key: 'phase', label: 'Phase', get: r => r.phase },
  { key: 'status', label: 'Status', get: r => r.status },
  { key: 'stage', label: 'Stage', get: r => r.board_column },
  { key: 'captain', label: 'Captain', get: r => (r.captain as { initials?: string } | null)?.initials ?? '' },
  { key: 'salesperson', label: 'Salesperson', get: r => r.salesperson },
  { key: 'submitted_date', label: 'Submitted', get: r => r.submitted_date },
  { key: 'launch_date', label: 'Launch Date', get: r => r.launch_date },
  { key: 'due_date', label: 'Due Date', get: r => r.due_date },
  { key: 'deliver_date', label: 'Deliver Date', get: r => r.deliver_date },
  { key: 'n_target', label: 'N Target', get: r => r.n_target },
  { key: 'n_collected', label: 'N Collected', get: r => r.n_collected },
  { key: 'n_actual', label: 'N Actual', get: r => r.n_actual },
  { key: 'audience_size', label: 'Audience Size', get: r => r.audience_size },
  { key: 'budget', label: 'Budget', get: r => r.budget },
  { key: 'actual_spend', label: 'Actual Spend', get: r => r.actual_spend },
  { key: 'longitudinal', label: 'Longitudinal', get: r => r.longitudinal },
  { key: 'survey_ids', label: 'Survey IDs', get: r => r.survey_tool_id },
  { key: 'slack', label: 'Slack Channel', get: r => r.slack_channel_url },
  { key: 'latest_next_steps', label: 'Latest/Next Steps', get: r => r.latest_next_steps },
]
export const REPORT_FIELD_KEYS = REPORT_FIELDS.map(f => f.key)
/** Sensible default columns when the caller doesn't pick fields. */
export const DEFAULT_REPORT_FIELDS = [
  'project_code', 'project_name', 'client', 'type', 'captain',
  'submitted_date', 'launch_date', 'deliver_date', 'n_target', 'n_collected', 'status',
]

export type Period = { from: string; to: string; label: string }

/** Flexible period → [from,to] (inclusive ISO dates). Accepts an explicit
 *  from/to span, a single date, month(+year), or a whole year. Month without a
 *  year defaults to the current year. */
export function resolvePeriod(a: {
  from?: string; to?: string; date?: string; month?: number; year?: number
}): Period | { error: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  if (a.date) return { from: a.date, to: a.date, label: a.date }
  if (a.from || a.to) {
    const from = a.from ?? a.to as string
    const to = a.to ?? a.from as string
    return { from, to, label: from === to ? from : `${from} … ${to}` }
  }
  if (a.month != null) {
    if (a.month < 1 || a.month > 12) return { error: 'month must be 1–12.' }
    const y = a.year ?? new Date().getFullYear()
    const lastDay = new Date(Date.UTC(y, a.month, 0)).getUTCDate()
    return { from: `${y}-${pad(a.month)}-01`, to: `${y}-${pad(a.month)}-${pad(lastDay)}`, label: `${y}-${pad(a.month)}` }
  }
  if (a.year != null) return { from: `${a.year}-01-01`, to: `${a.year}-12-31`, label: String(a.year) }
  return { error: 'Specify a period: date, month (+year), year, or from + to.' }
}

const BASE_SELECT =
  'project_code, project_name, client, project_type, phase, status, board_column, salesperson, ' +
  'submitted_date, launch_date, due_date, deliver_date, n_target, n_collected, n_actual, audience_size, ' +
  'budget, actual_spend, longitudinal, survey_tool_id, slack_channel_url, latest_next_steps, ' +
  'captain:team_members(name, initials)'

/** Rows whose `event` date falls within [from,to]. Excludes Internal + deleted. */
export async function surveyRows(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType }): Promise<Row[]> {
  const col = EVENT_DATE[opts.event]
  const supabase = createAdminClient()
  let q = supabase
    .from('survey_projects')
    .select(BASE_SELECT)
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    .not(col, 'is', null)
    .gte(col, opts.from)
    .lte(col, opts.to)
    .order(col, { ascending: true })
  if (opts.type) q = q.eq('project_type', opts.type)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Row[]
}

/** Counts for the period+event, broken down by type (PS/B2B/Rerun) + total. */
export async function surveyStats(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType }) {
  const rows = await surveyRows(opts)
  const byType: Record<string, number> = { PS: 0, B2B: 0, Rerun: 0 }
  for (const r of rows) {
    const t = String(r.project_type ?? 'Other')
    byType[t] = (byType[t] ?? 0) + 1
  }
  return { total: rows.length, by_type: byType }
}

function fmt(v: unknown): string | number {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v
  return String(v)
}

/** Project a raw row down to the chosen fields, keyed by human label (for xlsx/table). */
export function projectRow(r: Row, fieldKeys: string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const key of fieldKeys) {
    const f = REPORT_FIELDS.find(x => x.key === key)
    if (f) out[f.label] = fmt(f.get(r))
  }
  return out
}

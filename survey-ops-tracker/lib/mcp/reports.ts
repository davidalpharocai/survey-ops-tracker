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

/** Rows whose `event` date falls within [from,to]. Excludes Internal + deleted +
 *  placeholder rerun waves (migration 075 delivered/Closed stubs pending data —
 *  they'd otherwise count as real delivered/archived surveys in reports). The
 *  count of excluded placeholders is surfaced separately via
 *  countScopedPlaceholders() so the omission stays transparent. Null-safe for
 *  pre-075 rows. */
export async function surveyRows(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType }): Promise<Row[]> {
  const col = EVENT_DATE[opts.event]
  const supabase = createAdminClient()
  let q = supabase
    .from('survey_projects')
    .select(BASE_SELECT)
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    .or('is_placeholder.is.null,is_placeholder.eq.false')
    .not(col, 'is', null)
    .gte(col, opts.from)
    .lte(col, opts.to)
    .order(col, { ascending: true })
  if (opts.type) q = q.eq('project_type', opts.type)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Row[]
}

/** How many placeholder rerun waves (is_placeholder=true) fall in the SAME
 *  event+period+type scope as surveyRows — i.e. the number excluded from the
 *  report. Surfaced as a footnote so a period's totals never silently omit rows. */
export async function countScopedPlaceholders(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType }): Promise<number> {
  const col = EVENT_DATE[opts.event]
  const supabase = createAdminClient()
  let q = supabase
    .from('survey_projects')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    .eq('is_placeholder', true)
    .not(col, 'is', null)
    .gte(col, opts.from)
    .lte(col, opts.to)
  if (opts.type) q = q.eq('project_type', opts.type)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** Footnote string for a report when N placeholder waves were excluded (undefined
 *  when none, so it drops out of JSON output). */
function placeholderNote(n: number): string | undefined {
  return n > 0 ? `Excludes ${n} placeholder wave(s) pending data.` : undefined
}

/** Counts for the period+event, broken down by type (PS/B2B/Rerun) + total.
 *  Placeholder waves are excluded (see surveyRows); `placeholders_excluded` +
 *  `note` report how many were left out. */
export async function surveyStats(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType }) {
  const rows = await surveyRows(opts)
  const byType: Record<string, number> = { PS: 0, B2B: 0, Rerun: 0 }
  for (const r of rows) {
    const t = String(r.project_type ?? 'Other')
    byType[t] = (byType[t] ?? 0) + 1
  }
  const placeholders_excluded = await countScopedPlaceholders(opts)
  return { total: rows.length, by_type: byType, placeholders_excluded, note: placeholderNote(placeholders_excluded) }
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

// ---- ops_metrics: period-scoped analytics (mirrors the in-app Insights defs) ----

// Day diff between two YYYY-MM-DD dates (UTC midnight so DST can't skew it).
const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
function shiftDate(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function aggregate(rows: Row[]) {
  const by_type: Record<string, number> = { PS: 0, B2B: 0, Rerun: 0 }
  let n_target = 0, n_collected = 0, n_actual = 0, budget = 0, actual_spend = 0, over_budget = 0
  let onTimeDenom = 0, onTime = 0
  const cycles: number[] = []
  const fielding: number[] = []
  for (const r of rows) {
    const t = String(r.project_type ?? 'Other'); if (t in by_type) by_type[t]++
    n_target += Number(r.n_target ?? 0)
    n_collected += Number(r.n_collected ?? 0)
    n_actual += Number(r.n_actual ?? 0)
    const b = r.budget == null ? null : Number(r.budget)
    const s = r.actual_spend == null ? null : Number(r.actual_spend)
    if (b != null) budget += b
    if (s != null) actual_spend += s
    if (b != null && s != null && s > b) over_budget++
    const sub = r.submitted_date as string | null
    const del = r.deliver_date as string | null
    const due = r.due_date as string | null
    const lau = r.launch_date as string | null
    if (del && due) { onTimeDenom++; if (del <= due) onTime++ }              // on-time = delivered on/before due
    if (sub && del) { const d = dayDiff(sub, del); if (d >= 0) cycles.push(d) }  // cycle = submitted→delivered
    if (lau && del) { const d = dayDiff(lau, del); if (d >= 0) fielding.push(d) } // fielding = launched→delivered
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  return {
    count: rows.length,
    by_type,
    on_time_pct: onTimeDenom ? Math.round((onTime / onTimeDenom) * 100) : null,
    on_time_denom: onTimeDenom,
    avg_cycle_days: avg(cycles),
    avg_fielding_days: avg(fielding),
    n_target, n_collected, n_actual,
    collection_pct: n_target > 0 ? Math.round((n_collected / n_target) * 100) : null,
    budget: Math.round(budget),
    actual_spend: Math.round(actual_spend),
    over_budget,
    budget_used_pct: budget > 0 ? Math.round((actual_spend / budget) * 100) : null,
  }
}

/** Period-scoped operational metrics for surveys whose `event` date falls in
 *  [from,to]. With compare, also computes the equal-length immediately-prior
 *  period for a period-over-period read. */
export async function opsMetrics(opts: { event: SurveyEvent; from: string; to: string; type?: SurveyType; compare?: boolean }) {
  const agg = aggregate(await surveyRows({ event: opts.event, from: opts.from, to: opts.to, type: opts.type }))
  let prior: { from: string; to: string; count: number; on_time_pct: number | null; actual_spend: number } | null = null
  if (opts.compare) {
    const len = Math.max(1, dayDiff(opts.from, opts.to) + 1)
    const pTo = shiftDate(opts.from, -1)
    const pFrom = shiftDate(opts.from, -len)
    const pAgg = aggregate(await surveyRows({ event: opts.event, from: pFrom, to: pTo, type: opts.type }))
    prior = { from: pFrom, to: pTo, count: pAgg.count, on_time_pct: pAgg.on_time_pct, actual_spend: pAgg.actual_spend }
  }
  // Placeholder waves are excluded from the aggregate (see surveyRows); surface
  // how many were left out of the CURRENT period so the metrics stay transparent.
  const placeholders_excluded = await countScopedPlaceholders({ event: opts.event, from: opts.from, to: opts.to, type: opts.type })
  return { ...agg, prior, placeholders_excluded, note: placeholderNote(placeholders_excluded) }
}

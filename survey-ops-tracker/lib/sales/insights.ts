import type { InsightsProject } from '@/lib/insights/load'
import { serializeInsightsFilter, type InsightsFilter } from '@/lib/insights/filters'
import {
  buildInsightsModel, daysText, pctText, type InsightsModel,
} from '@/lib/insights/model'
import { fmtNum } from '@/lib/utils/number'

/**
 * The salesperson's Insights dashboard, as data.
 *
 * David, 2026-09-30: "in the sales view, they should be able to see an insights
 * type of dashboard catered to their book as well."
 *
 * ── THIS FILE COMPUTES NO FIGURE ────────────────────────────────────────────
 * Every number on /sales/insights comes from lib/insights/model.ts — the same
 * pure, unit-tested model the analyst dashboard renders. What counts as
 * delivered, what a cycle time is, what "on time" means, when a comparison is
 * withheld: one definition, one set of tests, two pages.
 *
 * That is the whole design and it is worth stating why, because writing a
 * second, smaller model here would have been quicker. lib/finance/revenue.ts
 * exists because five copies of one billing rule drifted until they disagreed
 * by $96,480. A salesperson and an analyst reading different cycle times for
 * the same study is the same failure in a cheaper currency: the first time the
 * two numbers meet in a meeting, neither is trusted again.
 *
 * So this module is an ADAPTER. It maps the sales view's rows into the shape
 * the model reads, decides what a book view should not show, and writes the one
 * sentence at the top. Nothing else.
 *
 * ── NO MONEY, BY CONSTRUCTION ───────────────────────────────────────────────
 * Stronger here than on the analyst page. That page has to be careful about
 * which columns it selects, because it reads survey_projects, where budget and
 * actual_spend live. This page reads sales_projects — a definer view with an
 * explicit column allowlist (102) that carries no money column at all. There
 * is no money to leave out.
 *
 * ── WHAT A BOOK VIEW DELIBERATELY DROPS ─────────────────────────────────────
 * The analyst model returns slices this page does not render:
 *   · byCaptain, and the workload-by-captain chart. Who internally is carrying
 *     how much work, and who is behind, is an ops question. It is not a
 *     salesperson's business and it is not their book — and sales_projects does
 *     not carry the captain, so the model sees every study as uncaptained
 *     anyway. Rendering it would draw one grey "No captain" bar over the whole
 *     book, which is worse than nothing.
 *   · The captain filter, for the same reason.
 * These are dropped in the COMPONENT, not here, because the model is shared and
 * must stay the model. See SALES_DROPS.
 *
 * ── WHAT THE VIEW DOES NOT CARRY, AND WHAT THAT COSTS ───────────────────────
 * After migration 130 the answer is: nothing that changes a figure. Before it,
 * is_placeholder is missing and every empty auto-spawned rerun shell in the
 * Delivery column counts as delivered work — 18 of them on real books today.
 * `salesInsightsState` detects that and the page refuses to draw rather than
 * printing an inflated count behind a warning.
 */

/* ── ROWS ───────────────────────────────────────────────────────────────── */

/**
 * A row as `sales_projects` returns it.
 *
 * Read with `select('*')`, never a column list: migration 130 is applied by
 * hand and PostgREST rejects a WHOLE select that names a column the schema has
 * not got, so naming is_placeholder before it lands would take this page dark
 * instead of degrading it. `*` on this view is safe in a way it would never be
 * on the base table — the view IS the allowlist.
 */
export interface SalesProjectRow {
  id: string
  project_code?: string | null
  project_name?: string | null
  client?: string | null
  client_id?: string | null
  status?: string | null
  phase?: string | null
  board_column?: string | null
  project_type?: string | null
  submitted_date?: string | null
  launch_date?: string | null
  due_date?: string | null
  deliver_date?: string | null
  n_target?: number | null
  n_target_max?: number | null
  n_collected?: number | null
  n_actual?: number | null
  series_id?: string | null
  rerun_number?: number | null
  /** Migration 130. Absent from the row object until it is applied. */
  is_placeholder?: boolean | null
  greenlit_at?: string | null
  cancelled_at?: string | null
}

/** The column whose absence makes every delivered figure wrong. */
export const PLACEHOLDER_COLUMN = 'is_placeholder'

/** The migration that adds it, named on screen so the message is actionable. */
export const PLACEHOLDER_MIGRATION = '130_sales_projects_is_placeholder.sql'

export type SalesInsightsState = 'ready' | 'needs-migration' | 'empty'

/**
 * Can this page draw?
 *
 * Detected from the ROWS rather than by probing the schema: a select that names
 * a missing column errors, and an error is a clumsy thing to build a page state
 * out of. PostgREST returns one object per row with a key per view column, so
 * the first row answers it exactly.
 *
 * An empty book is its own state, not a failure. With no rows the question is
 * unanswerable and also moot — there is nothing to overstate.
 */
export function salesInsightsState(rows: SalesProjectRow[]): SalesInsightsState {
  if (!rows.length) return 'empty'
  return PLACEHOLDER_COLUMN in rows[0] ? 'ready' : 'needs-migration'
}

/**
 * A sales row in the shape lib/insights reads.
 *
 * `captain: null` is not a stub to fill in later — see the header. The two
 * optional dates pass through as whatever the view gave (undefined before 130),
 * which both the classifier and cycleStartOf already treat as "not known".
 */
export function toInsightsProject(r: SalesProjectRow): InsightsProject {
  return {
    id: r.id,
    project_code: r.project_code ?? null,
    project_name: r.project_name ?? null,
    client: r.client ?? null,
    client_id: r.client_id ?? null,
    status: r.status ?? null,
    phase: r.phase ?? null,
    board_column: r.board_column ?? null,
    project_type: r.project_type ?? null,
    submitted_date: r.submitted_date ?? null,
    greenlit_at: r.greenlit_at ?? null,
    launch_date: r.launch_date ?? null,
    due_date: r.due_date ?? null,
    deliver_date: r.deliver_date ?? null,
    n_target: r.n_target ?? null,
    n_target_max: r.n_target_max ?? null,
    n_collected: r.n_collected ?? null,
    n_actual: r.n_actual ?? null,
    is_placeholder: r.is_placeholder ?? null,
    cancelled_at: r.cancelled_at ?? null,
    series_id: r.series_id ?? null,
    rerun_number: r.rerun_number ?? null,
    captain: null,
  }
}

/* ── THE MODEL ──────────────────────────────────────────────────────────── */

export interface SalesInsightsInput {
  rows: SalesProjectRow[]
  /** clients.id → name, from sales_clients. Used only to LABEL accounts. */
  accounts: Map<string, string>
  filter: InsightsFilter
  /** Today in Eastern time, 'YYYY-MM-DD'. */
  today: string
  /** Whose book this is, for the headline. Null falls back to "Your book". */
  owner?: string | null
}

export interface SalesInsightsModel {
  model: InsightsModel
  headline: string
}

/**
 * The child tables the classifier uses to tell an empty shell from real work
 * are not readable by a sales session, so placeholders are judged on the flag
 * alone — the same degraded state the analyst page shows when project_blasts
 * fails, and it says so there in the same words.
 *
 * MEASURED 2026-09-30: of the 22 studies carrying the flag, NONE has a blast,
 * panel or cost row without also having respondents recorded. So flag-alone and
 * the full test give an identical answer today. Where they could ever differ,
 * flag-alone drops a study the full test would keep, which UNDERSTATES delivered
 * work — the safe direction for a number a salesperson reads to a client.
 */
export const PLACEHOLDER_ON_FLAG_ALONE =
  'A study flagged as an empty rerun shell is left out on that flag alone: the blast, panel and cost rows that would confirm it are not readable from a sales session. This can only leave work out, never add it.'

/** The analyst slices a book view does not render, and why. Rendered as the
 *  page's own footnote so the omission is a stated choice, not a gap. */
export const SALES_DROPS =
  'Who internally ran each study, and how the work is spread across the team, are not shown here — that is an operations view, not a book view.'

export function buildSalesInsights(input: SalesInsightsInput): SalesInsightsModel {
  const model = buildInsightsModel({
    projects: input.rows.map(toInsightsProject),
    // No child-row counts: see PLACEHOLDER_ON_FLAG_ALONE.
    rowCounts: null,
    accounts: input.accounts,
    filter: input.filter,
    today: input.today,
  })
  return { model, headline: salesHeadline(model, input.owner ?? null) }
}

/* ── THE SENTENCE AT THE TOP ────────────────────────────────────────────── */

const s = (n: number, one: string, many = one + 's') => `${fmtNum(n)} ${n === 1 ? one : many}`

/**
 * Written here rather than reused from lib/insights/headline.ts, which is the
 * only thing on this page that is not the analyst's.
 *
 * Two reasons, both about not saying something false. That headline opens "The
 * team delivered …", and this page is one book — the sentence would credit a
 * salesperson with the company's output, or the company with theirs. And it
 * makes "the most since …" and "a record" claims, which rest on a complete
 * history; a book is a slice, so "your best month ever" computed from it can be
 * beaten by a month where the same account sat on someone else's book.
 *
 * So this says less. It states the count, what it rests on, and the model's own
 * comparison — which already refuses to compare when too few studies or undated
 * deliveries could change the answer. No superlatives.
 */
export function salesHeadline(m: InsightsModel, owner: string | null): string {
  const who = owner?.trim() || 'Your book'
  const { cur } = m
  if (cur.delivered === 0) {
    return `${who}: nothing delivered in ${m.rangeLabel}${m.filterWords.length ? ` (${m.filterWords.join(', ')})` : ''}.`
  }

  const parts = [`${who} delivered ${s(cur.delivered, 'study', 'studies')} in ${m.rangeLabel}`]
  // Respondents only where they are recorded, and never implied for the rest:
  // 113 delivered studies have no N today, and "0 respondents" would be a lie
  // about work that happened.
  if (cur.withN > 0) {
    parts.push(
      cur.withN === cur.delivered
        ? `${s(cur.respondents, 'respondent')} in all`
        : `${s(cur.respondents, 'respondent')} across the ${fmtNum(cur.withN)} with a count recorded`,
    )
  }
  const head = parts.join(', ') + '.'

  const tail: string[] = []
  if (m.compare.delivered.state === 'up' || m.compare.delivered.state === 'down') {
    tail.push(m.compare.delivered.text + '.')
  }
  if (cur.onTimePct != null) tail.push(`${pctText(cur.onTimePct)} on time.`)
  if (cur.cycleMedian != null) tail.push(`Typically ${daysText(cur.cycleMedian)} from start to delivery.`)
  return [head, ...tail].join(' ')
}

/* ── THE URL ────────────────────────────────────────────────────────────── */

/** A real href to this page with the filter patched, so right-click and
 *  middle-click work — the analyst `insightsHref` is hard-wired to /insights. */
export function salesInsightsHref(f: InsightsFilter, patch: Partial<InsightsFilter> = {}): string {
  const next = { ...f, ...patch }
  // The captain filter has no control on this page; carrying one through the
  // URL would filter the figures with nothing on screen saying so.
  next.captain = null
  const qs = serializeInsightsFilter(next).toString()
  return qs ? `/sales/insights?${qs}` : '/sales/insights'
}

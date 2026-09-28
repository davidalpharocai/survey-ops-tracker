import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import * as data from '@/lib/mcp/data'
import { blockedText, loadFinanceRaw, type FinanceLoad } from '@/lib/finance/load'
import {
  DEFAULT_FILTER, formatRange, resolveRange, todayET,
  type FinanceFilter, type RangePreset, type RouteFilter,
} from '@/lib/finance/filters'
import {
  buildResultsModel, DEFAULT_GROUP_BY, partsText, RESULTS_NEEDS, resultsInputOf, ROUTE_WORD, TAG_LABEL,
  type GroupRow, type LedgerRow, type ResultsGroupBy, type ResultsInput, type ResultsModel,
} from '@/lib/finance/results'
import { buildPanelsModel, type PanelRow } from '@/lib/finance/panels'

/**
 * finance_results — the connector's copy of the finance page's Results tab.
 *
 * ── THE SAME NUMBERS AS THE PAGE, BY CONSTRUCTION ───────────────────────────
 * It reads with the SAME loader the page uses (lib/finance/load.ts
 * loadFinanceRaw, here on the service-role client every connector read uses),
 * builds the SAME population (resultsInputOf: itemsOf → populationFor
 * 'results') and computes with the SAME buildResultsModel. Nothing in this file
 * does arithmetic on money; it only rounds to the cent for output and joins the
 * model's sentences into text. If the page and this tool ever disagree, one of
 * them is not calling the model.
 *
 * ── FINANCE HOLDERS ONLY, AND ASKED FIRST ───────────────────────────────────
 * Client prices, budgets and margins are finance-only (view_financials: the
 * /finance page is gated to the same people server-side). The capability is
 * checked BEFORE anything is read or resolved, and a caller without it gets a
 * plain refusal and no figure at all — not a zero, not a partial answer.
 *
 * ── READ-ONLY ───────────────────────────────────────────────────────────────
 * Every read is a SELECT through loadFinanceRaw (and resolveClient for a named
 * account). Nothing is written.
 */

export interface FinanceResultsArgs {
  /** A range preset; ignored when from/to are given. Default: since 1 June 2026. */
  range?: Exclude<RangePreset, 'custom'>
  /** A custom range, inclusive ISO dates. Either end may be left open. */
  from?: string
  to?: string
  /** An account: its name, its Cl code, or its clients.id. */
  account?: string
  route?: RouteFilter
  group_by?: ResultsGroupBy
}

type AccountRef = { id: string; name: string | null } | { ambiguous: { code: string | null; name: string }[] } | null

/** What the tool reaches outside itself, so a test can hand it a fixture. */
export interface FinanceResultsDeps {
  canViewFinancials: (ctx: { userId?: string | null }) => Promise<boolean>
  load: () => Promise<FinanceLoad>
  resolveAccount: (ref: string) => Promise<AccountRef>
  now: () => Date
}

export const defaultFinanceResultsDeps: FinanceResultsDeps = {
  canViewFinancials: ctx => data.callerCanViewFinancials(ctx),
  load: () => loadFinanceRaw(createAdminClient()),
  resolveAccount: async ref => {
    const r = await data.resolveClient(ref)
    if (r == null) return null
    if ('ambiguous' in r) return { ambiguous: r.ambiguous as { code: string | null; name: string }[] }
    return { id: String(r.id), name: (r.name as string | null) ?? null }
  },
  now: () => new Date(),
}

export const FINANCE_REFUSAL =
  'Finance results are limited to people with finance access (the view_financials capability). ' +
  'Nothing was read. Say you cannot show client prices, costs against price or margins, rather than reporting any figure.'

/** How many Tile 2 rows the tool returns before it says it truncated. */
export const MAX_ROWS = 100

const ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Money to the cent, as the page prints it before rounding to dollars. */
export const cents = (x: number | null | undefined): number | null =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100
/** A fraction as a percentage to one decimal (0.4183 → 41.8). */
const pct = (x: number | null | undefined): number | null =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10

export async function financeResults(
  args: FinanceResultsArgs, ctx: { userId?: string | null },
  deps: FinanceResultsDeps = defaultFinanceResultsDeps,
): Promise<Record<string, unknown>> {
  if (!(await deps.canViewFinancials(ctx))) return { error: FINANCE_REFUSAL, restricted: true }

  // ── the filter ─────────────────────────────────────────────────────────
  for (const [k, v] of [['from', args.from], ['to', args.to]] as const) {
    if (v != null && v !== '' && !(ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) {
      return { error: `${k} must be a date written YYYY-MM-DD (got "${v}").` }
    }
  }
  const from = args.from || null
  const to = args.to || null
  if (from && to && from > to) return { error: `from (${from}) is after to (${to}).` }
  const range: FinanceFilter['range'] = from || to
    ? { preset: 'custom', from, to }
    : { preset: args.range ?? DEFAULT_FILTER.range.preset, from: null, to: null }

  // Resolved before the (large) load, so a typo costs one small read.
  let accountId: string | null = null
  const ref = args.account?.trim()
  if (ref && !UUID.test(ref)) {
    const r = await deps.resolveAccount(ref)
    if (r == null) return { error: `No account found matching "${ref}".` }
    if ('ambiguous' in r) {
      return { note: 'Several accounts match — name one exactly, or pass its Cl code.', candidates: r.ambiguous }
    }
    accountId = r.id
  } else if (ref) {
    accountId = ref
  }

  const load = await deps.load()
  const failed = load.blocked.filter(b => RESULTS_NEEDS.includes(b.table))
  if (failed.length) {
    return {
      error: `${failed.map(b => blockedText(b.table)).join('; ')}. These figures are missing, not zero — do not report any of them.`,
      blocked: failed.map(b => ({ table: b.table, message: b.message })),
    }
  }
  const account = accountId ? load.raw.accounts.find(a => a.id === accountId) ?? null : null
  if (accountId && !account) return { error: `No account with id "${accountId}" is in the finance data (it may be a demo account, which finance leaves out).` }

  const filter: FinanceFilter = { range, account: accountId, route: args.route ?? 'all' }
  const today = todayET(deps.now())
  const groupBy = args.group_by ?? DEFAULT_GROUP_BY
  const input = resultsInputOf(load, filter, today, groupBy)
  const model = buildResultsModel(input)
  if (model.priceBlock) {
    return { error: `${model.priceBlock}. These figures are missing, not zero — do not report any of them.` }
  }
  return resultsOutput(model, input, account?.name ?? null)
}

/** The model as the tool returns it: the page's figures to the cent, its
 *  sentences as text. Exported so a test can hold it against the model.
 *
 *  It takes the model's own INPUT rather than the filter and the date, because
 *  the panel grouping is drawn by the page from a second model over the same
 *  population (lib/finance/panels.ts), and the tool has to return what the page
 *  shows rather than an empty list with an apology. */
export function resultsOutput(
  model: ResultsModel, input: ResultsInput, accountName: string | null,
): Record<string, unknown> {
  const t1 = model.tile1
  const { filter, today } = input
  const bounds = resolveRange(filter.range, today)
  const panels = model.groupBy === 'panel' ? panelsOf(input) : null
  const tile2Rows = model.groupBy === 'survey'
    ? model.ledger.map(ledgerOut)
    : model.tile2.rows.map(groupOut)
  const verdict = partsText(model.verdict)
  return {
    ok: true,
    scope: model.scope.chip,
    ignored_filters: model.scope.ignored,
    filter: {
      range: filter.range.preset,
      dates: formatRange(bounds),
      from: bounds.from,
      to: bounds.to,
      account: filter.account ? { id: filter.account, name: accountName } : null,
      route: filter.route,
      group_by: model.groupBy,
    },
    tile1: {
      title: 'What clients pay vs what we spent',
      margin_set_surveys: t1.surveys,
      client_price: cents(t1.clientPrice),
      our_cost: cents(t1.ourCost),
      cost_cents_per_dollar_of_price: pct(t1.costPerDollar),
      we_keep: cents(t1.kept),
      we_keep_pct: pct(t1.keptPct),
      paid_work: { surveys: t1.paid.surveys, we_keep: cents(t1.paid.kept), we_keep_pct: pct(t1.paid.keptPct) },
      given_away_at_0: { surveys: t1.free.surveys, cost: cents(t1.free.cost) },
      // Priced above $0 and billed no respondents: in neither bucket above, and
      // its whole cost is a loss. Reported so "paid work" can be read honestly.
      billed_no_respondents: { surveys: t1.zeroBilled.surveys, cost: cents(t1.zeroBilled.cost) },
      budget_set_at: {
        median_cents_per_dollar_of_price: pct(t1.budget.medianPerDollar),
        surveys_in_median: t1.budget.n,
        over_budget: t1.budget.overBudget,
        over_budget_still_made_money: t1.budget.overBudgetMadeMoney,
        // The base over_budget is counted out of: margin-set surveys with a
        // budget, which is neither surveys_in_median nor delivered_with_a_budget.
        margin_set_with_a_budget: t1.budget.withBudgetInMargin,
        delivered_with_a_budget: t1.budget.withBudget,
      },
      priced_above_0: t1.pricedAboveZero,
      spent_more_than_half_their_price: t1.spentOverGoal,
      words: {
        client_price: `${t1.text.price.value} — ${t1.text.price.sub}`,
        our_cost: `${t1.text.cost.value} — ${t1.text.cost.sub}`,
        we_keep: `${t1.text.kept.value} — ${t1.text.kept.sub}`,
        budget_set_at: `${t1.text.budget.value} — ${t1.text.budget.sub}`,
      },
    },
    coverage: {
      text: partsText(model.coverage.parts),
      delivered_surveys: model.coverage.deliveredSurveys,
      delivered_spend: cents(model.coverage.deliveredSpend),
      margin_share_of_spend_pct: pct(model.coverage.share),
      no_price: { surveys: model.coverage.noPrice.surveys, spend: cents(model.coverage.noPrice.spend) },
      priced_not_billable_yet: { surveys: model.coverage.pricedBlocked.surveys, spend: cents(model.coverage.pricedBlocked.spend) },
      priced_with_no_cost: model.coverage.pricedNoCost.surveys,
    },
    spend_lines: model.waterfall.lines.map(l => ({ line: l.label, amount: cents(l.amount), surveys: l.surveys })),
    sms_sends: model.waterfall.sms.words,
    recoveries: model.waterfall.note,
    not_in_figures: {
      text: partsText(model.notIn.parts),
      cancelled: { surveys: model.notIn.cancelled.surveys, spend: cents(model.notIn.cancelled.spend) },
      archived_without_delivery: { surveys: model.notIn.archived.surveys, spend: cents(model.notIn.archived.spend) },
    },
    months: model.months.map(m => ({
      month: m.key,
      label: m.label,
      client_price: cents(m.price),
      our_cost: cents(m.cost),
      we_keep: cents(m.kept),
      we_keep_pct: pct(m.keptPct),
      we_keep_pct_paid_work: pct(m.paidKeptPct),
      margin_surveys: m.surveys,
      delivered_surveys: m.delivered,
      given_away_at_0: m.freeSurveys,
      spend_with_no_price: cents(m.spendNoPrice),
      costs_recorded: !m.beforeReliable,
      thin: m.thin,
      recoveries_pending: m.recoveriesPending,
      note: m.note,
    })),
    undated: model.undated,
    costs_recorded_from: model.costReliableFrom,
    verdict,
    tile2: {
      title: 'Where it was made and lost',
      group_by: model.groupBy,
      ...(panels
        ? {
          rows: panels.rows.slice(0, MAX_ROWS).map(panelOut),
          total_rows: panels.rows.length,
          truncated: panels.rows.length > MAX_ROWS,
          verdict: panels.verdict,
          panel_spend: cents(panels.total.spend),
          panel_completes: panels.total.completes,
          price_per_complete_all_panels: cents(panels.total.cpc),
          paid_above_the_cheapest_panel: cents(panels.total.above),
          note: 'Panel spend only, split by supplier. Clients pay per survey, not per panel, so there is no client price or margin by panel; the Panel line of spend_lines is this same money in one figure.',
        }
        : {
          rows: tile2Rows.slice(0, MAX_ROWS),
          total_rows: tile2Rows.length,
          truncated: tile2Rows.length > MAX_ROWS,
          verdict: partsText(model.tile2.verdict),
        }),
    },
    summary: `${model.scope.chip}: client price $${(cents(t1.clientPrice) ?? 0).toLocaleString('en-US')}, ` +
      `our cost $${(cents(t1.ourCost) ?? 0).toLocaleString('en-US')}, we keep ` +
      `${t1.kept < 0 ? '−' : ''}$${Math.abs(cents(t1.kept) ?? 0).toLocaleString('en-US')}` +
      `${t1.keptPct != null ? ` (${pct(t1.keptPct)}%)` : ''} on ${t1.surveys} surveys. ${verdict}`,
    note: 'Client price is price per N × billed N (never more than the N sold, never the pre-QA count); "we keep" is field contribution before salaries and overhead. Every figure counts only the margin set — delivered, priced (a $0 price included), with a delivered N and a target, and a recorded cost — and coverage says how much of the delivered spend that is.',
  }
}

/** The panel supplier rows the page draws, from the panels slice's own model
 *  over the SAME population, so the tool and the card cannot disagree. */
function panelsOf(input: ResultsInput) {
  const raw = input.load.raw
  return buildPanelsModel({
    population: input.population,
    suppliers: raw.suppliers,
    launches: raw.launches,
    blasts: raw.blasts,
    costs: raw.costs,
    ix: input.ix,
    // Without the blast rows the model cannot tell which surveys bought from
    // panels alone, so its outside check stands down. It cannot happen here —
    // project_blasts is in RESULTS_NEEDS and a failure has already refused the
    // call — but the model is told the truth rather than a default.
    blastsLoaded: !input.load.blocked.some(b => b.table === 'project_blasts'),
    items: input.items,
    filter: input.filter,
    today: input.today,
  })
}

function panelOut(r: PanelRow) {
  return {
    panel: r.name,
    spend: cents(r.spend),
    share_of_panel_spend_pct: pct(r.share),
    completes: r.completes,
    completes_with_no_price: r.unpricedCompletes,
    price_per_complete: cents(r.cpc),
    vs_all_panels_pct: pct(r.vsAll),
    surveys: r.surveys,
    waves: r.waves,
    paid_above_the_cheapest_panel: cents(r.above),
  }
}

function groupOut(r: GroupRow) {
  return {
    group: r.label,
    ...(r.sub ? { detail: r.sub } : {}),
    surveys_in_margin: r.measured,
    surveys: r.surveys,
    client_price: cents(r.revenue),
    our_cost: cents(r.cost),
    we_keep: cents(r.kept),
    we_keep_pct: pct(r.keptPct),
    price_per_billed_n: r.blended ? null : cents(r.pricePerBilledN),
    cost_per_billed_n: r.blended ? null : cents(r.costPerBilledN),
    // Surveys whose N actual counts only some of their segments are left out of
    // both per-respondent figures: their cost covers segments that N does not.
    ...(r.partialExcluded ? { per_respondent_surveys_left_out: r.partialExcluded } : {}),
    spend_with_no_price: cents(r.unpricedSpend),
    too_few_to_judge: r.tooFew,
    ...(r.routes.length ? {
      routes: r.routes.map(x => ({
        route: x.label, surveys_in_margin: x.measured, client_price: cents(x.revenue), our_cost: cents(x.cost),
        we_keep: cents(x.kept), we_keep_pct: pct(x.keptPct),
        price_per_billed_n: cents(x.pricePerBilledN), cost_per_billed_n: cents(x.costPerBilledN),
        ...(x.partialExcluded ? { per_respondent_surveys_left_out: x.partialExcluded } : {}),
      })),
    } : {}),
  }
}

function ledgerOut(l: LedgerRow) {
  return {
    survey: l.code,
    account: l.account,
    route: ROUTE_WORD[l.route],
    client_price: cents(l.revenue),
    ...(l.revenue == null ? { price_status: !l.priced ? 'no price' : l.revenueReason === 'no-n-actual' ? 'no delivered N yet' : 'no N target' } : {}),
    our_cost: cents(l.cost),
    we_keep: cents(l.kept),
    we_keep_pct: l.free ? 'given away' : pct(l.keptPct),
    budget: cents(l.budget),
    spend_per_budget_pct: pct(l.spendPerBudget),
    spend_per_price_cents: l.free ? 'given away' : pct(l.spendPerPrice),
    price_per_billed_n: cents(l.pricePerBilledN),
    cost_per_billed_n: cents(l.costPerBilledN),
    tags: l.tags.map(x => TAG_LABEL[x]),
  }
}

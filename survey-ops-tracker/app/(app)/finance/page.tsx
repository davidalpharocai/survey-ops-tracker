'use client'

import { Suspense, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils/number'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { NowTab } from '@/components/finance/NowTab'
import { UnitTab } from '@/components/finance/UnitTab'
import { BookTab } from '@/components/finance/BookTab'
import { SaveTab } from '@/components/finance/SaveTab'
import { money } from '@/components/finance/shared'
import { blastIncidence, cpqrWithCoverage } from '@/lib/finance/cpqr'
import { exportFinanceCsv } from '@/lib/finance/exportFinance'
import { savings } from '@/lib/finance/savings'
import { DrillPanel, type DrillColumn, type DrillSpec } from '@/components/finance/DrillPanel'
import {
  breachRows, cpqrRows, exposureRows, foregoneRows, marginRows, overTargetRows,
  scrubRows, unpricedRows,
} from '@/lib/finance/drills'
import { money as fmtMoney, money2 as fmtMoney2 } from '@/components/finance/shared'
import {
  accountPnl, backlog, bidLadder, budgetVariance, exceptions, inLifecycle, isScoping,
  lifecycleCounts, liveExposure, monthly, surveyPnl, unpricedSpend,
  type Lifecycle,
} from '@/lib/finance/analysis'
import {
  accountOptions, applyFilters, buildIndex, contactOptions, coverage, finDate,
  foregone, marginOf, moneyLost, routeCosts, routeOf, spendByClient, spendOf,
  NO_CONTACT,
  type FinAccount, type FinBlast, type FinContact, type FinCost, type FinProject,
  type FinRate, type FinSupplier, type Route,
} from '@/lib/finance/hub'

/**
 * The finance section.
 *
 * ── WHY THREE TABS ──────────────────────────────────────────────────────────
 * The previous version was one scroll of nine cards computed on two silently
 * different populations, opening with an all-time margin percentage. An FP&A
 * director opens with what is UNRESOLVED, then what a UNIT is worth, then what
 * HAPPENED. The tabs are that order, and each is a single population a reader
 * can hold in their head.
 *
 * ── REVENUE IS GATED; COST IS NOT ───────────────────────────────────────────
 * David's rule: contract dollar value is finance-only. Cost stays open to
 * analysts, who need it. Migration 086 already restricts project_financials at
 * the database layer, so a non-holder's read returns zero rows and the revenue
 * bands would be empty anyway — the capability check is the second lock.
 *
 * ── EVERY FILTER IS IN THE URL ──────────────────────────────────────────────
 * Thousands of views are reachable here and none of them were addressable
 * before: no view could be shared, bookmarked, or survive a refresh.
 */

const PRESETS = [
  { id: 'all', label: 'All time' },
  { id: 'mtd', label: 'Month to date' },
  { id: 'qtd', label: 'Quarter to date' },
  { id: 'lastmonth', label: 'Last full month' },
  { id: 'ytd', label: 'This year' },
  { id: 'custom', label: 'Custom…' },
] as const

const TABS = [
  { id: 'now', label: 'Now', hint: 'What needs a phone call today' },
  { id: 'unit', label: 'Unit economics', hint: 'What one respondent costs and what we charge' },
  { id: 'book', label: 'The book', hint: 'What happened, and how much of it we can see' },
  { id: 'save', label: 'Save', hint: 'Where the money could come out, and what pulling it costs' },
] as const

const LIFECYCLES: { id: Lifecycle; label: string }[] = [
  { id: 'delivered', label: 'Delivered' },
  { id: 'inflight', label: 'In flight' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'abandoned', label: 'Abandoned' },
  { id: 'all', label: 'All' },
]

const COLS =
  'id, project_code, project_name, client, client_id, project_type, board_column, status, phase, ' +
  'deliver_date, launch_date, submitted_date, n_target, n_collected, n_actual, ' +
  'requested_by_contact_id, cancelled_at, budget'

function useFinanceData() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['finance-hub-v3'],
    queryFn: async () => {
      // Paged AND ordered: PostgREST caps at 1000 and truncates SILENTLY, and
      // range() with no ORDER BY has no guaranteed page boundary, so a row can
      // appear twice or not at all across pages.
      // `orderBy` is per table and not always 'id': project_financials is keyed
      // on project_id and HAS no id column. Ordering by a column that does not
      // exist fails the whole request, and the first version of this caught that
      // failure and returned [] — which rendered as "nothing is priced" and
      // silently emptied every revenue figure on the page.
      const page = async <T,>(
        table: string, cols: string, orderBy: string, live = false,
      ): Promise<T[]> => {
        const out: T[] = []
        for (let from = 0; ; from += 1000) {
          const q = supabase.from(table as never).select(cols).order(orderBy).range(from, from + 999)
          const { data, error } = await (live ? q.is('deleted_at', null) : q)
          if (error) throw error
          out.push(...((data ?? []) as unknown as T[]))
          if (!data || data.length < 1000) break
        }
        return out
      }
      // project_financials is RLS-restricted (086): a reader without
      // VIEW_FINANCIALS gets zero ROWS and no error, which is the intended
      // degrade-to-cost-report. A genuine query error is a different thing and
      // must be visible — reporting $0 of revenue because a read failed is the
      // exact error this page keeps having.
      let ratesBroken = false
      const rates = await page<FinRate>('project_financials', 'project_id, price_per_n', 'project_id')
        .catch(() => { ratesBroken = true; return [] as FinRate[] })
      const [projects, blasts, suppliers, costs, launches, clients, contacts] = await Promise.all([
        page<FinProject>('survey_projects', COLS, 'id', true),
        page<FinBlast>('project_blasts', 'project_id, bid, people, completes, cost_per_send, channel, blast_at, scheduled_at, created_at', 'id'),
        page<FinSupplier & { supplier_id: string | null; launch_id: string | null }>('project_suppliers', 'project_id, cpi, n_collected, supplier_id, launch_id', 'id'),
        page<FinCost>('project_costs', 'project_id, amount', 'id'),
        page<{ id: string; project_id: string; target: number | null }>('project_launches', 'id, project_id, target', 'id'),
        page<FinAccount & { is_demo: boolean | null }>('clients', 'id, name, is_demo', 'id'),
        page<FinContact>('client_contacts', 'id, client_id, first_name, last_name, email, archived', 'id'),
      ])
      // Demo and test accounts never count (113). Filtered here rather than in
      // the query because `NULL not in (…)` is NULL, which would also drop every
      // project with no client_id.
      const demo = new Set(clients.filter(c => c.is_demo === true).map(c => c.id))
      return {
        ratesBroken,
        projects: projects.filter(p => !(p.client_id && demo.has(p.client_id))),
        blasts, suppliers, costs, contacts, launches,
        accounts: clients.filter(c => !demo.has(c.id)) as FinAccount[],
        rates: new Map(
          rates.filter(r => r.price_per_n != null).map(r => [r.project_id, Number(r.price_per_n)]),
        ),
      }
    },
    staleTime: 60_000,
  })
}

function FinanceInner() {
  const { data, isLoading, isError } = useFinanceData()
  const canFinance = useCanViewFinancials()
  const router = useRouter()
  const params = useSearchParams()

  const get = (k: string, d = '') => params.get(k) ?? d
  const tab = get('tab', 'now')
  const preset = get('preset', 'all')
  const from = get('from')
  const to = get('to')
  const type = get('type')
  const account = get('account')
  const contact = get('contact')
  const route = get('route')
  const lifecycle = (get('lifecycle', 'delivered') || 'delivered') as Lifecycle
  const drill = get('drill')
  // Scoping work is a pipeline, not a book — out by default (David 2026-09-17).
  const withScoping = get('scoping') === '1'

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k)
    }
    router.replace(`/finance?${next.toString()}`, { scroll: false })
  }

  const view = useMemo(() => {
    if (!data) return null
    const { projects, blasts, suppliers, costs, accounts, contacts, rates, launches } = data
    // One index for the whole render. Without it this memo spends ~250ms of
    // synchronous work per filter change rescanning every child row per project.
    const ix = buildIndex(blasts, suppliers, costs)
    const nameById = new Map(accounts.map(a => [a.id, a.name ?? '(unnamed)']))
    const routeFor = (x: FinProject) => routeOf(x, blasts, suppliers, ix)

    const today = new Date().toISOString().slice(0, 10)
    // Resolve the preset into an explicit FROM **and TO**. `to` was never set
    // before, so 17 future-dated surveys carrying $27,027 leaked into every
    // "last 90 days" view — a period-close bug, not a rounding one.
    let f: string | null = from || null
    let t: string | null = to || null
    if (preset !== 'custom') {
      const y = today.slice(0, 4), m = Number(today.slice(5, 7))
      const q0 = Math.floor((m - 1) / 3) * 3 + 1
      const pad = (n: number) => String(n).padStart(2, '0')
      const lastM = m === 1 ? { y: String(Number(y) - 1), m: 12 } : { y, m: m - 1 }
      const eom = (yy: string, mm: number) => {
        const d = new Date(Date.UTC(Number(yy), mm, 0))
        return d.toISOString().slice(0, 10)
      }
      if (preset === 'mtd') { f = `${y}-${today.slice(5, 7)}-01`; t = today }
      else if (preset === 'qtd') { f = `${y}-${pad(q0)}-01`; t = today }
      else if (preset === 'lastmonth') { f = `${lastM.y}-${pad(lastM.m)}-01`; t = eom(lastM.y, lastM.m) }
      else if (preset === 'ytd') { f = `${y}-01-01`; t = today }
      else { f = null; t = null }
    }

    // Surveys still being SCOPED are excluded before anything else is computed,
    // so they cannot dilute a coverage percentage with work nobody has agreed
    // to do yet. The toggle puts them back.
    const scoped = withScoping ? projects : projects.filter(p => !isScoping(p))
    const scopingCount = projects.filter(isScoping).length
    const lifeFiltered = scoped.filter(p => inLifecycle(p, lifecycle))
    const rows = applyFilters(lifeFiltered, {
      from: f, to: t, type: type || null,
      accountId: account || null,
      contactId: account ? (contact || null) : null,
      route: (route || null) as Route | null,
    }, routeFor)

    const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, nameById)
    const variance = budgetVariance(rows, blasts, suppliers, costs, nameById)
    const { rates: cpqr, mixed: cpqrMixed } = cpqrWithCoverage(rows, blasts, suppliers, costs)
    const medians = new Map<Route, number>(cpqr.map(c => [c.route as Route, c.median]))

    return {
      rows, pnl, variance, cpqr, cpqrMixed,
      resolved: { from: f, to: t },
      rates: routeCosts(rows, blasts, suppliers, costs),
      byAccount: spendByClient(rows, blasts, suppliers, costs, nameById),
      lost: moneyLost(rows, blasts, suppliers, costs),
      gone: foregone(rows, rates),
      margin: marginOf(rows, rates, blasts, suppliers, costs),
      cover: coverage(rows, blasts, suppliers, costs),
      incidence: blastIncidence(rows, blasts, suppliers),
      ladder: bidLadder(rows, blasts),
      // Exposure, backlog and the lifecycle counts describe the WHOLE book, not
      // the lifecycle currently selected — an in-flight overrun does not stop
      // being urgent because the reader is looking at delivered work.
      exposure: liveExposure(scoped, blasts, suppliers, costs, nameById),
      back: backlog(scoped, rates, blasts, suppliers, costs),
      counts: lifecycleCounts(scoped, blasts, suppliers, costs),
      accountsPnl: accountPnl(pnl),
      unpriced: unpricedSpend(pnl),
      queue: exceptions(pnl, variance, medians),
      // Levers describe the WHOLE book, like exposure and backlog: a
      // negotiable send rate does not stop being negotiable because the
      // reader is filtered to one account.
      save: savings(scoped, blasts, suppliers, costs, launches),
      periods: monthly(rows, rates, blasts, suppliers, costs),
      split: rows.reduce((acc, x) => {
        const s = spendOf(x, blasts, suppliers, costs, ix)
        acc.reward += s.reward; acc.send += s.send; acc.panel += s.panel; acc.other += s.other
        return acc
      }, { reward: 0, send: 0, panel: 0, other: 0 }),
      types: [...new Set(projects.map(x => x.project_type).filter(Boolean))].sort() as string[],
      accountOpts: accountOptions(projects, accounts),
      contactOpts: contactOptions(projects, contacts, account || null),
      undated: rows.filter(x => !finDate(x)).length,
      pricedInView: rows.filter(x => rates.has(x.id)).length,
      scopingCount,
    }
  }, [data, preset, from, to, type, account, contact, route, lifecycle, withScoping])

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading the book…</p>
  if (isError || !view) {
    return (
      <p className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load the finance data. Try again, or tell David if it keeps happening.
      </p>
    )
  }

  // -- DRILL-DOWN -----------------------------------------------------------
  // Resolved from the URL so browser Back closes the panel and a view is
  // shareable. Every spec is built from `view.pnl`, the same object the cards
  // render, so the panel cannot end up describing a different population than
  // the figure that opened it -- and the panel re-checks that sum on open.
  const N = (v: unknown) => (v == null ? '--' : fmtNum(Math.round(Number(v))))
  const M = (v: unknown) => (v == null ? '--' : fmtMoney(Number(v)))
  const M2 = (v: unknown) => (v == null ? '--' : fmtMoney2(Number(v)))
  const COL: Record<string, DrillColumn> = {
    account: { header: 'Account', value: r => String(r.account ?? '') },
    route: { header: 'Route', value: r => String(r.route ?? '') },
    target: { header: 'Target', num: true, value: r => N(r.target) },
    collected: { header: 'Collected', num: true, value: r => N(r.collected) },
    actual: { header: 'Delivered', num: true, value: r => N(r.actual) },
    cost: { header: 'Cost', num: true, value: r => M(r.cost) },
    cpc: { header: '$/complete', num: true, value: r => M2(r.cpc) },
    cpqr: { header: 'CPQR', num: true, value: r => M2(r.cpqr) },
    stage: { header: 'Stage', value: r => String(r.board ?? '') },
  }

  const spec: DrillSpec | null = !drill || !view ? null : (() => {
    const pop = (n: number, of: number, what: string) =>
      lifecycle + ' | ' + (route || 'all routes') + ' | ' + fmtNum(n) + ' of ' + fmtNum(of) + ' surveys ' + what
    if (drill === 'scrub') {
      const rows = scrubRows(view.pnl)
      return {
        key: drill, title: 'Lost in QA - completes bought and never delivered',
        population: pop(rows.length, view.rows.length, 'with scrub and a recorded cost'),
        rows, total: { label: 'Scrub at cost', value: view.lost.scrub.dollars }, format: 'money' as const,
        columns: [COL.account, COL.route, COL.collected, COL.actual,
          { header: 'Scrub N', num: true, value: r => N(r.scrubN) },
          COL.cpc,
          { header: 'Scrub $', num: true, value: r => M(r.contribution) },
          { header: 'Hit target?', value: r => (r.stillHitTarget ? 'yes - cost no revenue' : 'no') }],
      }
    }
    if (drill === 'over') {
      const rows = overTargetRows(view.pnl)
      return {
        key: drill, title: 'Delivered above target - billed at nothing',
        population: pop(rows.length, view.rows.length, 'that over-delivered'),
        rows, total: { label: 'Over-delivery at cost', value: view.lost.overTarget.dollars }, format: 'money' as const,
        columns: [COL.account, COL.route, COL.target, COL.collected, COL.actual,
          { header: 'Over N', num: true, value: r => N(r.overN) },
          { header: 'Over $', num: true, value: r => M(r.contribution) }],
      }
    }
    if (drill === 'foregone') {
      const rows = foregoneRows(view.pnl)
      return {
        key: drill, title: 'Revenue foregone - short of target, at the client rate',
        population: pop(rows.length, view.rows.length, 'short of target AND priced'),
        rows, total: { label: 'Never billed', value: view.gone.dollars }, format: 'money' as const,
        columns: [COL.account, COL.target, COL.actual,
          { header: 'Short N', num: true, value: r => N(r.shortN) },
          { header: '$/N', num: true, value: r => M2(r.rate) },
          { header: 'Foregone', num: true, value: r => M(r.contribution) }],
      }
    }
    if (drill === 'margin') {
      const rows = marginRows(view.pnl)
      return {
        key: drill, title: 'Margin - every survey with both a rate and a cost',
        population: pop(rows.length, view.margin.delivered, 'carrying both'),
        rows, total: { label: 'Gross margin', value: view.margin.margin }, format: 'money' as const,
        columns: [COL.account, COL.route,
          { header: '$/N', num: true, value: r => M2(r.rate) },
          { header: 'Revenue', num: true, value: r => M(r.revenue) },
          COL.cost,
          { header: 'Margin', num: true, value: r => M(r.contribution) },
          { header: '%', num: true, value: r => (r.marginPct == null ? '--' : Math.round(Number(r.marginPct) * 100) + '%') }],
      }
    }
    if (drill === 'cpqr-blast' || drill === 'cpqr-panel') {
      const rt = drill === 'cpqr-blast' ? 'blast' : 'panel'
      const rows = cpqrRows(view.pnl, rt)
      const c = view.cpqr.find(x => x.route === rt)
      return {
        key: drill, title: 'CPQR - ' + (rt === 'blast' ? 'B2B blasts' : 'PureSpectrum panel'),
        population: fmtNum(rows.length) + ' delivered ' + rt + ' surveys whose records reconcile',
        rows, total: { label: 'Spend behind the rate', value: c ? c.spend : 0 }, format: 'money' as const,
        columns: [COL.account, COL.collected, COL.actual,
          { header: 'Paid', num: true, value: r => N(r.paidCompletes) },
          COL.cpc, COL.cpqr,
          { header: 'Cost', num: true, value: r => M(r.contribution) }],
      }
    }
    if (drill === 'breach') {
      const rows = breachRows(view.variance.breaches)
      return {
        key: drill, title: 'Past the cost ceiling',
        population: fmtNum(rows.length) + ' of ' + fmtNum(view.variance.measurable) + ' surveys carrying both a ceiling and a cost',
        rows, total: { label: 'Gross overrun', value: view.variance.overrun }, format: 'money' as const,
        columns: [COL.account, COL.route,
          { header: 'Ceiling', num: true, value: r => M(r.budget) },
          { header: 'Spend', num: true, value: r => M(r.spend) },
          { header: '%', num: true, value: r => Math.round(Number(r.pct) * 100) + '%' },
          { header: 'Over by', num: true, value: r => M(r.contribution) },
          COL.stage],
      }
    }
    if (drill === 'exposure') {
      const rows = exposureRows(view.exposure)
      return {
        key: drill, title: 'Live exposure - money still moving',
        population: fmtNum(rows.length) + ' in-flight surveys past a ceiling or past target',
        rows, total: { label: 'Spent so far', value: rows.reduce((t, r) => t + r.contribution, 0) }, format: 'money' as const,
        columns: [COL.account, COL.stage,
          { header: 'Ceiling', num: true, value: r => M(r.budget) },
          { header: 'Spend', num: true, value: r => M(r.contribution) },
          COL.target, COL.collected,
          { header: 'Why', value: r => String(r.reasons ?? '') }],
      }
    }
    if (drill.startsWith('lever-')) {
      const lever = view.save.levers.find(l => 'lever-' + l.key === drill)
      if (!lever) return null
      const ids = new Set(lever.ids)
      const rows = view.pnl.filter(r => ids.has(r.id))
        .map(r => ({ id: r.id, code: r.code, account: r.account, route: r.route,
          collected: r.collected, actual: r.actual, cost: r.cost, cpc: r.cpc,
          contribution: r.cost }))
        .sort((a, b) => b.contribution - a.contribution)
      return {
        key: drill, title: lever.title,
        // The strip reconciles against the surveys' TOTAL spend, not the
        // saving: a lever's dollars are a slice of these rows and cannot be
        // attributed row-by-row without inventing an allocation.
        population: lever.population + ' - rows below are their full recorded cost, not the saving',
        rows, total: { label: 'Recorded cost on these surveys', value: rows.reduce((t, r) => t + r.contribution, 0) },
        format: 'money' as const,
        columns: [COL.account, COL.route, COL.collected, COL.actual,
          { header: 'Cost', num: true, value: r => M(r.contribution) }],
      }
    }
    if (drill === 'unpriced') {
      const rows = unpricedRows(view.pnl)
      return {
        key: drill, title: 'Recorded spend with no client rate',
        population: fmtNum(rows.length) + ' costed surveys carrying no price - this money can never reach a margin',
        rows, total: { label: 'Unpriced spend', value: view.unpriced.total }, format: 'money' as const,
        columns: [COL.account, COL.route, COL.collected, COL.actual,
          { header: 'Cost', num: true, value: r => M(r.contribution) }],
      }
    }
    return null
  })()

  const sel = 'rounded-md border border-border bg-card px-2 py-1 text-[13px]'
  const showMoney = canFinance && view.pricedInView > 0
  const filtered = !!(type || account || route || preset !== 'all' || lifecycle !== 'delivered')

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Finance</h1>
        <span className="text-sm text-muted-foreground">
          {fmtNum(view.rows.length)} surveys in view
          {view.resolved.from && <> · {view.resolved.from} → {view.resolved.to ?? 'today'}</>}
        </span>
      </div>

      <div className="mb-4 flex gap-1 border-b border-border">
        {TABS.map(t => (
          <button
            key={t.id} title={t.hint}
            onClick={() => set({ tab: t.id })}
            className={
              'relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
              (tab === t.id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lifecycle replaces five hardcoded `isDelivered` gates with one visible
          control. Each option carries its own count and spend, so "Abandoned"
          announces the 24 surveys nobody had a name for. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {LIFECYCLES.map(l => {
          const c = view.counts.find(x => x.key === l.id)
          const n = l.id === 'all'
            ? view.counts.reduce((t, x) => t + x.surveys, 0)
            : c?.surveys ?? 0
          return (
            <button
              key={l.id}
              onClick={() => set({ lifecycle: l.id === 'delivered' ? '' : l.id })}
              className={
                'rounded-md border px-2 py-1 text-[13px] transition-colors ' +
                (lifecycle === l.id
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground')
              }
            >
              {l.label} <span className="tabular-nums opacity-70">{fmtNum(n)}</span>
              {c && c.spend > 0 && l.id !== 'delivered' && (
                <span className="ml-1 text-xs opacity-60">{money(c.spend)}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={sel} value={preset} onChange={e => set({
          preset: e.target.value === 'all' ? '' : e.target.value,
          ...(e.target.value === 'custom' ? {} : { from: '', to: '' }),
        })}>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {preset === 'custom' && (
          <>
            <input type="date" className={sel} value={from}
              onChange={e => set({ from: e.target.value })} aria-label="From" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" className={sel} value={to}
              onChange={e => set({ to: e.target.value })} aria-label="To" />
          </>
        )}
        <select className={sel} value={type} onChange={e => set({ type: e.target.value })}>
          <option value="">All types (as filed)</option>
          {view.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={sel} value={route} onChange={e => set({ route: e.target.value })}>
          <option value="">All routes (measured)</option>
          <option value="blast">Blast only</option>
          <option value="panel">Panel only</option>
          <option value="both">Both routes</option>
          <option value="none">No field rows</option>
        </select>
        <select className={sel} value={account}
          onChange={e => set({ account: e.target.value, contact: '' })}>
          <option value="">All accounts</option>
          {view.accountOpts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.surveys})</option>
          ))}
        </select>
        {account && view.contactOpts.length > 0 && (
          <select className={sel} value={contact} onChange={e => set({ contact: e.target.value })}>
            <option value="">All contacts</option>
            {view.contactOpts.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.surveys})</option>
            ))}
          </select>
        )}
        {view.scopingCount > 0 && (
          <button
            onClick={() => set({ scoping: withScoping ? '' : '1' })}
            title="Surveys still being scoped are not sold work. Off by default so they cannot dilute a coverage percentage."
            className={
              'rounded-md border px-2 py-1 text-[13px] transition-colors ' +
              (withScoping
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground')
            }
          >
            {withScoping ? '✓ ' : ''}Include {fmtNum(view.scopingCount)} scoping
          </button>
        )}
        {filtered && (
          <button
            onClick={() => router.replace(`/finance?tab=${tab}`, { scroll: false })}
            className="rounded-md border border-border px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
        {/* Exports EXACTLY the rows in view, with the filter state going into
            the audit log beside the row count — so a pull can be read back as
            "these 82 surveys under these filters", not just "someone exported
            82 rows". Restricted columns are absent for a non-holder, not blank. */}
        <button
          onClick={() => exportFinanceCsv(view.pnl, view.rows, {
            canViewFinancials: canFinance,
            route: `finance-${tab}`,
            label: tab,
            filters: {
              tab, lifecycle, preset, route, type,
              from: view.resolved.from, to: view.resolved.to,
              account: account || null, contact: contact || null,
            },
          })}
          disabled={view.rows.length === 0}
          title={`Download the ${view.rows.length} surveys in view as CSV`}
          className="ml-auto rounded-md border border-border px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
        >
          ⭳ Export {fmtNum(view.rows.length)}
        </button>
      </div>

      {data?.ratesBroken && (
        <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-[13px] text-destructive">
          <span className="font-semibold">Client rates could not be read.</span> Every revenue and
          margin figure below is missing, not zero. Tell David — this is a bug, not an empty book.
        </p>
      )}
      {/* Computed from the same rows as the cards, never written by hand — the
          previous banner was authored in July and was still asserting "4 of 322"
          months after 44 surveys had been priced. */}
      <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Everything here is a floor.</span>{' '}
        {fmtNum(view.cover.deliveredCosted)} of {fmtNum(view.cover.delivered)} delivered surveys in
        this view ({view.cover.deliveredPct}%) carry any recorded cost
        {showMoney && <>, and {fmtNum(view.margin.rated)} carry a client rate</>}. The rest contribute
        $0 because nothing was logged, not because nothing was spent
        {showMoney && <>, so margin describes {fmtNum(view.margin.surveys)} surveys — not the business</>}.
        {view.undated > 0 && <> {fmtNum(view.undated)} surveys carry no date and fall outside any range.</>}
      </p>

      {tab === 'now' && (
        <NowTab exposure={view.exposure} variance={view.variance} queue={view.queue}
          back={view.back} canFinance={canFinance} onDrill={k => set({ drill: k })} />
      )}
      {tab === 'unit' && (
        <UnitTab cpqr={view.cpqr} mixed={view.cpqrMixed} rates={view.rates} accounts={view.accountsPnl}
          ladder={view.ladder} incidence={view.incidence} canFinance={canFinance}
          onDrill={k => set({ drill: k })} />
      )}
      {tab === 'book' && (
        <BookTab periods={view.periods} split={view.split} byAccount={view.byAccount}
          lost={view.lost} gone={view.gone} cover={view.cover} unpriced={view.unpriced}
          canFinance={canFinance} onDrill={k => set({ drill: k })} />
      )}

      {tab === 'save' && (
        <SaveTab view={view.save} onDrill={k => set({ drill: k })} />
      )}

      <DrillPanel spec={spec} onClose={() => set({ drill: '' })} />
    </div>
  )
}

export default function FinancePage() {
  // useSearchParams needs a Suspense boundary in the app router.
  return (
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading the book…</p>}>
      <FinanceInner />
    </Suspense>
  )
}

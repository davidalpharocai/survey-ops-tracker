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
import { money } from '@/components/finance/shared'
import { blastIncidence, cpqrByRoute } from '@/lib/finance/cpqr'
import {
  accountPnl, backlog, bidLadder, budgetVariance, exceptions, inLifecycle,
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
      const [projects, blasts, suppliers, costs, clients, contacts] = await Promise.all([
        page<FinProject>('survey_projects', COLS, 'id', true),
        page<FinBlast>('project_blasts', 'project_id, bid, people, completes, cost_per_send, channel', 'id'),
        page<FinSupplier>('project_suppliers', 'project_id, cpi, n_collected', 'id'),
        page<FinCost>('project_costs', 'project_id, amount', 'id'),
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
        blasts, suppliers, costs, contacts,
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

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k)
    }
    router.replace(`/finance?${next.toString()}`, { scroll: false })
  }

  const view = useMemo(() => {
    if (!data) return null
    const { projects, blasts, suppliers, costs, accounts, contacts, rates } = data
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

    const lifeFiltered = projects.filter(p => inLifecycle(p, lifecycle))
    const rows = applyFilters(lifeFiltered, {
      from: f, to: t, type: type || null,
      accountId: account || null,
      contactId: account ? (contact || null) : null,
      route: (route || null) as Route | null,
    }, routeFor)

    const pnl = surveyPnl(rows, rates, blasts, suppliers, costs, nameById)
    const variance = budgetVariance(rows, blasts, suppliers, costs, nameById)
    const cpqr = cpqrByRoute(rows, blasts, suppliers, costs)
    const medians = new Map<Route, number>(cpqr.map(c => [c.route as Route, c.median]))

    return {
      rows, pnl, variance, cpqr,
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
      exposure: liveExposure(projects, blasts, suppliers, costs, nameById),
      back: backlog(projects, rates, blasts, suppliers, costs),
      counts: lifecycleCounts(projects, blasts, suppliers, costs),
      accountsPnl: accountPnl(pnl),
      unpriced: unpricedSpend(pnl),
      queue: exceptions(pnl, variance, medians),
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
    }
  }, [data, preset, from, to, type, account, contact, route, lifecycle])

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading the book…</p>
  if (isError || !view) {
    return (
      <p className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load the finance data. Try again, or tell David if it keeps happening.
      </p>
    )
  }

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
        {filtered && (
          <button
            onClick={() => router.replace(`/finance?tab=${tab}`, { scroll: false })}
            className="rounded-md border border-border px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
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
          back={view.back} canFinance={canFinance} />
      )}
      {tab === 'unit' && (
        <UnitTab cpqr={view.cpqr} rates={view.rates} accounts={view.accountsPnl}
          ladder={view.ladder} incidence={view.incidence} canFinance={canFinance} />
      )}
      {tab === 'book' && (
        <BookTab periods={view.periods} split={view.split} byAccount={view.byAccount}
          lost={view.lost} gone={view.gone} cover={view.cover} unpriced={view.unpriced}
          canFinance={canFinance} />
      )}
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

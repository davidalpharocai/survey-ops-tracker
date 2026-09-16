'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils/number'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { blastIncidence, cpqrByRoute } from '@/lib/finance/cpqr'
import {
  accountOptions, applyFilters, blastEfficiency, contactOptions, coverage, finDate,
  foregone, marginOf, moneyLost, rateBands, routeCosts, routeOf, spendByClient, spendOf,
  zeroRates, NO_CONTACT,
  type FinAccount, type FinBlast, type FinContact, type FinCost, type FinProject,
  type FinRate, type FinSupplier, type Route,
} from '@/lib/finance/hub'

/**
 * The finance hub.
 *
 * ── WHAT CHANGED, AND WHY THE OLD BANNER WAS A LIE ──────────────────────────
 * This page used to state, in fixed text, that "client rates are recorded on 4
 * of 322 delivered surveys" and that margin was therefore not computable. That
 * was true in July. It is not true now — 44 delivered surveys carry a rate —
 * and a hardcoded caveat that has outlived its data is worse
 * than no caveat, because it tells the reader to stop looking. Every number in
 * the banner is now computed from the same rows as the cards beneath it, so it
 * cannot drift out of agreement with them again.
 *
 * ── REVENUE IS GATED; COST IS NOT ───────────────────────────────────────────
 * David's rule: contract dollar value is finance-only. Cost was always open to
 * analysts and stays open, because the fielding team needs it. So the page
 * splits: the cost report renders for everyone, and the revenue, margin, rate
 * and foregone bands render only for a VIEW_FINANCIALS holder. Migration 086
 * already restricts project_financials at the database layer, so a non-holder's
 * read returns zero rows and the revenue bands would come up empty anyway —
 * this gate is the second lock, not the only one.
 *
 * ── THE COVERAGE LINE IS NOT A FOOTNOTE ─────────────────────────────────────
 * About a third of delivered surveys have any recorded cost, and under a
 * quarter carry a rate. Every total here is a FLOOR and every ratio is about a
 * subset. That is stated beside the numbers in the same weight as the numbers.
 */

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const money2 = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

const PRESETS = [
  { id: 'all', label: 'All time', days: null },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '180', label: 'Last 180 days', days: 180 },
  { id: 'ytd', label: 'This year', days: null },
] as const

const COLS =
  'id, project_code, project_name, client, client_id, project_type, board_column, status, phase, ' +
  'deliver_date, launch_date, submitted_date, n_target, n_collected, n_actual, requested_by_contact_id, cancelled_at'

function useFinanceData() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['finance-hub-v2'],
    queryFn: async () => {
      // Paged: PostgREST caps at 1000 and truncates SILENTLY, which on a money
      // page would mean quietly reporting a subset as the whole.
      const page = async <T,>(
        table: string, cols: string, live = false,
      ): Promise<T[]> => {
        const out: T[] = []
        for (let from = 0; ; from += 1000) {
          const q = supabase.from(table as never).select(cols).range(from, from + 999)
          // Soft-deleted projects are still rows. Every other reader in the app
          // filters them (useProjects does it four times); this page did not,
          // and so counted 32 deleted surveys — including one deleted tonight —
          // into every total it printed.
          const { data, error } = await (live ? q.is('deleted_at', null) : q)
          if (error) throw error
          out.push(...((data ?? []) as unknown as T[]))
          if (!data || data.length < 1000) break
        }
        return out
      }
      // project_financials is RLS-restricted (086): a reader without
      // VIEW_FINANCIALS gets zero rows, not an error. Caught anyway so that a
      // future policy change cannot take the whole cost report down with it —
      // no rates degrades to the cost report, which is a working page.
      const rates = await page<FinRate>('project_financials', 'project_id, price_per_n')
        .catch(() => [] as FinRate[])
      const [projects, blasts, suppliers, costs, clients, contacts] = await Promise.all([
        page<FinProject>('survey_projects', COLS, true),
        page<FinBlast>('project_blasts', 'project_id, bid, people, completes, cost_per_send, channel'),
        page<FinSupplier>('project_suppliers', 'project_id, cpi, n_collected'),
        page<FinCost>('project_costs', 'project_id, amount'),
        page<FinAccount & { is_demo: boolean | null }>('clients', 'id, name, is_demo'),
        page<FinContact>('client_contacts', 'id, client_id, first_name, last_name, email, archived'),
      ])
      // Demo and test accounts never count (migration 113). Filtered here rather
      // than in the query because `NULL not in (…)` is NULL, which would also
      // drop every project with no client_id.
      const demo = new Set(clients.filter(c => c.is_demo === true).map(c => c.id))
      return {
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

function Card({ title, tip, children, wide }: {
  title: string; tip?: string; children: React.ReactNode; wide?: boolean
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-border bg-card shadow-sm ${wide ? 'lg:col-span-2' : ''}`}>
      <h2 className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</span>
        {tip && <InfoTooltip text={tip} />}
      </h2>
      {children}
    </section>
  )
}

function Bar({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'neg' | 'pos' }) {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0
  const bg = tone === 'neg' ? 'bg-red-500' : tone === 'pos' ? 'bg-emerald-500' : 'bg-primary'
  return (
    <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${bg}`} style={{ width: `${w}%` }} />
    </span>
  )
}

/** A number that is allowed to be large, with the population it describes
 *  attached to it. The pairing is the point: no figure on this page appears
 *  without the set it was computed on. */
function Figure({ value, label, sub, tone }: {
  value: string; label: string; sub: string; tone?: 'neg' | 'pos'
}) {
  const c = tone === 'neg' ? 'text-red-600 dark:text-red-400'
    : tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
  return (
    <div className="px-4 py-3">
      <div className={`tabular-nums text-2xl font-semibold ${c}`}>{value}</div>
      <div className="mt-0.5 text-sm">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sub}</div>
    </div>
  )
}

export default function FinancePage() {
  const { data, isLoading, isError } = useFinanceData()
  const canFinance = useCanViewFinancials()
  const [preset, setPreset] = useState<string>('all')
  const [type, setType] = useState<string>('')
  const [account, setAccount] = useState<string>('')
  const [contact, setContact] = useState<string>('')
  const [route, setRoute] = useState<string>('')

  const view = useMemo(() => {
    if (!data) return null
    const { projects, blasts, suppliers, costs, accounts, contacts, rates } = data
    const today = new Date().toISOString().slice(0, 10)
    const p = PRESETS.find(x => x.id === preset)
    let from: string | null = null
    if (p?.days) from = new Date(Date.now() - p.days * 86_400_000).toISOString().slice(0, 10)
    if (preset === 'ytd') from = today.slice(0, 4) + '-01-01'

    const nameById = new Map(accounts.map(a => [a.id, a.name ?? '(unnamed)']))
    const routeFor = (x: FinProject) => routeOf(x, blasts, suppliers)
    const rows = applyFilters(projects, {
      from, type: type || null,
      accountId: account || null,
      contactId: account ? (contact || null) : null,
      route: (route || null) as Route | null,
    }, routeFor)

    const delivered = rows.filter(x => x.board_column === 'Delivery')
    // The N bridge, over delivered surveys that recorded all three figures —
    // one population for all four bars, so the steps actually subtract.
    const bridge = delivered.reduce((a, x) => {
      if (x.n_target == null || x.n_collected == null || x.n_actual == null) return a
      a.surveys++
      a.target += Number(x.n_target)
      a.collected += Number(x.n_collected)
      a.actual += Number(x.n_actual)
      a.billable += Math.min(Number(x.n_actual), Number(x.n_target))
      return a
    }, { surveys: 0, target: 0, collected: 0, actual: 0, billable: 0 })

    return {
      rows,
      rates: routeCosts(rows, blasts, suppliers, costs),
      byClient: spendByClient(rows, blasts, suppliers, costs, nameById),
      lost: moneyLost(rows, blasts, suppliers, costs),
      gone: foregone(rows, rates),
      margin: marginOf(rows, rates, blasts, suppliers, costs),
      bands: rateBands(rows, rates, nameById),
      cpqr: cpqrByRoute(rows, blasts, suppliers, costs),
      incidence: blastIncidence(rows, blasts, suppliers),
      zeros: zeroRates(rows, rates),
      blast: blastEfficiency(rows, blasts),
      cover: coverage(rows, blasts, suppliers, costs),
      bridge,
      split: rows.reduce((acc, x) => {
        const s = spendOf(x, blasts, suppliers, costs)
        acc.reward += s.reward; acc.send += s.send; acc.panel += s.panel; acc.other += s.other
        return acc
      }, { reward: 0, send: 0, panel: 0, other: 0 }),
      types: [...new Set(projects.map(x => x.project_type).filter(Boolean))].sort() as string[],
      accountOpts: accountOptions(projects, accounts),
      contactOpts: contactOptions(projects, contacts, account || null),
      undated: rows.filter(x => !finDate(x)).length,
      pricedInView: rows.filter(x => rates.has(x.id)).length,
    }
  }, [data, preset, type, account, contact, route])

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading the book…</p>
  if (isError || !view) {
    return (
      <p className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load the finance data. Try again, or tell David if it keeps happening.
      </p>
    )
  }

  const { rates, byClient, lost, gone, margin, bands, zeros, blast, cover, split, bridge } = view
  const blastRate = rates.find(r => r.route === 'blast')
  const panelRate = rates.find(r => r.route === 'panel')
  const maxClient = byClient.clients[0]?.total ?? 0
  const sel = 'rounded-md border border-border bg-card px-2 py-1 text-[13px]'
  // Revenue exists on the page only when the reader may see it AND something in
  // view is actually priced. Both conditions, because an empty revenue band with
  // a gate on it still tells a non-holder that revenue is being tracked.
  const showMoney = canFinance && view.pricedInView > 0
  const biggestBand = bands[0]
  const bandShare = biggestBand ? pctOf(biggestBand.surveys, view.pricedInView) : 0

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Finance</h1>
        <span className="text-sm text-muted-foreground">
          {fmtNum(view.rows.length)} surveys in view
        </span>
      </div>

      {/* Computed from the rows below, never hardcoded — the previous version of
          this banner was written in July and was still asserting "4 of 322" and
          "margin is not computable" after 94 surveys had been priced. */}
      <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Everything here is a floor.</span>{' '}
        {fmtNum(cover.deliveredCosted)} of {fmtNum(cover.delivered)} delivered surveys
        ({cover.deliveredPct}%) carry any recorded cost
        {showMoney && <>, and {fmtNum(margin.rated)} carry a client rate</>}.
        The rest contribute $0 because nothing was logged, not because nothing was spent
        {showMoney && <>, so margin below describes {fmtNum(margin.surveys)} surveys — not the business</>}.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={sel} value={preset} onChange={e => setPreset(e.target.value)}>
          {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select className={sel} value={type} onChange={e => setType(e.target.value)}>
          <option value="">All types</option>
          {view.types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={sel} value={route} onChange={e => setRoute(e.target.value)}>
          <option value="">All routes</option>
          <option value="blast">Blast only</option>
          <option value="panel">Panel only</option>
          <option value="both">Both routes</option>
          <option value="none">No field rows</option>
        </select>
        {/* Accounts come from clients.id, so BAM's nine legacy labels are one
            entry here rather than nine. */}
        <select
          className={sel} value={account}
          onChange={e => { setAccount(e.target.value); setContact('') }}
        >
          <option value="">All accounts</option>
          {view.accountOpts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.surveys})</option>
          ))}
        </select>
        {/* Only meaningful once an account is chosen — a contact list across all
            accounts would be 80 names with no way to tell them apart. */}
        {account && view.contactOpts.length > 0 && (
          <select className={sel} value={contact} onChange={e => setContact(e.target.value)}>
            <option value="">All contacts</option>
            {view.contactOpts.map(c => (
              <option key={c.id} value={c.id}>
                {c.id === NO_CONTACT ? c.name : c.name} ({c.surveys})
              </option>
            ))}
          </select>
        )}
        {(type || account || route || preset !== 'all') && (
          <button onClick={() => { setPreset('all'); setType(''); setAccount(''); setContact(''); setRoute('') }}
            className="rounded-md border border-border px-2 py-1 text-[13px] text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
        {view.undated > 0 && preset !== 'all' && (
          <span className="text-xs text-muted-foreground">
            {fmtNum(view.undated)} undated survey{view.undated === 1 ? '' : 's'} fall outside any date range
          </span>
        )}
      </div>

      {showMoney && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <Card
            title="Margin, on the part we can measure"
            tip="Revenue is rate × min(delivered N, target N) — delivery above target bills nothing. Only surveys carrying BOTH a client rate and a recorded cost are in this ratio. Including the priced-but-uncosted surveys would report them at 100% margin and lift the whole figure."
          >
            <div className="grid grid-cols-2 divide-x divide-border/60">
              <Figure
                value={money(margin.margin)} label="gross margin"
                sub={`${money(margin.revenue)} billed − ${money(margin.cost)} recorded cost`}
                tone={margin.margin >= 0 ? 'pos' : 'neg'}
              />
              <Figure
                value={Math.round(margin.pct * 100) + '%'} label="margin rate"
                sub={margin.cancelledSurveys > 0
                  ? `${fmtNum(margin.surveys)} delivered surveys with a rate and a cost. After ${money(margin.cancelledCost)} of cancelled work: ${Math.round(margin.pctAfterCancelled * 100)}%`
                  : `across ${fmtNum(margin.surveys)} delivered surveys that carry both a rate and a cost`}
                tone={margin.pct >= 0 ? 'pos' : 'neg'}
              />
            </div>
            {/* Only when something actually WAS left out. With the account filter
                on, pricedNoCost is often 0, and the sentence then explained an
                exclusion that never happened and quoted the same rate twice. */}
            <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
              {margin.pricedNoCost > 0 ? (
                <>
                  <span className="font-medium text-foreground">Deliberately left out.</span>{' '}
                  {fmtNum(margin.pricedNoCost)} delivered survey{margin.pricedNoCost === 1 ? '' : 's'} carry a
                  rate but no recorded cost ({money(margin.pricedNoCostRevenue)} of revenue). Folding
                  them in would take this rate to {pctOf(
                    margin.revenue + margin.pricedNoCostRevenue - margin.cost,
                    margin.revenue + margin.pricedNoCostRevenue,
                  )}% — higher because their cost is missing, not because the work was better.{' '}
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">Every priced survey here carries a cost</span>,
                  so nothing was excluded from the rate above.{' '}
                </>
              )}
              {margin.unpriced > 0 && (
                <>{fmtNum(margin.unpriced)} delivered survey{margin.unpriced === 1 ? '' : 's'} have no rate at all
                  and are invisible to this card.</>
              )}
            </div>
          </Card>

          <Card
            title="Where the rates come from"
            tip="Every distinct client rate on file, and how many surveys carry it. A rate card that is mostly one number written in one sitting is a different object from a rate card of negotiated prices, and the page should not make them look alike."
          >
            {bands.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing priced in this view.</p>
            ) : (
              <>
                <div className="max-h-[188px] divide-y divide-border/60 overflow-y-auto">
                  {bands.map(b => (
                    <div key={b.rate} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
                      <span className="tabular-nums font-medium">{money2(b.rate)}<span className="text-muted-foreground"> / N</span></span>
                      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                        {b.accounts.join(', ')}
                      </span>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{fmtNum(b.surveys)}</span>
                    </div>
                  ))}
                </div>
                {biggestBand && bandShare >= 40 && (
                  <p className="border-t border-border/60 bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">{bandShare}% of the priced book is one number.</span>{' '}
                    {fmtNum(biggestBand.surveys)} surveys carry exactly {money2(biggestBand.rate)}/N, written as a
                    single backfill rather than negotiated survey by survey. Read the totals below as
                    &ldquo;what this rate implies&rdquo;, not as invoiced revenue.
                  </p>
                )}
                {zeros.length > 0 && (
                  <p className="border-t border-border/60 px-4 py-2.5 text-[13px] leading-relaxed text-red-700 dark:text-red-400">
                    <span className="font-medium">{fmtNum(zeros.length)} survey{zeros.length === 1 ? '' : 's'} carry a rate of $0.00</span> —{' '}
                    {zeros.slice(0, 4).map(z => z.project_code).join(', ')}
                    {zeros.length > 4 && ` +${zeros.length - 4} more`}. Almost certainly an empty field
                    rather than free work; they are excluded from revenue above rather than billed at nothing.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* David, 2026-09-14: "it should be seen as money lost (cost to field
            that N) vs N we can't bill (N we didn't deliver x $/ N)". Two cards,
            never one total — see the note beneath them. */}
        <Card
          title="Money lost"
          tip="Cash that left the building for completes we cannot bill. Priced at each survey's OWN measured cost per complete, never at a route default and never at the client rate."
        >
          <div className="divide-y divide-border/60">
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between text-sm">
                <span>Lost in QA <span className="text-muted-foreground">(scrub)</span></span>
                <span className="tabular-nums">{money(lost.scrub.dollars)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtNum(lost.scrub.n)} completes bought and never delivered, across {fmtNum(lost.scrub.surveys)} surveys
              </div>
              <Bar value={lost.scrub.dollars} max={Math.max(lost.scrub.dollars, lost.overTarget.dollars)} tone="neg" />
            </div>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between text-sm">
                <span>Delivered above target</span>
                <span className="tabular-nums">{money(lost.overTarget.dollars)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtNum(lost.overTarget.n)} completes past the promised N, across {fmtNum(lost.overTarget.surveys)} surveys
              </div>
              <Bar value={lost.overTarget.dollars} max={Math.max(lost.scrub.dollars, lost.overTarget.dollars)} tone="neg" />
            </div>
            {/* David, 2026-09-15: cancelled surveys count. A cancelled survey
                did not lose part of its money — it lost all of it, so the bucket
                is the whole spend. In-flight sits beside it because the same
                `isDelivered` gate was hiding $30,620 of running work. */}
            {lost.cancelled.dollars > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span>Cancelled before delivery</span>
                  <span className="tabular-nums">{money(lost.cancelled.dollars)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {fmtNum(lost.cancelled.surveys)} survey{lost.cancelled.surveys === 1 ? '' : 's'} called off after
                  spending began — every dollar bought something that can never be billed
                </div>
                <Bar value={lost.cancelled.dollars}
                  max={Math.max(lost.scrub.dollars, lost.overTarget.dollars, lost.cancelled.dollars)} tone="neg" />
              </div>
            )}
            {lost.inFlight.dollars > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Still running <span className="text-xs">(not a loss)</span></span>
                  <span className="tabular-nums text-muted-foreground">{money(lost.inFlight.dollars)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  spent so far on {fmtNum(lost.inFlight.surveys)} surveys still in flight. Work in progress,
                  shown because the delivered-only view used to hide it entirely.
                </div>
              </div>
            )}
            <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
              {lost.scrub.surveys > 0 && (
                <>
                  <span className="font-medium text-foreground">
                    {fmtNum(lost.scrubStillHitTarget)} of {fmtNum(lost.scrub.surveys)} scrubbed surveys still cleared their target
                  </span>
                  , so that scrub cost cash and cost no revenue at all. Scrub is a buying problem, not a billing one.{' '}
                </>
              )}
              {lost.uncostedSurveys > 0 && (
                <>A further {fmtNum(lost.uncostedSurveys)} surveys lost {fmtNum(lost.uncostedN)} unbillable N
                  with no cost on file, so none of it is priced here.</>
              )}
            </p>
          </div>
        </Card>

        {showMoney ? (
          <Card
            title="Revenue foregone"
            tip="Surveys that finished SHORT of the N they promised, priced at the client's own rate. This is an invoice never raised — it is not cash that left, and it must not be added to money lost."
          >
            <div className="divide-y divide-border/60">
              <Figure
                value={money(gone.dollars)} label="never billed"
                sub={`${fmtNum(gone.n)} N short of target across ${fmtNum(gone.surveys)} delivered surveys that carry a rate`}
                tone="neg"
              />
              {gone.unpricedN > 0 && (
                <p className="px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {fmtNum(gone.unpricedN)} more N came up short on {fmtNum(gone.unpricedSurveys)} surveys with no rate on file
                  </span>{' '}
                  — {Math.round(gone.unpricedN / Math.max(1, gone.n) * 10) / 10}× the priced shortfall, and unpriceable.
                  The figure above is the part we can see, not the size of the problem.
                </p>
              )}
              <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Do not add these two cards together.</span>{' '}
                Money lost is cash we spent; revenue foregone is an invoice we never raised. One is
                measured at what we paid, the other at what the client pays. A single &ldquo;waste&rdquo;
                total would be two different currencies in one number.
              </p>
            </div>
          </Card>
        ) : (
          <Card title="N we cannot bill" tip="Completes collected that never reach an invoice: lost in QA, or delivered above the promised target.">
            <div className="px-4 py-3">
              <div className="tabular-nums text-2xl font-semibold">{fmtNum(lost.scrub.n + lost.overTarget.n)}</div>
              <div className="mt-0.5 text-sm">completes bought and not billable</div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {fmtNum(lost.scrub.n)} lost in QA, {fmtNum(lost.overTarget.n)} delivered above target.
                What that would have earned is a finance figure and is not shown here.
              </div>
            </div>
          </Card>
        )}

        <Card
          title="Where the N goes"
          tip="One population for all four bars — the delivered surveys that recorded target, collected and actual — so each step genuinely subtracts from the one above it."
          wide
        >
          {bridge.surveys === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No delivered survey in this view recorded target, collected and actual N together.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {([
                ['Bought', bridge.collected, 'completes we paid for'],
                ['Survived QA', bridge.actual, `${fmtNum(bridge.collected - bridge.actual)} scrubbed out`],
                ['Promised', bridge.target, 'the N on the order'],
                ['Billable', bridge.billable, 'min(delivered, promised) — the invoice line'],
              ] as const).map(([label, v, note]) => (
                <div key={label} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{label} <span className="text-xs text-muted-foreground">· {note}</span></span>
                    <span className="tabular-nums">{fmtNum(v)}</span>
                  </div>
                  <Bar value={v} max={Math.max(bridge.collected, bridge.target)}
                    tone={label === 'Billable' ? 'pos' : label === 'Bought' ? 'neg' : 'primary'} />
                </div>
              ))}
              <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                Across {fmtNum(bridge.surveys)} delivered surveys we bought {fmtNum(bridge.collected)} completes
                and could bill {fmtNum(bridge.billable)} — {pctOf(bridge.billable, bridge.collected)}%.
                The gap is the two cards above, and it is the single biggest lever on this page.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="What a complete costs"
          tip="Total recorded cost divided by the completes we actually PAID for — not n_actual, which is post-QA and 12–20% smaller. Only surveys whose recorded completes cover their N are included: a rate drawn from an under-recorded survey has too small a denominator and runs high."
        >
          {!blastRate && !panelRate ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No survey in this view has both a recorded cost and completes that reconcile.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {[panelRate, blastRate].filter(Boolean).map(r => (
                <div key={r!.route} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium capitalize">{r!.route === 'panel' ? 'PureSpectrum panel' : 'B2B blasts'}</span>
                    <span className="tabular-nums text-sm">{money2(r!.median)}<span className="text-muted-foreground"> / complete</span></span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    {money2(r!.p25)} – {money2(r!.p75)} · n={r!.n}
                  </div>
                </div>
              ))}
              {blastRate && panelRate && (
                <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                  A blast complete costs{' '}
                  <span className="font-semibold text-foreground">
                    {Math.round(blastRate.median / panelRate.median)}×
                  </span>{' '}
                  a panel complete — and see CPQR below, where the gap is <em>wider</em> still, because
                  both routes scrub and this card counts completes we bought rather than completes the
                  client received. The routes are not substitutes: choose the one the audience is
                  actually on, then price the consequence.
                </p>
              )}
            </div>
          )}
        </Card>

        {/* CPQR — David asked for this by name. It is NOT a restatement of the
            card above: that divides by completes we PAID for, this divides by
            completes that survived QA into the deliverable. Panel loses 41% of
            what it buys; blast loses none. The two cards disagree on purpose. */}
        <Card
          title="CPQR — cost per qualified respondent"
          tip="Recorded spend ÷ n_actual, the post-QA count the client actually received. Cost per complete (above) divides by what we PAID for instead. The difference between the two cards is the scrub, and it is much larger on panel than on blast. Delivered surveys only — n_actual is not final until a study ships."
        >
          {view.cpqr.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No delivered survey in this view has both a recorded cost and a post-QA count.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {view.cpqr.map(c => (
                <div key={c.route} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">
                      {c.route === 'panel' ? 'PureSpectrum panel' : 'B2B blasts'}
                    </span>
                    <span className="tabular-nums text-sm">
                      {money2(c.blended)}<span className="text-muted-foreground"> / qualified N</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    typical survey {money2(c.median)} · {money2(c.p25)} – {money2(c.p75)} · n={c.n}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {fmtNum(c.paid)} bought → {fmtNum(c.qualified)} delivered ·{' '}
                    <span className="font-medium text-red-600 dark:text-red-400">
                      {Math.round(c.scrubRate * 100)}% scrubbed
                    </span>
                    {c.excluded > 0 && (
                      <> · {fmtNum(c.excluded)} costed survey{c.excluded === 1 ? '' : 's'} excluded, their
                        recorded completes do not cover the N they collected</>
                    )}
                  </div>
                </div>
              ))}
              <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
                {view.incidence && (
                  <>
                    <span className="font-medium text-foreground">Blast incidence is {(view.incidence.rate * 100).toFixed(4)}%</span>
                    {' '}— {fmtNum(view.incidence.completes)} completes from {fmtNum(view.incidence.reach)} people reached.
                    There is no panel equivalent: PureSpectrum reach is never recorded, so the claim that the
                    cost gap is &ldquo;mostly incidence&rdquo; cannot be tested and is not made here.
                  </>
                )}
              </p>
            </div>
          )}
        </Card>

        <Card title="Where the money went" tip="Recorded spend split by what it bought. Send cost is paid whether or not anyone answers; email sends are free (migration 112).">
          <div className="divide-y divide-border/60">
            {([
              ['Panel completes', split.panel],
              ['Blast rewards', split.reward],
              ['Blast sends', split.send],
              ['Other cost lines', split.other],
            ] as const).map(([label, v]) => (
              <div key={label} className="px-4 py-2.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular-nums">{money(v)}</span>
                </div>
                <Bar value={v} max={Math.max(split.panel, split.reward, split.send, split.other)} />
              </div>
            ))}
            <div className="flex items-baseline justify-between bg-muted/30 px-4 py-2.5 text-sm font-medium">
              <span>Total recorded</span>
              <span className="tabular-nums">{money(split.panel + split.reward + split.send + split.other)}</span>
            </div>
          </div>
        </Card>

        <Card title="Blast efficiency" tip="Send cost is incurred the moment a message goes out, answered or not. A blast with NO recorded completes is counted as dead only when it says zero — a blank means the count has not come in yet.">
          <div className="divide-y divide-border/60 text-sm">
            {([
              ['Messages sent', fmtNum(blast.sends)],
              ['Completes', fmtNum(blast.completes)],
              ['Response rate', (blast.responseRate * 100).toFixed(3) + '%'],
              ['Spent on sends', money(blast.sendSpend)],
              ['Spent on rewards', money(blast.rewardSpend)],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between px-4 py-2">
                <span>{k}</span><span className="tabular-nums">{v}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between px-4 py-2">
              <span className="text-muted-foreground">Sends that produced nothing at all</span>
              <span className="tabular-nums">{fmtNum(blast.deadSends)} · {money(blast.deadSpend)}</span>
            </div>
            {/* Every blast in the database carries cost_per_send = $0.02 exactly,
                backfilled by migration 095 as a modelled figure. It is a large
                share of recorded cost and it is not an observed invoice. */}
            <p className="bg-muted/30 px-4 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Send cost is a modelled number.</span>{' '}
              Every blast on file carries the same $0.02 per send, backfilled rather than taken from an
              invoice — so {money(split.send)} of the spend on this page rests on one assumption. The
              &ldquo;produced nothing&rdquo; figure likewise measures what was <em>recorded</em>, not
              what happened: completes are typed in by hand and arrive late.
            </p>
          </div>
        </Card>

        <Card
          title="Spend by account" wide
          tip="One row per account, resolved through clients.id — so BAM's nine legacy labels ('BAM - James Cook', 'BAM - Grey Jones', …) roll into one line instead of splitting the largest account nine ways. 'costed' says how many of an account's surveys actually carry a cost record."
        >
          {byClient.clients.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing in this view.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {byClient.clients.filter(c => c.total > 0).slice(0, 12).map(c => (
                <div key={c.client} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{c.client}</span>
                    <span className="shrink-0 tabular-nums">
                      {money(c.total)}
                      <span className="ml-2 text-xs text-muted-foreground">{Math.round(c.share * 100)}%</span>
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {fmtNum(c.costed)} of {fmtNum(c.surveys)} surveys costed
                  </div>
                  <Bar value={c.total} max={maxClient} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <p className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">What these numbers cannot tell you.</span>{' '}
        {fmtNum(cover.unreconciled)} surveys in this view collected more N than their recorded blasts
        and launches account for — {fmtNum(cover.unattributedCompletes)} completes with no cost attached
        to them. Until those are recorded, every cost figure here is understated and every per-complete
        rate is computed on the surveys that happen to be complete. Demo and test accounts are excluded.
      </p>
    </div>
  )
}

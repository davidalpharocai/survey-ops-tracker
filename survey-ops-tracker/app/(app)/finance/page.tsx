'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { fmtNum } from '@/lib/utils/number'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import {
  applyFilters, blastEfficiency, coverage, finDate, routeCosts, routeOf,
  spendByClient, spendOf, unbillable,
  type FinBlast, type FinCost, type FinProject, type FinSupplier, type Route,
} from '@/lib/finance/hub'

/**
 * The finance hub.
 *
 * ── IT IS A COST REPORT, NOT A P&L, AND SAYS SO AT THE TOP ──────────────────
 * 4 of 322 delivered surveys carry a client rate; there is no contracts,
 * invoices or rate_cards table in this database. Every margin figure it could
 * print would be a statement about four surveys dressed as a statement about
 * the business. So it reports cost, and the banner says why there is no margin
 * rather than leaving the reader to wonder where it went.
 *
 * ── THE COVERAGE LINE IS NOT A FOOTNOTE ─────────────────────────────────────
 * About a third of delivered surveys have any recorded cost. Every total here is
 * therefore a FLOOR. That is stated beside the totals, in the same weight as the
 * totals, because a cost report that quietly reports a third of the cost is
 * worse than none — it will be believed.
 */

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const money2 = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PRESETS = [
  { id: 'all', label: 'All time', days: null },
  { id: '90', label: 'Last 90 days', days: 90 },
  { id: '180', label: 'Last 180 days', days: 180 },
  { id: 'ytd', label: 'This year', days: null },
] as const

const COLS =
  'id, project_code, project_name, client, client_id, project_type, board_column, status, phase, ' +
  'deliver_date, launch_date, submitted_date, n_target, n_collected, n_actual'

function useFinanceData() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['finance-hub'],
    queryFn: async () => {
      // Paged: PostgREST caps at 1000 and truncates SILENTLY, which on a money
      // page would mean quietly reporting a subset as the whole.
      const page = async <T,>(table: string, cols: string): Promise<T[]> => {
        const out: T[] = []
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase.from(table as never).select(cols).range(from, from + 999)
          if (error) throw error
          out.push(...((data ?? []) as unknown as T[]))
          if (!data || data.length < 1000) break
        }
        return out
      }
      const [projects, blasts, suppliers, costs, clients] = await Promise.all([
        page<FinProject>('survey_projects', COLS),
        page<FinBlast>('project_blasts', 'project_id, bid, people, completes, cost_per_send, channel'),
        page<FinSupplier>('project_suppliers', 'project_id, cpi, n_collected'),
        page<FinCost>('project_costs', 'project_id, amount'),
        page<{ id: string; is_demo: boolean | null }>('clients', 'id, is_demo'),
      ])
      // Demo and test accounts never count (migration 113). Filtered here rather
      // than in the query because `NULL not in (…)` is NULL, which would also
      // drop every project with no client_id.
      const demo = new Set(clients.filter(c => c.is_demo === true).map(c => c.id))
      return {
        projects: projects.filter(p => !(p.client_id && demo.has(p.client_id))),
        blasts, suppliers, costs,
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

function Bar({ value, max, tone = 'primary' }: { value: number; max: number; tone?: 'primary' | 'neg' }) {
  const w = max > 0 ? Math.max(1, Math.round((value / max) * 100)) : 0
  return (
    <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${tone === 'neg' ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${w}%` }} />
    </span>
  )
}

export default function FinancePage() {
  const { data, isLoading, isError } = useFinanceData()
  const [preset, setPreset] = useState<string>('all')
  const [type, setType] = useState<string>('')
  const [client, setClient] = useState<string>('')
  const [route, setRoute] = useState<string>('')

  const view = useMemo(() => {
    if (!data) return null
    const { projects, blasts, suppliers, costs } = data
    const today = new Date().toISOString().slice(0, 10)
    const p = PRESETS.find(x => x.id === preset)
    let from: string | null = null
    if (p?.days) from = new Date(Date.now() - p.days * 86_400_000).toISOString().slice(0, 10)
    if (preset === 'ytd') from = today.slice(0, 4) + '-01-01'

    const routeFor = (x: FinProject) => routeOf(x, blasts, suppliers)
    const rows = applyFilters(projects, {
      from, type: type || null, client: client || null, route: (route || null) as Route | null,
    }, routeFor)

    return {
      rows,
      rates: routeCosts(rows, blasts, suppliers, costs),
      byClient: spendByClient(rows, blasts, suppliers, costs),
      waste: unbillable(rows, blasts, suppliers, costs),
      blast: blastEfficiency(rows, blasts),
      cover: coverage(rows, blasts, suppliers, costs),
      split: rows.reduce((acc, x) => {
        const s = spendOf(x, blasts, suppliers, costs)
        acc.reward += s.reward; acc.send += s.send; acc.panel += s.panel; acc.other += s.other
        return acc
      }, { reward: 0, send: 0, panel: 0, other: 0 }),
      types: [...new Set(projects.map(x => x.project_type).filter(Boolean))].sort() as string[],
      clients: [...new Set(projects.map(x => x.client).filter(Boolean))].sort() as string[],
      undated: rows.filter(x => !finDate(x)).length,
    }
  }, [data, preset, type, client, route])

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading the book…</p>
  if (isError || !view) {
    return (
      <p className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Couldn&apos;t load the finance data. Try again, or tell David if it keeps happening.
      </p>
    )
  }

  const { rates, byClient, waste, blast, cover, split } = view
  const blastRate = rates.find(r => r.route === 'blast')
  const panelRate = rates.find(r => r.route === 'panel')
  const maxClient = byClient.clients[0]?.total ?? 0
  const sel = 'rounded-md border border-border bg-card px-2 py-1 text-[13px]'

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Finance</h1>
        <span className="text-sm text-muted-foreground">
          {fmtNum(view.rows.length)} surveys in view
        </span>
      </div>

      {/* Said at the top, at full weight, because it governs every number below. */}
      <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">
        <span className="font-semibold">This is a cost report, not a P&amp;L.</span> Client rates are
        recorded on 4 of 322 delivered surveys and there is no contract or invoice table in SOCC, so
        margin is not computable — anything labelled &ldquo;profit&rdquo; here would be a claim about four
        surveys. And only <span className="font-semibold">{cover.deliveredPct}%</span> of delivered
        surveys in this view carry any recorded cost ({fmtNum(cover.deliveredCosted)} of{' '}
        {fmtNum(cover.delivered)}), so every total below is a <span className="font-semibold">floor</span>.
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
        <select className={sel} value={client} onChange={e => setClient(e.target.value)}>
          <option value="">All accounts</option>
          {view.clients.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(type || client || route || preset !== 'all') && (
          <button onClick={() => { setPreset('all'); setType(''); setClient(''); setRoute('') }}
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

      <div className="grid gap-4 lg:grid-cols-2">
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
                <p className="bg-muted/30 px-4 py-2.5 text-[13px] text-muted-foreground">
                  A blast complete costs{' '}
                  <span className="font-semibold text-foreground">
                    {Math.round(blastRate.median / panelRate.median)}×
                  </span>{' '}
                  a panel complete. They are not substitutes — choose on reach, then price the consequence.
                </p>
              )}
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

        <Card title="N we cannot bill" tip="Revenue is rate × min(delivered, target), so a complete above target is pure cost — and a complete that never survives QA is too. Priced at each survey's OWN cost per complete, never a route default.">
          <div className="divide-y divide-border/60">
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between text-sm">
                <span>Lost in QA <span className="text-muted-foreground">(scrub)</span></span>
                <span className="tabular-nums">{money(waste.scrubCost)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fmtNum(waste.scrub)} completes bought and never delivered</div>
              <Bar value={waste.scrubCost} max={Math.max(waste.scrubCost, waste.overTargetCost)} tone="neg" />
            </div>
            <div className="px-4 py-3">
              <div className="flex items-baseline justify-between text-sm">
                <span>Delivered above target</span>
                <span className="tabular-nums">{money(waste.overTargetCost)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fmtNum(waste.overTarget)} completes past the promised N</div>
              <Bar value={waste.overTargetCost} max={Math.max(waste.scrubCost, waste.overTargetCost)} tone="neg" />
            </div>
            <p className="bg-muted/30 px-4 py-2.5 text-[13px] text-muted-foreground">
              Across {fmtNum(waste.surveys)} delivered surveys. Scrub is the bigger half, so
              &ldquo;stop over-delivering&rdquo; only fixes part of it — the lever is how much raw N gets bought.
            </p>
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
            <div className="flex items-baseline justify-between bg-muted/30 px-4 py-2.5">
              <span className="text-[13px] text-muted-foreground">
                Sends that produced nothing at all
              </span>
              <span className="tabular-nums text-[13px]">
                {fmtNum(blast.deadSends)} · {money(blast.deadSpend)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Spend by account" wide tip="Ordered by recorded spend. 'costed' says how many of an account's surveys actually carry a cost record — the rest contribute $0 because nothing was logged, not because nothing was spent.">
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

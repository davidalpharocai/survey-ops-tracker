'use client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { NProgressBar } from '@/components/shared/NProgressBar'
import { fmtNum } from '@/lib/utils/number'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import { useProjectBlasts, type Blast } from '@/lib/hooks/useProjectBlasts'
import { useProjectLaunches, type ProjectLaunch } from '@/lib/hooks/useProjectLaunches'
import { useProjectSuppliers, type ProjectSupplier } from '@/lib/hooks/useProjectSuppliers'
import {
  projectEstimateRange, projectActualCost, projectCollected, projectTarget, modalCap,
} from '@/lib/utils/suppliers'
import {
  pctOf, computePace, costPerComplete, projectedFinalCost,
  blastCompletionRate, cumulativeCompletes, supplierMix, bestValueSupplier, daysBetween,
} from '@/lib/utils/insights'

function money(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function money2(v: number | null): string {
  return v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function pctStr(v: number | null): string {
  return v == null ? '—' : `${Math.round(v)}%`
}
function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

const card = 'bg-card border border-border shadow-sm rounded-xl p-3'
const sectionTitle = 'text-xs uppercase tracking-widest text-muted-foreground font-medium mb-2 flex items-center'

function KpiCard({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div className={card}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

/** Cumulative-completes line with a dashed target line. */
function Sparkline({ points, target }: { points: number[]; target: number | null }) {
  if (points.length === 0) return null
  const w = 260
  const h = 48
  const max = Math.max(target ?? 0, ...points, 1)
  const n = points.length
  const x = (i: number) => (n === 1 ? w : (i / (n - 1)) * w)
  const y = (v: number) => h - (v / max) * h
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const ty = target != null ? y(target) : null
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-12" preserveAspectRatio="none" role="img" aria-label="Cumulative completes over time">
      {ty != null && (
        <line x1="0" y1={ty} x2={w} y2={ty} stroke="currentColor" strokeDasharray="3 3" className="text-muted-foreground/40" strokeWidth="1" />
      )}
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} className="fill-primary/10" stroke="none" />
      <path d={path} fill="none" className="stroke-primary" strokeWidth="1.5" />
    </svg>
  )
}

function Bar({ frac }: { frac: number }) {
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-primary/70 rounded-full" style={{ width: `${Math.min(100, Math.max(0, frac * 100))}%` }} />
    </div>
  )
}

export function ProjectInsights({ project }: { project: SurveyProject }) {
  const { data: blasts = [] } = useProjectBlasts(project.id)
  const { data: launches = [] } = useProjectLaunches(project.id)
  const { data: suppliers = [] } = useProjectSuppliers(project.id)

  const todayISO = new Date().toISOString()
  const collected = project.n_collected ?? 0
  const target = project.n_target ?? null
  const spend = project.actual_spend ?? 0
  const budget = project.budget ?? null
  const cpc = costPerComplete(spend, collected)
  const projFinal = projectedFinalCost(cpc, target)
  const startISO = project.launch_date ?? project.created_at ?? null
  const pace = computePace({ collected, target, startISO, todayISO })

  const type = project.project_type
  const showB2B = blasts.length > 0 || type === 'B2B'
  const showPS = suppliers.length > 0 || launches.length > 0 || type === 'PS'

  // Empty state — nothing to chart yet.
  if (blasts.length === 0 && suppliers.length === 0 && collected === 0 && spend === 0) {
    return (
      <div className={`${card} max-w-md`}>
        <p className="text-sm text-muted-foreground">
          No performance data yet. Insights populate as you log blasts / launches and enter N collected.
        </p>
      </div>
    )
  }

  // Budget pacing sanity flag: spending faster than collecting.
  const budgetUsed = budget != null && budget > 0 ? spend / budget : null
  const nProgress = target != null && target > 0 ? collected / target : null
  const burningFast = budgetUsed != null && nProgress != null && budgetUsed - nProgress > 0.1

  // Pace vs due date.
  let paceNote: { text: string; tone: 'ok' | 'warn' } | null = null
  if (pace.projectedFinishISO && project.due_date) {
    const over = daysBetween(project.due_date, pace.projectedFinishISO)
    const under = daysBetween(pace.projectedFinishISO, project.due_date)
    paceNote = over > 0 ? { text: `~${over}d past due`, tone: 'warn' } : { text: under > 0 ? `~${under}d of buffer` : 'on the due date', tone: 'ok' }
  }

  return (
    <div className="max-w-4xl flex flex-col gap-4">
      {/* Zone 1 — KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="N progress" tooltip="Completed responses collected vs the project's N target.">
          <p className="text-lg font-semibold text-foreground leading-tight">
            {fmtNum(collected)}
            <span className="text-sm font-normal text-muted-foreground">{target != null ? ` / ${fmtNum(target)}` : ''}</span>
            {nProgress != null && <span className="text-xs font-normal text-muted-foreground"> · {pctStr(nProgress * 100)}</span>}
          </p>
          <div className="mt-1.5"><NProgressBar collected={collected} target={target} showLabel={false} /></div>
        </KpiCard>

        <KpiCard label="Budget" tooltip="Actual spend to date vs the total budget, plus a projected final cost (blended cost/complete × N target).">
          <p className="text-lg font-semibold text-foreground leading-tight">
            {money(spend)}
            <span className="text-sm font-normal text-muted-foreground">{budget != null ? ` / ${money(budget)}` : ''}</span>
            {budgetUsed != null && <span className={`text-xs font-normal ${burningFast ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}> · {pctStr(budgetUsed * 100)}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">proj. final {money(projFinal)}</p>
        </KpiCard>

        <KpiCard label="Cost / complete" tooltip="Blended all-in cost per completed response = actual spend ÷ N collected.">
          <p className="text-lg font-semibold text-foreground leading-tight">{money2(cpc)}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">blended, to date</p>
        </KpiCard>

        <KpiCard label="Pace" tooltip="Completes per day since fielding started, and a linear projection of when the N target is reached.">
          <p className="text-lg font-semibold text-foreground leading-tight">
            {pace.perDay != null ? `${fmtNum(Math.round(pace.perDay))}` : '—'}
            <span className="text-sm font-normal text-muted-foreground">/day</span>
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {pace.projectedFinishISO ? <>≈ {shortDate(pace.projectedFinishISO)}{paceNote && <span className={paceNote.tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}> · {paceNote.text}</span>}</> : 'set a target + start date'}
          </p>
        </KpiCard>
      </div>

      {burningFast && (
        <p className="text-[11px] text-amber-600/90 dark:text-amber-400/90 -mt-2">
          ⚠ Spending is running ahead of collection ({pctStr(budgetUsed! * 100)} of budget for {pctStr(nProgress! * 100)} of N) — check cost per complete.
        </p>
      )}

      {/* Zone 2a — B2B blast performance */}
      {showB2B && blasts.length > 0 && <B2BPerformance blasts={blasts} target={target} />}

      {/* Zone 2b — PS launch/supplier performance */}
      {showPS && suppliers.length > 0 && <PSPerformance launches={launches} suppliers={suppliers} />}
    </div>
  )
}

function B2BPerformance({ blasts, target }: { blasts: Blast[]; target: number | null }) {
  const list = blasts ?? []
  const totalPeople = list.reduce((s, b) => s + (b.people ?? 0), 0)
  const totalCompletes = list.reduce((s, b) => s + (b.completes ?? 0), 0)
  const overallRate = pctOf(totalCompletes, totalPeople)
  const cum = cumulativeCompletes(list).map((p) => p.cumulative)
  const rated = list.filter((b) => blastCompletionRate(b) != null)
  const best = rated.length ? rated.reduce((a, b) => (blastCompletionRate(b)! > blastCompletionRate(a)! ? b : a)) : null
  const worst = rated.length ? rated.reduce((a, b) => (blastCompletionRate(b)! < blastCompletionRate(a)! ? b : a)) : null

  return (
    <div className={card}>
      <p className={sectionTitle}>
        Blast performance
        <InfoTooltip text="Completion rate = completes ÷ people reached. Cost per complete is the $/bid (we only pay completes)." />
        <span className="ml-auto normal-case tracking-normal text-foreground font-medium">{pctStr(overallRate)} completion</span>
      </p>

      <Sparkline points={cum} target={target} />
      <p className="text-[10px] text-muted-foreground/70 mb-2">cumulative completes over time{target != null ? ' (dashed = N target)' : ''}</p>

      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] items-center">
        <span className="text-muted-foreground">when · description</span>
        <span className="text-muted-foreground text-right w-14">people</span>
        <span className="text-muted-foreground text-right w-16">completes</span>
        <span className="text-muted-foreground text-right w-14">compl. %</span>
        <span className="text-muted-foreground text-right w-16">$/bid</span>
        {list.map((b) => (
          <div key={b.id} className="contents">
            <span className="text-foreground truncate">{shortDate(b.blast_at)}{b.note ? ` · ${b.note}` : ''}</span>
            <span className="text-right tabular-nums text-foreground">{fmtNum(b.people ?? 0)}</span>
            <span className="text-right tabular-nums text-foreground">{fmtNum(b.completes ?? 0)}</span>
            <span className="text-right tabular-nums text-foreground">{pctStr(blastCompletionRate(b))}</span>
            <span className="text-right tabular-nums text-foreground">{money2(b.bid)}</span>
          </div>
        ))}
      </div>

      {best && worst && best.id !== worst.id && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Best: <span className="text-foreground">{shortDate(best.blast_at)}</span> {pctStr(blastCompletionRate(best))} · Worst: <span className="text-foreground">{shortDate(worst.blast_at)}</span> {pctStr(blastCompletionRate(worst))}
        </p>
      )}
    </div>
  )
}

function PSPerformance({ launches, suppliers }: { launches: ProjectLaunch[]; suppliers: ProjectSupplier[] }) {
  const rowsFor = (id: string) => suppliers.filter((r) => r.launch_id === id)
  const launchesLite = launches.map((l) => {
    const lines = rowsFor(l.id).map((r) => ({ cpi: r.cpi, completes_cap: r.completes_cap, n_collected: r.n_collected }))
    return { launch: l, lines, target: l.target ?? modalCap(lines) }
  })
  const pCollected = projectCollected(launchesLite.map((x) => ({ target: x.target, lines: x.lines })))
  const pActual = projectActualCost(launchesLite.map((x) => ({ target: x.target, lines: x.lines })))
  const pRange = projectEstimateRange(launchesLite.map((x) => ({ target: x.target, lines: x.lines })))
  const pTarget = projectTarget(launchesLite.map((x) => ({ target: x.target, lines: x.lines })))

  const mix = supplierMix(suppliers.map((r) => ({ name: r.suppliers?.name ?? '—', cpi: r.cpi, n_collected: r.n_collected })))
  const mixTotal = mix.reduce((s, m) => s + m.collected, 0)
  const best = bestValueSupplier(mix)
  const overCap = suppliers.filter((r) => (r.n_collected ?? 0) > r.completes_cap)

  return (
    <div className={card}>
      <p className={sectionTitle}>
        Launch &amp; supplier performance
        <InfoTooltip text="Fill rate = N collected ÷ target per launch. Supplier mix is each supplier's share of all completes. Actual cost = Σ(CPI × N collected)." />
        <span className="ml-auto normal-case tracking-normal text-foreground font-medium">{money(pActual)} actual</span>
      </p>

      {/* Per-launch */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] items-center mb-3">
        <span className="text-muted-foreground">launch</span>
        <span className="text-muted-foreground text-right w-24">collected / target</span>
        <span className="text-muted-foreground text-right w-16">fill</span>
        <span className="text-muted-foreground text-right w-16">cost</span>
        {launchesLite.map(({ launch, lines, target }, i) => {
          const c = lines.reduce((s, r) => s + (r.n_collected || 0), 0)
          const cost = lines.reduce((s, r) => s + (r.cpi || 0) * (r.n_collected || 0), 0)
          const fill = target != null && target > 0 ? c / target : null
          return (
            <div key={launch.id} className="contents">
              <span className="text-foreground truncate">Launch {i + 1}{launch.label ? ` · ${launch.label}` : ''}</span>
              <span className="text-right tabular-nums text-foreground">{fmtNum(c)}{target != null ? ` / ${fmtNum(target)}` : ''}</span>
              <span className="text-right tabular-nums text-foreground">{pctStr(fill != null ? fill * 100 : null)}</span>
              <span className="text-right tabular-nums text-foreground">{money(cost)}</span>
            </div>
          )
        })}
      </div>

      {/* Supplier mix */}
      {mixTotal > 0 && (
        <div className="flex flex-col gap-1.5 mb-2">
          <p className="text-[11px] text-muted-foreground">Supplier mix (share of completes)</p>
          {mix.filter((m) => m.collected > 0).map((m) => (
            <div key={m.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 truncate text-foreground" title={m.name}>{m.name}</span>
              <div className="flex-1 min-w-0"><Bar frac={m.collected / mixTotal} /></div>
              <span className="w-24 text-right tabular-nums text-muted-foreground">{fmtNum(m.collected)} · {pctStr((m.collected / mixTotal) * 100)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground border-t border-border pt-2">
        {best && <span>Best value: <span className="text-foreground">{best.name}</span> @ {money2(best.effectiveCpi)}/complete</span>}
        {pRange && pCollected === 0 && <span>Est. {money(pRange.low)}–{money(pRange.high)}</span>}
        {pCollected > 0 && <span>{fmtNum(pCollected)} collected{pTarget > 0 ? ` / ${fmtNum(pTarget)}` : ''}</span>}
        {overCap.length > 0 && <span className="text-amber-600 dark:text-amber-400">⚠ {overCap.length} supplier{overCap.length === 1 ? '' : 's'} over cap</span>}
      </div>
    </div>
  )
}

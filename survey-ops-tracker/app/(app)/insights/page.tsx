'use client'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { STAGE_ORDER } from '@/lib/utils/stage'
import { differenceInCalendarDays, parseISO } from 'date-fns'

// Read-only analytics derived from data already captured — no new tables.
interface InsightProject {
  id: string
  client: string
  status: string
  phase: string
  scoping_stage: string | null
  board_column: string
  submitted_date: string | null
  due_date: string | null
  deliver_date: string | null
  n_target: number | null
  n_collected: number
  n_actual: number | null
  budget: number | null
  actual_spend: number | null
  captain: { name: string; initials: string } | null
}

const COLS =
  'id, client, status, phase, scoping_stage, board_column, submitted_date, due_date, deliver_date, n_target, n_collected, n_actual, budget, actual_spend, captain:team_members(name, initials)'

function useInsights() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['insights'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(COLS + ', project_type')
        .is('deleted_at', null)
      if (error) throw error
      // Survey-focused insights — internal projects have their own section
      return (data as unknown as (InsightProject & { project_type: string | null })[]).filter(
        p => p.project_type !== 'Internal'
      )
    },
    staleTime: 60_000,
  })
}

const money = (v: number) =>
  '$' + Math.round(v).toLocaleString('en-US')
const tile = 'bg-card border border-border shadow-sm rounded-xl p-3 flex flex-col gap-1'
const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

export default function InsightsPage() {
  const { data: projects = [], isLoading } = useInsights()

  const m = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const weekOut = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const open = projects.filter(p => p.status === 'Open' && p.phase === 'Active')
    const scoping = projects.filter(p => p.status === 'Open' && p.phase === 'Scoping')
    const closed = projects.filter(p => p.status === 'Closed')

    const overdue = open.filter(p => p.due_date && p.due_date <= today)
    const dueThisWeek = open.filter(p => p.due_date && p.due_date > today && p.due_date <= weekOut)
    const behind = open.filter(
      p => p.board_column === 'Fielding' && p.n_target != null && p.n_collected < p.n_target
    )

    // On-time delivery: closed projects with both dates, delivered on/before due
    const deliveredWithDates = closed.filter(p => p.deliver_date && p.due_date)
    const onTime = deliveredWithDates.filter(p => p.deliver_date! <= p.due_date!)
    const onTimePct = deliveredWithDates.length
      ? Math.round((onTime.length / deliveredWithDates.length) * 100)
      : null

    // Avg cycle time: submitted → delivered (closed projects with both)
    const cycles = closed
      .filter(p => p.submitted_date && p.deliver_date)
      .map(p => differenceInCalendarDays(parseISO(p.deliver_date!), parseISO(p.submitted_date!)))
      .filter(d => d >= 0)
    const avgCycle = cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null

    // Pipeline distribution (active)
    const byStage = STAGE_ORDER.map(s => ({ label: s, count: open.filter(p => p.board_column === s).length }))

    // Captain workload (active), with overdue among them
    const capMap = new Map<string, { open: number; overdue: number }>()
    for (const p of open) {
      const name = p.captain?.name ?? 'Unassigned'
      const c = capMap.get(name) ?? { open: 0, overdue: 0 }
      c.open++
      if (p.due_date && p.due_date <= today) c.overdue++
      capMap.set(name, c)
    }
    const workload = [...capMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.open - a.open)

    // Budget rollup (where set)
    const withBudget = projects.filter(p => p.budget != null)
    const totalBudget = withBudget.reduce((s, p) => s + (p.budget ?? 0), 0)
    const withSpend = projects.filter(p => p.actual_spend != null)
    const totalSpend = withSpend.reduce((s, p) => s + (p.actual_spend ?? 0), 0)
    const overBudget = projects.filter(
      p => p.budget != null && p.actual_spend != null && p.actual_spend > p.budget
    )

    // Top clients by total (non-deleted) project count
    const clientMap = new Map<string, number>()
    for (const p of projects) {
      const firm = p.client.split(' - ')[0].trim()
      clientMap.set(firm, (clientMap.get(firm) ?? 0) + 1)
    }
    const topClients = [...clientMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)

    const totalCollected = open.reduce((s, p) => s + p.n_collected, 0)
    const totalTarget = open.reduce((s, p) => s + (p.n_target ?? 0), 0)

    return {
      openCount: open.length, scopingCount: scoping.length, closedCount: closed.length,
      overdue: overdue.length, dueThisWeek: dueThisWeek.length, behind: behind.length,
      onTimePct, onTimeDenom: deliveredWithDates.length, avgCycle, cycleDenom: cycles.length,
      byStage, workload, totalBudget, totalSpend, overBudget: overBudget.length,
      withBudgetCount: withBudget.length, topClients, totalCollected, totalTarget,
    }
  }, [projects])

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={tile}><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-16" /></div>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  const maxStage = Math.max(1, ...m.byStage.map(s => s.count))
  const maxCap = Math.max(1, ...m.workload.map(w => w.open))
  const collectionPct = m.totalTarget > 0 ? Math.round((m.totalCollected / m.totalTarget) * 100) : null

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Insights</h1>
        <span className="text-sm text-muted-foreground">A rollup of the whole pipeline — derived live from your projects.</span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={tile}>
          <span className="text-xs text-muted-foreground">Active projects</span>
          <span className="text-2xl font-semibold text-foreground leading-tight">{m.openCount}</span>
          <span className="text-xs text-muted-foreground">{m.scopingCount} scoping · {m.closedCount} closed</span>
        </div>
        <div className={tile}>
          <span className="text-xs text-muted-foreground flex items-center">Overdue<InfoTooltip text="Active projects past their internal due date." /></span>
          <span className={`text-2xl font-semibold leading-tight ${m.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{m.overdue}</span>
          <span className="text-xs text-muted-foreground">{m.dueThisWeek} due within 7 days</span>
        </div>
        <div className={tile}>
          <span className="text-xs text-muted-foreground flex items-center">On-time delivery<InfoTooltip text="Of closed projects with both a due and deliver date, the share delivered on or before the due date." /></span>
          <span className="text-2xl font-semibold text-foreground leading-tight">{m.onTimePct == null ? '—' : `${m.onTimePct}%`}</span>
          <span className="text-xs text-muted-foreground">{m.onTimeDenom} delivered w/ dates</span>
        </div>
        <div className={tile}>
          <span className="text-xs text-muted-foreground flex items-center">Avg cycle time<InfoTooltip text="Average days from submitted to delivered across closed projects that have both dates." /></span>
          <span className="text-2xl font-semibold text-foreground leading-tight">{m.avgCycle == null ? '—' : `${m.avgCycle}d`}</span>
          <span className="text-xs text-muted-foreground">{m.cycleDenom} closed w/ dates</span>
        </div>
      </div>

      {/* Pipeline distribution */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4">
        <h3 className={heading}>Active pipeline by stage<InfoTooltip text="Where your open work sits right now." /></h3>
        <div className="flex flex-col gap-1.5">
          {m.byStage.map(s => (
            <div key={s.label} className="flex items-center gap-3 text-sm">
              <span className="w-40 shrink-0 text-muted-foreground">{s.label}</span>
              <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                <div className="h-full bg-blue-500/60 rounded-full" style={{ width: `${(s.count / maxStage) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-foreground tabular-nums">{s.count}</span>
            </div>
          ))}
        </div>
        {collectionPct != null && (
          <p className="text-xs text-muted-foreground mt-3">
            Collection across active projects: <span className="text-foreground font-medium">{m.totalCollected.toLocaleString()}</span> of {m.totalTarget.toLocaleString()} responses ({collectionPct}%) · {m.behind} behind target in Fielding
          </p>
        )}
      </div>

      {/* Captain workload */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4">
        <h3 className={heading}>Captain workload (active)<InfoTooltip text="Open projects per captain, with how many are overdue." /></h3>
        {m.workload.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">No active projects.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {m.workload.map(w => (
              <div key={w.name} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 text-muted-foreground truncate">{w.name}</span>
                <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                  <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${(w.open / maxCap) * 100}%` }} />
                </div>
                <span className="w-20 text-right text-foreground tabular-nums">
                  {w.open}{w.overdue > 0 && <span className="text-red-600 dark:text-red-400"> · {w.overdue} od</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Budget rollup */}
        <div className="bg-card border border-border shadow-sm rounded-xl p-4">
          <h3 className={heading}>Budget vs spend<InfoTooltip text="Internal cost tracking across projects where budget/spend is recorded. Not client billing." /></h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Allocated</span><span className="text-foreground">{money(m.totalBudget)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Actual spend</span><span className="text-foreground">{money(m.totalSpend)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Over budget</span><span className={m.overBudget > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'}>{m.overBudget} project{m.overBudget === 1 ? '' : 's'}</span></div>
            <p className="text-xs text-muted-foreground/60 mt-1">{m.withBudgetCount} projects have a budget set.</p>
          </div>
        </div>

        {/* Top clients */}
        <div className="bg-card border border-border shadow-sm rounded-xl p-4">
          <h3 className={heading}>Top clients by projects<InfoTooltip text="Firms with the most projects (all time, by firm)." /></h3>
          <div className="flex flex-col gap-1">
            {m.topClients.map(c => (
              <div key={c.name} className="flex justify-between text-sm py-0.5 border-b border-border/40 last:border-0">
                <span className="text-foreground truncate">{c.name}</span>
                <span className="text-muted-foreground tabular-nums">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground/60">
        More to come — per-stage cycle time and client margin are on the roadmap. Tell Claude what you want to see here.
      </p>
    </div>
  )
}

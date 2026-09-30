'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { fmtNum } from '@/lib/utils/number'
import { blockedText, CHILD_TABLES } from '@/lib/insights/load'
import { insightsHref, parseInsightsFilter, type InsightsFilter } from '@/lib/insights/filters'
import { buildInsightsModel } from '@/lib/insights/model'
import { todayET } from '@/lib/insights/range'
import { useInsightsData } from './useInsightsData'
import { FilterBar } from './FilterBar'
import { KpiTiles } from './KpiTiles'
import { DeliveredCharts } from './DeliveredCharts'
import { RightNow } from './RightNow'
import { SurveyDrill } from './SurveyDrill'
import type { DrillRequest } from './drill'

/**
 * /insights — the analyst dashboard (David, 2026-09-24: "interesting stats like
 * # of surveys delivered this month (with the ability to change the date
 * range, type, etc.) … hopefully it shows the hard work paying off").
 *
 * Counts, days and percentages only: no budget, spend, price or margin for
 * anyone, finance holders included — they have /finance. The data behind the
 * page does not even include those columns (lib/insights/load.ts, and the test
 * beside it).
 *
 * This component only wires things together: the URL holds the filter, the
 * model (lib/insights/model.ts, unit-tested) computes every figure, and the
 * sections render it.
 */
export function InsightsDashboard() {
  const router = useRouter()
  const params = useSearchParams()
  const { data, isLoading, error } = useInsightsData()
  const [drill, setDrill] = useState<DrillRequest | null>(null)
  const closeDrill = useCallback(() => setDrill(null), [])

  const filter = useMemo(() => parseInsightsFilter(params), [params])
  // "Today" in New York, fixed per page load so every figure uses one day.
  const today = useMemo(() => todayET(), [])

  const model = useMemo(() => {
    if (!data || data.blocked.some(b => b.table === 'survey_projects')) return null
    return buildInsightsModel({
      projects: data.projects, rowCounts: data.rowCounts, accounts: data.accounts, filter, today,
    })
  }, [data, filter, today])

  const onChange = useCallback((next: InsightsFilter) => {
    // replace, not push: a filter tweak is not a place in history worth a Back
    // press each.
    router.replace(insightsHref(next), { scroll: false })
  }, [router])

  if (isLoading) return <InsightsSkeleton />

  const projectsBlocked = data?.blocked.find(b => b.table === 'survey_projects')
  if (error || !data || projectsBlocked || !model) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Title />
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
          {projectsBlocked ? blockedText(projectsBlocked) : `Blocked: the studies did not load${error ? ` (${(error as Error).message})` : ''}`}.
          {' '}No figures are shown, because a failed read is not zero. Reload the page to try again.
        </div>
      </div>
    )
  }

  const clientsBlocked = data.blocked.find(b => b.table === 'clients')
  const childBlocked = data.blocked.filter(b => (CHILD_TABLES as readonly string[]).includes(b.table))

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Title />

      {clientsBlocked && (
        <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          {blockedText(clientsBlocked)}. Demo and test accounts could not be removed and account names are missing,
          so the figures below may include demo studies.
        </div>
      )}
      {childBlocked.map(b => (
        <div key={b.table} role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          {blockedText(b)}. Empty rerun placeholders could not be checked for field rows, so any study flagged as a
          placeholder with no respondents was left out on the flag alone.
        </div>
      ))}

      <p className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-base text-foreground" aria-live="polite">
        {model.headline}
      </p>

      <FilterBar model={model} onChange={onChange} />
      <KpiTiles model={model} open={setDrill} />
      <DeliveredCharts model={model} open={setDrill} />
      <RightNow model={model} open={setDrill} />

      <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        {leftOut(model.excluded.placeholders, data.demoDropped, model.excluded.internal)}
        <InfoTooltip text="An empty rerun placeholder is a wave the system created ahead of time that holds no blast, panel or cost row and no respondents yet — not work anyone did. Demo and test accounts are not business. Internal projects are not client studies." />
        <span className="ml-1">Counts only: this page shows no dollar figures.</span>
      </p>

      <SurveyDrill req={drill} model={model} accounts={data.accounts} onClose={closeDrill} />
    </div>
  )
}

/** "Left out everywhere: 20 empty rerun placeholders and 3 demo or test-account
 *  surveys." `demo` is null when the clients table did not load: then nobody
 *  knows which accounts are demo, and the line says so instead of "0". */
function leftOut(placeholders: number, demo: number | null, internal: number): string {
  const s = (n: number, one: string, many: string) => `${fmtNum(n)} ${n === 1 ? one : many}`
  const parts = [
    s(placeholders, 'empty rerun placeholder', 'empty rerun placeholders'),
    ...(demo != null ? [s(demo, 'demo or test-account study', 'demo or test-account studies')] : []),
    ...(internal > 0 ? [s(internal, 'internal project', 'internal projects')] : []),
  ]
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  const unchecked = demo == null ? ' Demo and test accounts could not be checked, because the clients table did not load.' : ''
  return `Left out everywhere: ${list}.${unchecked}`
}

function Title() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold text-foreground">Insights</h1>
      <span className="text-sm text-muted-foreground">What the team delivered, how fast, and what is open right now.</span>
    </div>
  )
}

export function InsightsSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4" aria-busy="true" aria-label="Loading insights">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

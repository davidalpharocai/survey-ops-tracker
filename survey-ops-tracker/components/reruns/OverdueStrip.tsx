'use client'
import Link from 'next/link'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { needsActionSeries } from '@/lib/reruns/monthEvents'
import type { SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'

// A pinned "needs action" strip for the first-class rerun model — always
// rendered on /reruns (never hidden), so overdue and needs-a-cadence series
// can never slip below the fold. Amber/red accent only when non-empty; a quiet
// positive line when clear.

function ActionPill({ s }: { s: SeriesListRow }) {
  const overdue = !!s.is_overdue
  const days = typeof s.days_to_next === 'number' ? Math.abs(s.days_to_next) : null
  const tag = overdue
    ? days && days > 1
      ? `⚠ Overdue ${days} days`
      : '⚠ Overdue'
    : 'needs a cadence'
  return (
    <Link
      href={`/reruns/series/${s.id}`}
      title={`${overdue ? 'Overdue' : 'No cadence set'} — open the ${s.survey_name} rerun series record`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:brightness-95 ${
        overdue
          ? 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300'
          : 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
      }`}
    >
      <span className="font-medium truncate max-w-[16rem]">
        {s.client} — {s.survey_name}
      </span>
      <span className="shrink-0 opacity-90">· {tag}</span>
    </Link>
  )
}

export function OverdueStrip({ series }: { series: SeriesListRow[] }) {
  const needing = needsActionSeries(series)
  const overdueCount = needing.filter((s) => s.is_overdue).length
  const cadenceCount = needing.length - overdueCount
  const active = needing.length > 0

  return (
    <section
      aria-label="Reruns needing action"
      className={`rounded-xl border p-3 ${
        active
          ? 'border-red-500/40 bg-red-500/5 dark:bg-red-500/10'
          : 'border-border bg-card'
      }`}
    >
      <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest font-medium text-muted-foreground">
        <span className={`inline-block w-2 h-2 rounded-full ${active ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden="true" />
        <span>Needs action</span>
        {active && (
          <span className="normal-case tracking-normal font-semibold tabular-nums text-red-600 dark:text-red-400">
            {needing.length}
          </span>
        )}
        <InfoTooltip text="First-class rerun series that need a human now: overdue (the next wave's collection date has passed and it isn't done) or in service with no cadence set yet (it can't schedule a next wave until one is defined). Always shown so nothing slips below the fold." />
      </h2>

      {active ? (
        <>
          <p className="text-[12px] text-muted-foreground mt-1">
            {overdueCount > 0 && `${overdueCount} overdue`}
            {overdueCount > 0 && cadenceCount > 0 && ' · '}
            {cadenceCount > 0 && `${cadenceCount} need a cadence`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {needing.map((s) => (
              <ActionPill key={s.id} s={s} />
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
          <span aria-hidden="true">✓</span> No reruns need action.
        </p>
      )}
    </section>
  )
}

'use client'
import Link from 'next/link'
import { RerunSeriesBoard } from '@/components/reruns/RerunSeriesBoard'
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { useRerunSeriesList, type SeriesListRow } from '@/lib/hooks/useRerunSeriesRecord'
import { Skeleton } from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/date'

// The "Series" tab of /reruns. Two layers, deliberately distinct:
//  1. First-class rerun_series records (migration 073) — the new source of
//     truth, each opening its own record at /reruns/series/[id].
//  2. The legacy wave-lineage board (rerun_series_id root-pointer grouping) —
//     kept working and labelled "legacy" per the rerun-update spec §18
//     ("Source-of-truth IA": new series is primary, legacy is read-only-ish
//     and clearly marked during the migration).

function cadenceLabel(m: number | null): string {
  if (m == null) return 'Ad-hoc'
  return ({ 1: 'Monthly', 3: 'Quarterly', 6: 'Every 6 mo', 12: 'Yearly' } as Record<number, string>)[m] ?? `Every ${m} mo`
}

function FirstClassSeriesRow({ s }: { s: SeriesListRow }) {
  return (
    <Link
      href={`/reruns/series/${s.id}`}
      title={`Open the ${s.survey_name} rerun series record`}
      className="flex items-center justify-between gap-3 flex-wrap bg-background border border-border rounded-lg px-3 py-2.5 hover:ring-1 hover:ring-primary/30 hover:bg-accent/40 transition"
    >
      <div className="min-w-0 flex items-center gap-2 flex-wrap">
        <BaseTypeTag baseType={s.base_type} rerunService={s.rerun_service} />
        <span className="font-medium text-foreground truncate">{s.client} — {s.survey_name}</span>
        <span className="text-xs text-muted-foreground">{s.wave_count} wave{s.wave_count === 1 ? '' : 's'}</span>
      </div>
      <div className="flex items-center gap-2 text-xs shrink-0">
        {!s.in_service ? (
          <span className="text-muted-foreground">Ended</span>
        ) : s.paused ? (
          <span className="text-amber-600 dark:text-amber-400">⏸ Paused</span>
        ) : s.is_overdue ? (
          <span className="text-red-600 dark:text-red-400">⚠ Overdue</span>
        ) : (
          <span className="text-muted-foreground">{cadenceLabel(s.cadence_months)}</span>
        )}
        <span className="text-muted-foreground">{s.effective_next ? `next ${formatDate(s.effective_next)}` : ''}</span>
        <span className="text-muted-foreground" aria-hidden="true">↗</span>
      </div>
    </Link>
  )
}

function RerunSeriesListPanel() {
  const { data: list = [], isLoading, error } = useRerunSeriesList()

  if (isLoading) {
    return (
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 text-sm text-destructive">
        Couldn&apos;t load rerun series: {(error as Error).message}
      </div>
    )
  }
  if (list.length === 0) {
    return (
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 text-sm text-muted-foreground">
        No rerun series yet. Use “Put into rerun service” from a project&apos;s ⋯ More menu to start one.
      </div>
    )
  }
  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-2">
      {list.map((s) => (
        <FirstClassSeriesRow key={s.id} s={s} />
      ))}
    </div>
  )
}

export default function RerunSeriesPage() {
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center gap-1 text-sm" role="tablist" aria-label="Reruns views">
        <Link
          href="/reruns"
          className="px-3 py-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Sree’s rerun tracker, bucketed by overdue / upcoming / done"
        >
          Radar
        </Link>
        <span className="px-3 py-1 rounded-lg bg-accent text-foreground font-medium">Series</span>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rerun Series</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every first-class rerun series — cadence, future-wave defaults, and lifecycle. Click one to open its record.
          </p>
        </div>
        <RerunSeriesListPanel />
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            Legacy wave lineage
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-normal">
              legacy (migrating)
            </span>
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Rerun families linked the old way (before a series record existed). Still editable here; new reruns should
            use “Put into rerun service” instead.
          </p>
        </div>
        <RerunSeriesBoard />
      </div>
    </div>
  )
}

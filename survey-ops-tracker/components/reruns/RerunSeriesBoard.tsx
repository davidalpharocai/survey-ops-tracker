'use client'
import { useAllRerunSeries } from '@/lib/hooks/useRerunLineage'
import { WaveSeriesView } from './WaveSeriesView'

// The zoomed-out "Series" view for /reruns: every multi-wave rerun series across
// all clients, each rendered with the shared WaveSeriesView (Table ⇄ Timeline,
// status colors, click-through). Reorganizing (link/merge) happens from a wave's
// project page today; drag-to-reorder lands next.

// Strip a trailing "— week 5" / "- wave 2" so the card shows the series name once.
const seriesTitle = (name: string) => name.replace(/\s*[-–—]\s*(week|wave)\s*\d+\s*$/i, '').trim() || name

export function RerunSeriesBoard() {
  const { data: series = [], isLoading } = useAllRerunSeries()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading series…</p>

  if (!series.length)
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        No multi-wave series yet. On any survey&apos;s page, use “↻ Link this as a rerun of another survey” to start one.
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {series.length} rerun series. Each shows its waves in order, colored by status — click a wave to open it, or reorganize from a wave&apos;s project page.
      </p>
      {series.map(s => (
        <div key={s.rootId} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-base font-medium text-foreground">{seriesTitle(s.name)}</h2>
            <span className="text-xs text-muted-foreground" title="Client · number of waves">
              {s.client.split(' - ')[0]} · {s.waves.length} waves
            </span>
          </div>
          <WaveSeriesView waves={s.waves} />
        </div>
      ))}
    </div>
  )
}

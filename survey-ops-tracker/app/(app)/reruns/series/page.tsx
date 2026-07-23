'use client'
import Link from 'next/link'
import { RerunSeriesBoard } from '@/components/reruns/RerunSeriesBoard'

// The "Series" tab of /reruns — the zoomed-out view of every rerun wave series.
// Sibling to the Rerun Radar (which mirrors Sree's cadence sheet); this one is
// the survey-project wave lineage.
export default function RerunSeriesPage() {
  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
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
      <div>
        <h1 className="text-2xl font-bold text-foreground">Rerun Series</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every longitudinal wave series, grouped — the zoomed-out view. Toggle Table / Timeline on any series.
        </p>
      </div>
      <RerunSeriesBoard />
    </div>
  )
}

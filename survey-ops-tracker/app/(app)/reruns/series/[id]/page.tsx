'use client'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { RerunSeriesRecord } from '@/components/reruns/RerunSeriesRecord'

// The first-class Rerun Series record page (migration 073) — reached from the
// /reruns/series list, from a wave's project page (WaveHistory), or from the
// "Put into rerun service" flow. See docs/superpowers/plans/2026-08-10-rerun-
// update.md Task 6.
export default function RerunSeriesRecordPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params.id === 'string' ? params.id : ''

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <Link
        href="/reruns/series"
        className="text-sm text-muted-foreground hover:text-foreground self-start"
        title="Back to every rerun series"
      >
        ← All rerun series
      </Link>
      {id ? <RerunSeriesRecord seriesId={id} /> : <p className="text-sm text-destructive">Missing series id.</p>}
    </div>
  )
}

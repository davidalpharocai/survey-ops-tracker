'use client'
import { useState, type DragEvent } from 'react'
import { useAllRerunSeries, useLinkRerun } from '@/lib/hooks/useRerunLineage'
import { WaveSeriesView, type SeriesWave } from './WaveSeriesView'
import { toast } from '@/lib/utils/toast'

// The zoomed-out "Series" view for /reruns: every multi-wave rerun series across
// all clients, each rendered with the shared WaveSeriesView. Drag a wave onto
// another series to MERGE it in (moves the wave + its subtree via the link route),
// or into the strip at the bottom to SPLIT it into its own series. Drag is
// mouse-only; the keyboard/precise path stays the ↻ Link controls on a wave's
// project page.

const seriesTitle = (name: string) => name.replace(/\s*[-–—]\s*(week|wave)\s*\d+\s*$/i, '').trim() || name
const firm = (c: string) => c.split(' - ')[0].trim().toLowerCase()

type DragData = { waveId: string; fromRoot: string; fromClient: string }

export function RerunSeriesBoard() {
  const { data: series = [], isLoading } = useAllRerunSeries()
  const link = useLinkRerun()
  const [dragRoot, setDragRoot] = useState<string | null>(null)
  const [overRoot, setOverRoot] = useState<string | null>(null)
  const [overDetach, setOverDetach] = useState(false)

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading series…</p>

  if (!series.length)
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-muted-foreground">
        No multi-wave series yet. On any survey&apos;s page, use “↻ Link this as a rerun of another survey” to start one.
      </div>
    )

  const read = (e: DragEvent): DragData | null => {
    try {
      return JSON.parse(e.dataTransfer.getData('text/plain'))
    } catch {
      return null
    }
  }

  const merge = (d: DragData, toRoot: string, toClient: string) => {
    if (firm(d.fromClient) !== firm(toClient)) {
      toast('Those are different clients — link it from the project page if that’s really intended.')
      return
    }
    link.mutate(
      { childId: d.waveId, parentId: toRoot },
      { onSuccess: () => toast('Merged into the series.', 'success'), onError: e => toast((e as Error).message) }
    )
  }
  const detach = (d: DragData) =>
    link.mutate(
      { childId: d.waveId, parentId: null },
      { onSuccess: () => toast('Split into its own series.', 'success'), onError: e => toast((e as Error).message) }
    )

  const dragPropsFor = (rootId: string, client: string) => (w: SeriesWave) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ waveId: w.id, fromRoot: rootId, fromClient: client }))
      e.dataTransfer.effectAllowed = 'move'
      setDragRoot(rootId)
    },
    onDragEnd: () => {
      setDragRoot(null)
      setOverRoot(null)
      setOverDetach(false)
    },
    style: { cursor: 'grab' as const },
  })

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {series.length} rerun series. Click a wave to open it; <span className="text-foreground">drag a wave onto another series to merge it in</span>, or into the strip below to split it out. On mobile / keyboard, use the ↻ Link controls on the wave&apos;s project page.
      </p>

      {series.map(s => {
        const isTarget = !!dragRoot && dragRoot !== s.rootId
        const isOver = isTarget && overRoot === s.rootId
        return (
          <div
            key={s.rootId}
            onDragOver={e => {
              if (isTarget) {
                e.preventDefault()
                setOverRoot(s.rootId)
              }
            }}
            onDragLeave={() => setOverRoot(r => (r === s.rootId ? null : r))}
            onDrop={e => {
              if (!isTarget) return
              e.preventDefault()
              setOverRoot(null)
              const d = read(e)
              if (d?.waveId) merge(d, s.rootId, s.client)
            }}
            className={`bg-card border rounded-xl p-4 flex flex-col gap-2.5 transition-colors ${
              isOver ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-border'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <h2 className="text-base font-medium text-foreground">{seriesTitle(s.name)}</h2>
              {isTarget ? (
                <span className="text-xs text-primary font-medium">↳ drop here to merge in</span>
              ) : (
                <span className="text-xs text-muted-foreground" title="Client · number of waves">
                  {s.client.split(' - ')[0]} · {s.waves.length} waves
                </span>
              )}
            </div>
            <WaveSeriesView waves={s.waves} rowDragProps={dragPropsFor(s.rootId, s.client)} />
          </div>
        )
      })}

      {/* Split-out drop zone — only lights up while dragging. */}
      <div
        onDragOver={e => {
          if (dragRoot) {
            e.preventDefault()
            setOverDetach(true)
          }
        }}
        onDragLeave={() => setOverDetach(false)}
        onDrop={e => {
          e.preventDefault()
          setOverDetach(false)
          const d = read(e)
          if (d?.waveId) detach(d)
        }}
        className={`rounded-xl border border-dashed p-4 text-center text-sm transition-colors ${
          overDetach
            ? 'border-primary text-primary bg-primary/5'
            : dragRoot
              ? 'border-border text-muted-foreground'
              : 'border-border/50 text-muted-foreground/50'
        }`}
      >
        Drop a wave here to split it into its own series
      </div>
    </div>
  )
}

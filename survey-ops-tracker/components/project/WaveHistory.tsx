'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRerunSeries, useRerunCandidates, useLinkRerun } from '@/lib/hooks/useRerunLineage'
import { formatDate } from '@/lib/utils/date'
import { fmtNum } from '@/lib/utils/number'
import { toast } from '@/lib/utils/toast'

type P = {
  id: string
  client: string
  project_name: string
  rerun_series_id: string | null
  rerun_number: number | null
}

// The rerun-series history for a project: every wave in the series (original +
// reruns), in order, with a way to link an ad-hoc rerun to its original or
// detach one. Sits on the project detail page.
export function WaveHistory({ project }: { project: P }) {
  const { data: waves = [], isLoading } = useRerunSeries(project.id, project.rerun_series_id)
  const [picking, setPicking] = useState(false)
  const link = useLinkRerun()
  const inSeries = waves.length > 1
  const isChild = !!project.rerun_series_id // has a root => it's a later wave, not the original

  function linkTo(parentId: string, label: string) {
    link.mutate(
      { childId: project.id, parentId },
      {
        onSuccess: () => {
          toast(`Linked as a rerun of ${label}.`, 'success')
          setPicking(false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function unlink() {
    link.mutate(
      { childId: project.id, parentId: null },
      {
        onSuccess: () => toast('Unlinked from the series.', 'success'),
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  if (isLoading) return <p className="text-xs text-muted-foreground/50">Loading…</p>

  if (!inSeries) {
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <p className="text-xs text-muted-foreground/70">Not linked to a rerun series.</p>
        {picking ? (
          <ParentPicker project={project} onPick={linkTo} onCancel={() => setPicking(false)} busy={link.isPending} />
        ) : (
          <button onClick={() => setPicking(true)} className="text-[13px] text-primary hover:underline self-start">
            ↻ Link this as a rerun of another survey
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ol className="flex flex-col gap-1">
        {waves.map((w) => {
          const isCurrent = w.id === project.id
          const nVal = w.n_actual ?? w.n_collected ?? w.n_target ?? null
          const date = formatDate(w.deliver_date ?? w.due_date ?? null)
          const body = (
            <span className="flex items-center justify-between gap-2 w-full">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  {w.rerun_number && w.rerun_number > 1 ? `Wave ${w.rerun_number}` : 'Original'}
                </span>
                <span
                  className={`truncate ${isCurrent ? 'text-foreground font-medium' : 'text-blue-600 dark:text-blue-400'}`}
                >
                  {w.project_code ? `${w.project_code} · ` : ''}
                  {w.project_name}
                </span>
              </span>
              <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
                {date}
                {nVal != null && ` · N ${fmtNum(nVal)}`}
              </span>
            </span>
          )
          return (
            <li key={w.id} className={`rounded px-1.5 py-1 ${isCurrent ? 'bg-accent/60' : 'hover:bg-accent/40'}`}>
              {isCurrent ? body : <Link href={`/projects/${w.id}`} className="block">{body}</Link>}
            </li>
          )
        })}
      </ol>
      {isChild && (
        <button
          onClick={unlink}
          disabled={link.isPending}
          className="text-[11px] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 self-start disabled:opacity-40"
        >
          Unlink this wave from the series
        </button>
      )}
    </div>
  )
}

function ParentPicker({
  project,
  onPick,
  onCancel,
  busy,
}: {
  project: P
  onPick: (parentId: string, label: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const { data: candidates = [], isLoading } = useRerunCandidates(project, true)
  const firm = project.client.split(' - ')[0].trim()

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground">Pick the original survey this is a rerun of:</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground/60">No other {firm} surveys found to link to.</p>
      ) : (
        <div className="max-h-[12rem] overflow-y-auto flex flex-col thin-scroll">
          {candidates.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              onClick={() => onPick(c.id, c.project_code ?? c.project_name)}
              className="text-left rounded px-1.5 py-1 hover:bg-accent transition-colors disabled:opacity-40"
            >
              <span className="block text-sm text-foreground truncate">
                {c.project_code ? `${c.project_code} · ` : ''}
                {c.project_name}
              </span>
              <span className="block text-[11px] text-muted-foreground truncate">{c.client}</span>
            </button>
          ))}
        </div>
      )}
      <button onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground self-start">
        Cancel
      </button>
    </div>
  )
}

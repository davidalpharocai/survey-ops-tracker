'use client'
import { useState } from 'react'
import { useReviewQueue, useProjectOptions, useResolveDeliverable, useDismissDeliverable, type QueueRow } from '@/lib/hooks/useReviewQueue'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`

function QueueCard({ row }: { row: QueueRow }) {
  const options = useProjectOptions()
  const resolve = useResolveDeliverable()
  const dismiss = useDismissDeliverable()
  const [manual, setManual] = useState('')
  const busy = resolve.isPending || dismiss.isPending

  function file(projectId: string) {
    resolve.mutate({ id: row.id, projectId })
  }

  const href = row.source_url ?? (row.drive_file_id ? driveUrl(row.drive_file_id) : '#')
  const candidates = (row.match_candidates ?? []).filter((c) => c.projectId)

  return (
    <li className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm">
        <span>{row.kind === 'link' ? '🔗' : '📄'}</span>
        <a className="font-medium truncate hover:underline" href={href} target="_blank" rel="noreferrer">
          {row.file_name ?? row.original_file_name ?? 'Untitled'}
        </a>
        {row.status === 'unsorted' && <Badge variant="outline">unsorted</Badge>}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        <span>{row.email_subject ?? '(no subject)'}</span>
        <span> · from </span>
        <span>{row.email_from ?? 'unknown'}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <button
              key={i}
              disabled={busy}
              onClick={() => file(c.projectId!)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              {c.label} <span className="text-muted-foreground">({c.band})</span>
            </button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No confident guess — pick a project:</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-lg border border-border bg-background flex-1 min-w-48"
        >
          <option value="">Search / pick another project…</option>
          {(options.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button
          disabled={busy || !manual}
          onClick={() => file(manual)}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
        >
          File here
        </button>
        <button
          disabled={busy}
          onClick={() => dismiss.mutate({ id: row.id })}
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 text-muted-foreground"
        >
          Not a deliverable
        </button>
      </div>
    </li>
  )
}

export function ReviewQueue() {
  const { data, isLoading } = useReviewQueue()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground flex items-center">
        Nothing to review 🎉
        <InfoTooltip text="Emailed deliverables we couldn't auto-file to a single client + project land here. Auto-filed ones go straight to the client's Shared Drive folder." />
      </p>
    )
  }

  return (
    <ul className="space-y-3">
      {data.map((row) => <QueueCard key={row.id} row={row} />)}
    </ul>
  )
}

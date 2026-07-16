'use client'
import { useReviewQueue, useProjectOptions, useResolveDeliverable, useDismissDeliverable, type QueueRow } from '@/lib/hooks/useReviewQueue'
import { ProjectPicker } from '@/components/shared/ProjectPicker'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'
import { daysAgoLabel, daysSince } from '@/lib/utils/date'

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`
const gmailUrl = (msgId: string) =>
  `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(msgId)}`

function QueueCard({ row }: { row: QueueRow }) {
  const options = useProjectOptions()
  const resolve = useResolveDeliverable()
  const dismiss = useDismissDeliverable()
  const busy = resolve.isPending || dismiss.isPending

  function file(projectId: string) {
    resolve.mutate({ id: row.id, projectId }, {
      onSuccess: () => toast('Filed ✓', 'success'),
      onError: (e) => toast(String((e as Error).message)),
    })
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
        <span> · from {row.email_from ?? 'unknown'}</span>
        <span> · {daysAgoLabel(row.created_at)}</span>
        {row.gmail_message_id && (
          <>
            {' · '}
            <a href={gmailUrl(row.gmail_message_id)} target="_blank" rel="noreferrer" className="hover:underline">
              open in Gmail ↗
            </a>
          </>
        )}
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
        <ProjectPicker options={options.data ?? []} disabled={busy} onPick={file} placeholder="Search projects by any word…" />
        <button
          disabled={busy}
          onClick={() => dismiss.mutate({ id: row.id }, { onSuccess: () => toast('Dismissed', 'success'), onError: (e) => toast(String((e as Error).message)) })}
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

  const oldest = Math.max(0, ...data.map((r) => daysSince(r.created_at)))
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        <span className="text-foreground font-medium">{data.length}</span> to review
        {oldest > 0 ? ` · oldest ${oldest}d` : ''}
      </p>
      <ul className="space-y-3">
        {data.map((row) => <QueueCard key={row.id} row={row} />)}
      </ul>
    </div>
  )
}

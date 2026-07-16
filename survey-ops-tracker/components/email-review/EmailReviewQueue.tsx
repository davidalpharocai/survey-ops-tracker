'use client'
import { useState } from 'react'
import {
  useEmailReviewQueue,
  useFileEmail,
  useIgnoreEmail,
  type EmailQueueRow,
} from '@/lib/hooks/useEmailReview'
import { useProjectOptions } from '@/lib/hooks/useReviewQueue'
import { ProjectPicker } from '@/components/shared/ProjectPicker'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'
import { formatDate, daysSince } from '@/lib/utils/date'

// Gmail deep-link from the RFC-822 Message-ID stored in external_id ('email:<id>').
function gmailUrl(externalId: string): string | null {
  const id = externalId.startsWith('email:') ? externalId.slice('email:'.length) : null
  return id ? `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(id)}` : null
}

function EmailCard({ row }: { row: EmailQueueRow }) {
  const options = useProjectOptions()
  const file = useFileEmail()
  const ignore = useIgnoreEmail()
  const [expanded, setExpanded] = useState(false)
  const busy = file.isPending || ignore.isPending

  function doFile(projectId: string) {
    file.mutate(
      { id: row.id, projectId },
      { onSuccess: () => toast('Filed ✓', 'success'), onError: (e) => toast(String((e as Error).message)) }
    )
  }

  const labelFor = (projectId: string) =>
    (options.data ?? []).find((o) => o.id === projectId)?.label ?? projectId
  const candidates = (row.match_candidates ?? []).filter((c) => c.projectId)
  const gmail = gmailUrl(row.external_id)

  return (
    <li className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm">
        <span>✉️</span>
        <span className="font-medium truncate">{row.subject || '(no subject)'}</span>
        {row.status === 'pending_no_project' && <Badge variant="outline">no project yet</Badge>}
        {row.direction === 'outbound' && <Badge variant="outline">outbound</Badge>}
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        <span>from {row.from_email ?? 'unknown'}</span>
        <span> · {formatDate(row.occurred_at)}</span>
        {gmail && (
          <>
            {' · '}
            <a href={gmail} target="_blank" rel="noreferrer" className="hover:underline">
              open in Gmail ↗
            </a>
          </>
        )}
      </div>

      {(row.snippet || row.body) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-left text-muted-foreground hover:text-foreground w-full whitespace-pre-wrap"
        >
          {expanded ? row.body ?? row.snippet : row.snippet ?? ''}
          <span className="ml-1 text-foreground/60">{expanded ? ' · less' : ' · more'}</span>
        </button>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <button
              key={i}
              disabled={busy}
              onClick={() => doFile(c.projectId as string)}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40"
            >
              {labelFor(c.projectId as string)}
            </button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No confident guess — pick a project:</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ProjectPicker options={options.data ?? []} disabled={busy} onPick={doFile} />
        <button
          disabled={busy}
          onClick={() =>
            ignore.mutate(
              { id: row.id },
              { onSuccess: () => toast('Ignored', 'success'), onError: (e) => toast(String((e as Error).message)) }
            )
          }
          className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-40 text-muted-foreground"
        >
          Ignore
        </button>
      </div>
    </li>
  )
}

export function EmailReviewQueue() {
  const { data, isLoading, error } = useEmailReviewQueue()

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (error) {
    // Surface the failure rather than masking it as an empty queue — a masked
    // permission error is exactly what could hide the queue silently going dark.
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load the review queue: {String((error as Error).message)}
      </p>
    )
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground flex items-center">
        Nothing to review 🎉
        <InfoTooltip text="Client emails we couldn't confidently tie to one project land here. Confident matches (a project code, survey ID, or a known contact naming the project) log straight to the project's activity timeline." />
      </p>
    )
  }

  const oldest = Math.max(0, ...data.map((r) => daysSince(r.occurred_at)))
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">
        <span className="text-foreground font-medium">{data.length}</span> to review
        {oldest > 0 ? ` · oldest ${oldest}d` : ''}
      </p>
      <ul className="space-y-3">
        {data.map((row) => (
          <EmailCard key={row.id} row={row} />
        ))}
      </ul>
    </div>
  )
}

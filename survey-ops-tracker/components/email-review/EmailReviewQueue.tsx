'use client'
import { useMemo, useState } from 'react'
import {
  useEmailReviewQueue,
  useFileEmail,
  useIgnoreEmail,
  type EmailQueueRow,
} from '@/lib/hooks/useEmailReview'
import { useProjectOptions } from '@/lib/hooks/useReviewQueue'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/utils/toast'
import { formatDate } from '@/lib/utils/date'

// Gmail deep-link from the RFC-822 Message-ID stored in external_id ('email:<id>').
function gmailUrl(externalId: string): string | null {
  const id = externalId.startsWith('email:') ? externalId.slice('email:'.length) : null
  return id ? `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(id)}` : null
}

// Keyword project picker: type ANY word(s) from the client/project/code — matches
// substrings anywhere in the label (not just the first word like a native select),
// results sorted alphabetically. Picking a project files the email to it.
function ProjectPicker({
  options,
  disabled,
  onPick,
}: {
  options: { id: string; label: string }[]
  disabled?: boolean
  onPick: (projectId: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const sorted = useMemo(() => [...options].sort((a, b) => a.label.localeCompare(b.label)), [options])
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = terms.length ? sorted.filter((o) => { const l = o.label.toLowerCase(); return terms.every((t) => l.includes(t)) }) : sorted
  const shown = matches.slice(0, 50)

  return (
    <div className="relative flex-1 min-w-48">
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search projects by any word…"
        disabled={disabled}
        className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-background disabled:opacity-40"
      />
      {open && q.trim() && (
        <ul className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-popover border border-border rounded-lg shadow-xl">
          {shown.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">No matching project</li>
          ) : (
            shown.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(o.id); setQ(''); setOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-40"
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
          {matches.length > shown.length && (
            <li className="px-3 py-1.5 text-[11px] text-muted-foreground/70">
              +{matches.length - shown.length} more — keep typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  )
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

  return (
    <ul className="space-y-3">
      {data.map((row) => (
        <EmailCard key={row.id} row={row} />
      ))}
    </ul>
  )
}

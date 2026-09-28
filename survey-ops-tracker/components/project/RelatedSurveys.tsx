'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSurveySearch } from '@/lib/hooks/useRerunLineage'
import { useProjectLinks, useLinkSurvey, useUnlinkSurvey } from '@/lib/hooks/useProjectLinks'
import { toast } from '@/lib/utils/toast'

/**
 * Related surveys — surveys that belong together WITHOUT one being a wave of the
 * other (migration 126).
 *
 * The distinction from Rerun history, one card up, is the whole point. A rerun
 * wave carries a wave number, a position in a series and a place in the spawn
 * cron's arithmetic; a soft launch and its full launch, or the B2B and consumer
 * halves of one study, carry none of that. Recording those as waves puts a wave
 * number on something that is not a wave and can hand it a next wave nobody
 * asked for.
 *
 * The link is symmetric: making it here makes it on the other survey too.
 */
type P = { id: string; project_name: string }

const inputCls =
  'rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/40'

export function RelatedSurveys({ project }: { project: P }) {
  const { data: links = [], isLoading } = useProjectLinks(project.id)
  const linkTo = useLinkSurvey(project.id)
  const unlink = useUnlinkSurvey(project.id)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [note, setNote] = useState('')

  const { data: hits = [], isLoading: searching } = useSurveySearch(q)
  // Already-linked surveys and this one are dropped here rather than inside the
  // query, whose cache key is the search text alone — see useSurveySearch.
  const exclude = new Set([project.id, ...links.map((l) => l.id)])
  const found = hits.filter((r) => !exclude.has(r.id))
  const typed = q.trim().length >= 2

  function add(otherId: string, label: string) {
    linkTo.mutate(
      { otherId, note: note.trim() || null },
      {
        onSuccess: (res: { created?: boolean }) => {
          toast(res?.created === false ? `Already linked to ${label} — note updated.` : `Linked to ${label}.`, 'success')
          setPicking(false)
          setQ('')
          setNote('')
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : links.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/70">
          Nothing linked yet. Use this for surveys that belong together without one being a repeat wave of the other — a
          soft launch and its full launch, two halves of one study, a replacement for a cancelled survey.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.link_id} className="group flex items-start justify-between gap-2">
              <Link href={`/projects/${l.id}`} className="min-w-0 flex-1 rounded px-1 py-0.5 -mx-1 hover:bg-accent transition-colors">
                <span className="block text-sm text-foreground truncate">
                  {l.project_code ? `${l.project_code} · ` : ''}
                  {l.project_name}
                </span>
                <span className="block text-[12px] text-muted-foreground truncate">
                  {l.client}
                  {l.note ? ` · ${l.note}` : ''}
                </span>
              </Link>
              <button
                onClick={() => {
                  unlink.mutate(
                    { linkId: l.link_id, otherId: l.id },
                    {
                      onSuccess: () => toast(`Unlinked ${l.project_code ?? l.project_name}.`, 'success'),
                      onError: (e) => toast((e as Error).message),
                    }
                  )
                }}
                disabled={unlink.isPending}
                title={`Remove the link to ${l.project_code ?? l.project_name}`}
                aria-label={`Remove the link to ${l.project_code ?? l.project_name}`}
                className="shrink-0 text-[12px] text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {!picking ? (
        <button onClick={() => setPicking(true)} className="text-[13px] text-primary hover:underline self-start">
          ＋ Link another survey
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-2 flex flex-col gap-1.5">
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by keyword or PR number…"
            aria-label="Search surveys to link"
            className={`w-full ${inputCls}`}
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How are they related? (optional)"
            aria-label="How are they related"
            className={`w-full ${inputCls}`}
          />
          {!typed ? (
            <p className="text-[12px] text-muted-foreground/70">Type at least two characters.</p>
          ) : searching ? (
            <p className="text-xs text-muted-foreground/50">Searching…</p>
          ) : found.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">Nothing matches “{q.trim()}”.</p>
          ) : (
            <div className="max-h-[12rem] overflow-y-auto flex flex-col thin-scroll">
              {found.map((c) => (
                <button
                  key={c.id}
                  disabled={linkTo.isPending}
                  onClick={() => add(c.id, c.project_code ?? c.project_name)}
                  className="text-left rounded px-1.5 py-1 hover:bg-accent transition-colors disabled:opacity-40"
                >
                  <span className="block text-sm text-foreground truncate">
                    {c.project_code ? `${c.project_code} · ` : ''}
                    {c.project_name}
                  </span>
                  <span className="block text-[12px] text-muted-foreground truncate">{c.client}</span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => {
              setPicking(false)
              setQ('')
              setNote('')
            }}
            className="text-[12px] text-muted-foreground hover:text-foreground self-start"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

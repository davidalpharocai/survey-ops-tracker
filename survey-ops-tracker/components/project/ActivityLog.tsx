'use client'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

type Activity = Database['public']['Tables']['project_activity']['Row']

const TYPE_ICON: Record<string, string> = {
  email: '✉',
  slack: '💬',
  note: '📝',
  system: '⚙',
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Gmail deep-link from the RFC-822 Message-ID stored in external_id ('email:<id>').
function gmailUrl(externalId: string | null): string | null {
  if (!externalId || !externalId.startsWith('email:')) return null
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(externalId.slice('email:'.length))}`
}

export function ActivityLog({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState('')
  // Debounce the search term. An empty term shows the recent view; a term runs a
  // DB search (trigram-indexed) over the FULL history, not just the loaded page.
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])
  const searching = debounced.length > 0

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ['activity', projectId, debounced.toLowerCase()],
    queryFn: async () => {
      let query = supabase
        .from('project_activity')
        .select('*')
        .eq('project_id', projectId)
        .is('deleted_at', null)
      const s = debounced.replace(/[%_,()\\]/g, ' ').trim()
      if (s) {
        query = query.or(`subject.ilike.%${s}%,body.ilike.%${s}%,snippet.ilike.%${s}%,sender.ilike.%${s}%`)
      }
      const { data, error } = await query
        .order('occurred_at', { ascending: false })
        .limit(s ? 50 : 100)
      if (error) throw error
      return data as Activity[]
    },
  })

  const visible = showAll || searching ? activity : activity.slice(0, 5)

  async function remove(id: string) {
    if (!window.confirm('Remove this entry from the activity log?')) return
    setRemoving(id)
    try {
      const res = await fetch('/api/activity/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('remove failed')
      if (expanded === id) setExpanded(null)
      qc.invalidateQueries({ queryKey: ['activity', projectId] })
    } catch {
      toast("Couldn't remove that entry — please try again.")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Activity
        <InfoTooltip text="Logged emails and events for this project — click an entry to expand it. Use the search box to find a specific email." />
      </h3>

      {activity.length > 0 && (
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search activity (subject, body, people)…"
          className="w-full text-xs px-2 py-1.5 mb-2 rounded-lg border border-border bg-background"
        />
      )}

      {isLoading && <p className="text-xs text-muted-foreground/50">Loading…</p>}

      {!isLoading && searching && activity.length === 0 && (
        <p className="text-xs text-muted-foreground/50">No activity matches “{debounced}”.</p>
      )}

      {!isLoading && activity.length === 0 && (
        <p className="text-xs text-muted-foreground/50">
          No activity logged yet. Emails will appear here once the email
          integration is connected.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {visible.map(a => {
          const isOpen = expanded === a.id
          return (
            <div key={a.id} className="rounded-lg bg-muted/60 overflow-hidden">
              <div className="flex items-start">
                <button
                  onClick={() => setExpanded(isOpen ? null : a.id)}
                  className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-accent/60 transition-colors"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span>{TYPE_ICON[a.type] ?? '•'}</span>
                    <span className="text-muted-foreground shrink-0">
                      {formatWhen(a.occurred_at)}
                    </span>
                    {a.direction && (
                      <span className="text-muted-foreground/70 shrink-0">
                        {a.direction === 'inbound' ? '←' : '→'}
                      </span>
                    )}
                    <span className="text-foreground font-medium truncate">
                      {a.subject ?? a.snippet ?? '(no subject)'}
                    </span>
                  </div>
                  {!isOpen && a.snippet && a.subject && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5 pl-6">
                      {a.snippet}
                    </p>
                  )}
                </button>
                <button
                  onClick={() => remove(a.id)}
                  disabled={removing === a.id}
                  title="Remove from activity"
                  aria-label="Remove from activity"
                  className="shrink-0 px-2.5 py-2 text-muted-foreground/40 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                >
                  ✕
                </button>
              </div>
              {isOpen && (
                <div className="px-3 pb-3 pl-9 flex flex-col gap-1 min-w-0">
                  {(a.sender || a.recipients) && (
                    <p className="text-xs text-muted-foreground">
                      {a.sender && <>From: {a.sender}</>}
                      {a.sender && a.recipients && ' · '}
                      {a.recipients && <>To: {a.recipients}</>}
                    </p>
                  )}
                  {gmailUrl(a.external_id) && (
                    <a
                      href={gmailUrl(a.external_id) as string}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground w-fit"
                    >
                      open in Gmail ↗
                    </a>
                  )}
                  <pre className="text-sm text-foreground/90 whitespace-pre-wrap break-words font-sans leading-relaxed max-h-80 overflow-y-auto">
                    {a.body ?? a.snippet ?? ''}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!searching && activity.length > 5 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
        >
          {showAll ? 'Show fewer' : `Show all ${activity.length}`}
        </button>
      )}
    </div>
  )
}

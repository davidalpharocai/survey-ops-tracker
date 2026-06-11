'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
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

export function ActivityLog({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const { data: activity = [], isLoading } = useQuery({
    queryKey: ['activity', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_activity')
        .select('*')
        .eq('project_id', projectId)
        .order('occurred_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Activity[]
    },
  })

  const visible = showAll ? activity : activity.slice(0, 5)

  return (
    <div className="bg-card rounded-xl p-4">
      <h3 className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium">
        Activity
      </h3>

      {isLoading && <p className="text-xs text-muted-foreground/50">Loading…</p>}

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
              <button
                onClick={() => setExpanded(isOpen ? null : a.id)}
                className="w-full text-left px-3 py-2 hover:bg-accent/60 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs">
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
              {isOpen && (
                <div className="px-3 pb-3 pl-9 flex flex-col gap-1">
                  {(a.sender || a.recipients) && (
                    <p className="text-xs text-muted-foreground">
                      {a.sender && <>From: {a.sender}</>}
                      {a.sender && a.recipients && ' · '}
                      {a.recipients && <>To: {a.recipients}</>}
                    </p>
                  )}
                  <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-sans leading-relaxed max-h-80 overflow-y-auto">
                    {a.body ?? a.snippet ?? ''}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {activity.length > 5 && (
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

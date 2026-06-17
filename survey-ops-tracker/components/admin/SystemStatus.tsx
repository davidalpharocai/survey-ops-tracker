'use client'
import { useSystemEvents, type SystemEvent } from '@/lib/hooks/useObservability'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

// The backend jobs we expect to run, with friendly names. Last run + status for
// each is derived from the system_events log.
const KNOWN_JOBS: { source: string; label: string }[] = [
  { source: 'daily-digest', label: 'Daily Slack digest' },
  { source: 'sync-survey-ids', label: 'Survey ID sync' },
]

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-500',
  partial: 'bg-amber-500',
  error: 'bg-red-500',
}

export function SystemStatus() {
  const { data: events = [], isLoading, isError } = useSystemEvents(40)
  const heading = 'text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center'

  const latestBySource = new Map<string, SystemEvent>()
  for (const e of events) if (!latestBySource.has(e.source)) latestBySource.set(e.source, e)
  const problems = events.filter(e => e.status !== 'ok').slice(0, 20)

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4">
      <h3 className={heading}>
        System status
        <InfoTooltip text="Health of the automated backend jobs (the nightly Slack digest and the survey-ID sync). Green = last run was clean, amber = ran with some row failures, red = failed. Backend problems also appear in the daily Slack digest." />
      </h3>

      {isError ? (
        <p className="text-xs text-muted-foreground/70">System status needs the latest database migration (036).</p>
      ) : isLoading ? (
        <p className="text-xs text-muted-foreground/50">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {KNOWN_JOBS.map(job => {
              const last = latestBySource.get(job.source)
              return (
                <div key={job.source} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${last ? STATUS_DOT[last.status] ?? 'bg-muted-foreground/40' : 'bg-muted-foreground/30'}`} />
                    <span className="text-foreground truncate">{job.label}</span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {last ? `${last.status} · ${ago(last.created_at)}` : 'no runs yet'}
                  </span>
                </div>
              )
            })}
          </div>

          {problems.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground/70 mb-1">Recent issues</p>
              <div className="flex flex-col max-h-40 overflow-y-auto thin-scroll pr-1">
                {problems.map(e => (
                  <div key={e.id} className="py-1.5 border-b border-border/40 last:border-0">
                    <span className="text-xs text-foreground">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${STATUS_DOT[e.status] ?? 'bg-muted-foreground/40'}`} />
                      <span className="font-mono">{e.source}</span> · {ago(e.created_at)}
                    </span>
                    {e.detail && <span className="block text-xs text-muted-foreground/80 ml-3">{e.detail}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {problems.length === 0 && (
            <p className="text-xs text-muted-foreground/60">No backend issues logged. ✅</p>
          )}
        </div>
      )}
    </div>
  )
}

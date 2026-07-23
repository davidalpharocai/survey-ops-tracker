'use client'
import { useState } from 'react'
import { useProjectSummary } from '@/lib/hooks/useProjectSummary'
import { daysAgoLabel } from '@/lib/utils/date'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

// ✦ Summary strip — sits at the top of the project Overview. Every figure
// shown here comes straight off the /api/project-summary response: the
// endpoint computes all numbers in code (lib/server/projectSummary.ts) and
// only lets Haiku phrase the prose around them, so this component never
// recomputes or reformats a number itself — it just renders what it's given.

/** "just now" / "3m ago" / "2h ago", falling back to the app's day-granularity
 *  `daysAgoLabel` once we're a day+ out. A summary is normally read minutes
 *  after a regenerate, where day-level granularity alone would read as just
 *  "today" all day and hide that a fresh ↻ actually did something. */
function relativeAsOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return daysAgoLabel(iso)
}

function SummaryField({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'amber'
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium mb-0.5">
        {label}
      </p>
      <p
        className={
          tone === 'amber'
            ? 'text-sm text-amber-700 dark:text-amber-400'
            : 'text-sm text-foreground'
        }
      >
        {value}
      </p>
    </div>
  )
}

export function ProjectSummaryStrip({ projectId }: { projectId: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const { data, isLoading, isFetching, isError, refetch } = useProjectSummary(projectId)

  const watchouts = data?.watchouts ?? []
  const n = watchouts.length

  return (
    <div className="bg-card border border-border border-l-2 border-l-blue-500/50 rounded-xl shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 dark:text-blue-400">
            <span aria-hidden>✦</span> Summary
          </span>
          <span className="text-[10px] uppercase tracking-wide font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-full px-1.5 py-0.5">
            AI · Beta
          </span>
          <InfoTooltip text="Auto-generated from this project's live data. Every number is computed exactly, server-side — the AI only writes the sentences around them. Verify specifics before relying on them." />
        </div>
        <div className="flex items-center gap-3">
          {data?.generated_at && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              as of {relativeAsOf(data.generated_at)}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            title="Regenerate summary"
            aria-label="Regenerate summary"
          >
            <span className={isFetching ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
          </button>
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title={collapsed ? 'Expand summary' : 'Collapse summary'}
            aria-label={collapsed ? 'Expand summary' : 'Collapse summary'}
            aria-expanded={!collapsed}
          >
            <span
              className={`inline-block transition-transform ${collapsed ? '' : 'rotate-180'}`}
            >
              ⌄
            </span>
          </button>
        </div>
      </div>

      <div className="px-4 pb-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block animate-spin">↻</span> Generating summary…
          </div>
        ) : isError || !data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Couldn&apos;t generate summary — retry</span>
            <button
              onClick={() => refetch()}
              className="text-blue-600 dark:text-blue-400 hover:underline"
              title="Retry"
            >
              ↻ Retry
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground">
              {data.narrative.oneLine}
              {n > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  · ⚠ {n} watch-out{n === 1 ? '' : 's'}
                </span>
              )}
            </p>

            {!collapsed && (
              <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <SummaryField label="Status" value={data.narrative.status || '—'} />
                  <SummaryField label="Progress" value={data.narrative.progress || '—'} />
                  <SummaryField label="Money" value={data.narrative.money || '—'} />
                </div>
                <SummaryField
                  label="Watch-outs"
                  value={n > 0 ? watchouts.join(' · ') : 'None flagged.'}
                  tone={n > 0 ? 'amber' : undefined}
                />
                <SummaryField label="Next" value={data.narrative.next || '—'} />
                <p className="text-xs text-muted-foreground/80 italic">
                  ✦ AI-generated from live project data · figures computed exactly; verify specifics.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils/date'
import { waveStatus, WAVE_STATUS_LEGEND, type WaveLike } from '@/lib/reruns/waveStatus'

// Shared "zoomed-out" view of a rerun series — the waves in order, colored by
// status, with a Table ⇄ Timeline toggle. Each wave links to its project record.
// Used on the project page (Wave History) and the /reruns Series view.
// Design rules in force: meaning-encoding color + a tooltip on every element.
//
// Long-series handling (hybrid, David-approved): a series over COLLAPSE_THRESHOLD
// waves collapses to the most recent RECENT_COUNT (plus the current wave) with a
// "show all" toggle; expanded, the table caps height and scrolls so even a 50-wave
// tracker never blows up the page. Timeline always scrolls horizontally.

export type SeriesWave = WaveLike & {
  id: string
  project_code: string | null
  project_name: string
  rerun_number: number | null
  n_target?: number | null
  n_collected?: number | null
}

const COLLAPSE_THRESHOLD = 6
const RECENT_COUNT = 4
const GRID = '84px minmax(0,1fr) 84px 74px 18px'

const todayStr = () => new Date().toISOString().slice(0, 10)

function waveLabel(n: number | null): string {
  return n && n > 1 ? `Wave ${n}` : 'Wave 1'
}

function dateFor(w: SeriesWave, key: string): string {
  if (key === 'delivered') return formatDate(w.deliver_date ?? w.delivered_at ?? null)
  if (key === 'upcoming') return w.launch_date ? `~${formatDate(w.launch_date)}` : '—'
  return '—'
}

export function WaveSeriesView({
  waves,
  currentId,
  compact = false,
}: {
  waves: SeriesWave[]
  /** The project whose page this is — highlighted, not linked. */
  currentId?: string
  /** Tighter spacing for the project-page rail. */
  compact?: boolean
}) {
  const router = useRouter()
  const [view, setView] = useState<'table' | 'timeline'>('table')
  const [expanded, setExpanded] = useState(false)
  const t = todayStr()
  const ordered = [...waves].sort((a, b) => (a.rerun_number ?? 0) - (b.rerun_number ?? 0))

  const collapsible = ordered.length > COLLAPSE_THRESHOLD
  const showingAll = expanded || !collapsible
  let display = ordered
  if (!showingAll) {
    display = ordered.slice(-RECENT_COUNT)
    if (currentId && !display.some(w => w.id === currentId)) {
      const cur = ordered.find(w => w.id === currentId)
      if (cur) display = [cur, ...display]
    }
  }

  const open = (w: SeriesWave) => {
    if (w.id !== currentId) router.push(`/projects/${w.id}`)
  }

  const seg = (v: 'table' | 'timeline', icon: string, label: string, title: string) => (
    <button
      onClick={() => setView(v)}
      title={title}
      aria-pressed={view === v}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 transition-colors ${
        view === v ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  )

  const rowFor = (w: SeriesWave) => {
    const s = waveStatus(w, t)
    const isCurrent = w.id === currentId
    return (
      <div
        key={w.id}
        role={isCurrent ? undefined : 'button'}
        tabIndex={isCurrent ? undefined : 0}
        onClick={() => open(w)}
        onKeyDown={e => {
          if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            open(w)
          }
        }}
        title={`${waveLabel(w.rerun_number)} · ${s.tip}${isCurrent ? ' (this project)' : ' — click to open'}`}
        className={`grid items-center gap-2 px-3 ${compact ? 'py-1.5' : 'py-2'} border-b border-border last:border-b-0 border-l-2 ${
          s.ring
        } ${isCurrent ? 'bg-accent/60' : 'cursor-pointer hover:bg-accent/50'} transition-colors`}
        style={{ gridTemplateColumns: GRID }}
      >
        <span
          className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${s.chip} ${s.dashed ? 'border border-dashed border-amber-400/70' : ''} text-center whitespace-nowrap`}
          title={s.label}
        >
          {waveLabel(w.rerun_number)}
        </span>
        <span className="text-sm text-foreground truncate">
          {w.project_name}
          {isCurrent && <span className="text-muted-foreground text-xs"> · this project</span>}
        </span>
        <span
          className={`text-xs ${s.key === 'upcoming' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
          title={s.key === 'delivered' ? 'Delivery date' : s.key === 'upcoming' ? 'Scheduled launch' : 'Not delivered yet'}
        >
          {dateFor(w, s.key)}
        </span>
        <span className="text-xs font-mono text-muted-foreground truncate" title="Project ID">
          {w.project_code ?? '—'}
        </span>
        {isCurrent ? (
          <span className="text-muted-foreground/60 text-xs" title="You are here" aria-hidden="true">
            ●
          </span>
        ) : (
          <span className="text-muted-foreground text-xs" title="Open record" aria-hidden="true">
            ↗
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Toggle + legend */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-border overflow-hidden" role="group" aria-label="View">
          {seg('table', '☰', 'Table', 'Organized, scannable rows')}
          <span className="w-px bg-border" />
          {seg('timeline', '📈', 'Timeline', 'Waves laid out over time')}
        </div>
        <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
          {WAVE_STATUS_LEGEND.map(l => (
            <span key={l.key} className="inline-flex items-center gap-1" title={l.tip}>
              <span className={`w-2 h-2 rounded-full ${l.dot} shrink-0`} aria-hidden="true" /> {l.label}
            </span>
          ))}
        </div>
      </div>

      {view === 'table' ? (
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <div
            className="grid items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border"
            style={{ gridTemplateColumns: GRID }}
          >
            <span title="Wave number and status">Wave</span>
            <span title="Survey name">Project</span>
            <span title="When it went to the client">Delivered</span>
            <span title="Permanent project ID">ID</span>
            <span />
          </div>
          <div
            className={showingAll && collapsible ? 'max-h-72 overflow-y-auto thin-scroll' : ''}
            tabIndex={showingAll && collapsible ? 0 : undefined}
            role={showingAll && collapsible ? 'region' : undefined}
            aria-label={showingAll && collapsible ? `All ${ordered.length} waves (scrollable)` : undefined}
          >
            {display.map(rowFor)}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card px-3 py-4 overflow-x-auto thin-scroll">
          <div className="relative min-w-max">
            <div className="absolute left-8 right-8 top-[42px] h-px bg-border" aria-hidden="true" />
            <div className="relative flex items-start gap-2">
              {ordered.map(w => {
                const s = waveStatus(w, t)
                const isCurrent = w.id === currentId
                return (
                  <div
                    key={w.id}
                    role={isCurrent ? undefined : 'button'}
                    tabIndex={isCurrent ? undefined : 0}
                    onClick={() => open(w)}
                    onKeyDown={e => {
                      if (!isCurrent && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        open(w)
                      }
                    }}
                    title={`${waveLabel(w.rerun_number)} · ${s.tip}${isCurrent ? ' (this project)' : ' — click to open'}`}
                    className={`w-[72px] shrink-0 flex flex-col items-center gap-1.5 ${isCurrent ? '' : 'cursor-pointer'}`}
                  >
                    <div
                      className={`w-full rounded px-1 py-1.5 text-center ${s.chip} ${
                        s.dashed ? 'border border-dashed border-amber-400/70' : `border ${s.ring}`
                      } ${isCurrent ? 'ring-1 ring-ring' : ''}`}
                    >
                      <div className="text-[11px] font-medium leading-tight">{w.rerun_number ?? 1}</div>
                      <div className="text-[10px] font-mono opacity-80 truncate">{w.project_code ?? '—'}</div>
                    </div>
                    <span className={`w-2 h-2 rounded-full ${s.dot} ${s.dashed ? 'opacity-60' : ''}`} aria-hidden="true" />
                    <span className={`text-[10px] ${s.key === 'upcoming' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'} text-center`}>
                      {dateFor(w, s.key)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {view === 'table' && collapsible && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[12px] text-primary hover:underline self-start"
          title={showingAll ? 'Collapse to the most recent waves' : 'Show every wave (scrolls within the box)'}
        >
          {showingAll ? '▴ Show less' : `▾ Show all ${ordered.length} waves`}
        </button>
      )}
    </div>
  )
}

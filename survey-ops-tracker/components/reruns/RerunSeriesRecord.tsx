'use client'
import { useEffect, useState, cloneElement, type ReactElement, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import {
  useRerunSeriesRecord,
  useRerunSeriesActions,
  type SeriesWave,
  type PendingWave,
  type RerunSeriesFieldsPatch,
} from '@/lib/hooks/useRerunSeriesRecord'
import type { FutureDefaults } from '@/lib/reruns/series'
import { useTeamMembers, assignableMembers } from '@/lib/hooks/useTeamMembers'
import { waveStatus, type WaveStatusMeta } from '@/lib/reruns/waveStatus'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
import { ColumnsMenu } from '@/components/shared/ColumnsMenu'
import { BaseTypeTag } from '@/components/reruns/BaseTypeTag'
import { formatDate } from '@/lib/utils/date'
import { fmtNum } from '@/lib/utils/number'
import { toast } from '@/lib/utils/toast'

// The first-class Rerun Series record (migration 073): header + lifecycle
// controls, the next-wave callout, an editable series-details grid, the
// "Defaults for future waves" card, and the waves list with a dedicated
// drag-to-reorder handle. See docs/superpowers/specs/2026-08-10-rerun-update-
// design.md §3/§6/§7 and docs/superpowers/plans/2026-08-10-rerun-update.md
// Task 6 + the review-hardening addendum.
//
// Reorder gesture note: this uses @hello-pangea/dnd (already the app's board
// drag library) scoped to a single dedicated ⠿ grip per row — a completely
// different event pipeline from RerunSeriesBoard's native HTML5
// draggable/dataTransfer cross-series move, so the two gestures can never be
// confused or accidentally trigger each other even if both were ever mounted
// on the same page.

const CADENCE_OPTS: { v: string; label: string }[] = [
  { v: '', label: 'Ad-hoc / one-off' },
  { v: '1', label: 'Monthly' },
  { v: '3', label: 'Quarterly' },
  { v: '6', label: 'Every 6 mo' },
  { v: '12', label: 'Yearly' },
]

function cadenceLabel(m: number | null): string {
  if (m == null) return 'Ad-hoc'
  return ({ 1: 'Monthly', 3: 'Quarterly', 6: 'Every 6 mo', 12: 'Yearly' } as Record<number, string>)[m] ?? `Every ${m} mo`
}

const MONEY_MODEL_OPTS = ['', 'PS suppliers', 'B2B blasts']

type FutureDefaultsUI = FutureDefaults & { money_model?: string | null }

const inputCls =
  'bg-muted border border-border text-foreground text-[12px] rounded-md px-1.5 py-1 focus:outline-none focus:border-ring'

function deliveredCell(w: SeriesWave): string {
  if (w.delivered_at || w.board_column === 'Delivery') return formatDate(w.deliver_date ?? w.delivered_at)
  return w.deliver_date ? `~${formatDate(w.deliver_date)}` : '—'
}

// ---------------------------------------------------------------------------
// Waves table — user-configurable columns (show/hide + reorder), persisted
// per browser like the List view's "⚙ Columns" (app/(app)/list/page.tsx +
// components/list/ProjectTable.tsx, key sot.listHiddenColumns). The ⠿
// row-reorder grip is a fixed first column, outside this registry, since it's
// structural (drives the drag-to-reorder gesture) rather than a data column.
// ---------------------------------------------------------------------------

type WaveColumnKey =
  | 'wave'
  | 'project'
  | 'fielded'
  | 'delivered'
  | 'n_collected'
  | 'n_actual'
  | 'status'
  | 'survey_ids'
  | 'n_target'
  | 'submitted'
  | 'due'

interface WaveColumnDef {
  key: WaveColumnKey
  label: string
  tooltip: string
  /** CSS grid track size, e.g. '100px' or 'minmax(130px,1.1fr)'. */
  width: string
  align?: 'right'
  render: (w: SeriesWave, s: WaveStatusMeta) => ReactElement
}

const WAVE_COLUMN_REGISTRY: WaveColumnDef[] = [
  {
    key: 'wave',
    label: 'Wave',
    tooltip: 'Wave number',
    width: '72px',
    render: (w, s) => (
      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded text-center whitespace-nowrap w-fit ${s.chip}`}>
        Wave {w.rerun_number}
      </span>
    ),
  },
  {
    key: 'project',
    label: 'Project',
    tooltip: 'Project code — click the row to open it',
    width: '84px',
    render: (w) => <span className="text-xs font-mono text-muted-foreground truncate">{w.project_code ?? '—'}</span>,
  },
  {
    key: 'fielded',
    label: 'Fielded / rerun date',
    tooltip: 'When it went (or goes) live in the field',
    width: '100px',
    render: (w) => <span className="text-xs text-muted-foreground">{formatDate(w.launch_date)}</span>,
  },
  {
    key: 'delivered',
    label: 'Delivered',
    tooltip: 'When it was (or is expected to be) sent to the client',
    width: '100px',
    render: (w) => <span className="text-xs text-muted-foreground">{deliveredCell(w)}</span>,
  },
  {
    key: 'n_collected',
    label: 'N collected',
    tooltip: 'Responses collected so far',
    width: '78px',
    align: 'right',
    render: (w) => <span className="text-sm text-foreground text-right tabular-nums">{fmtNum(w.n_collected)}</span>,
  },
  {
    key: 'n_actual',
    label: 'N actual',
    tooltip: 'Final usable response count',
    width: '78px',
    align: 'right',
    render: (w) => <span className="text-sm text-foreground text-right tabular-nums">{fmtNum(w.n_actual)}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    tooltip: 'Wave status',
    width: '90px',
    render: (w, s) => (
      <span className="flex flex-wrap items-center gap-1 min-w-0">
        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded text-center whitespace-nowrap w-fit ${s.chip}`}>{s.label}</span>
        {w.is_placeholder && (
          <span
            title="Assumed-delivered wave — no real data yet; Sree will backfill"
            className="border border-border text-muted-foreground bg-transparent text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
          >
            Placeholder
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'survey_ids',
    label: 'Survey IDs',
    tooltip: 'Survey IDs used in this wave (comma-separated). Can differ per wave.',
    width: 'minmax(130px,1.1fr)',
    render: (w) => (
      <span className="text-xs font-mono text-muted-foreground truncate" title={w.survey_tool_id ?? undefined}>
        {w.survey_tool_id || '—'}
      </span>
    ),
  },
  {
    key: 'n_target',
    label: 'N target',
    tooltip: 'Target response count for this wave',
    width: '78px',
    align: 'right',
    render: (w) => <span className="text-sm text-foreground text-right tabular-nums">{fmtNum(w.n_target)}</span>,
  },
  {
    key: 'submitted',
    label: 'Submitted',
    tooltip: 'When this wave was submitted / created',
    width: '100px',
    render: (w) => <span className="text-xs text-muted-foreground">{formatDate(w.submitted_date)}</span>,
  },
  {
    key: 'due',
    label: 'Due',
    tooltip: 'Internal due date for this wave',
    width: '100px',
    render: (w) => <span className="text-xs text-muted-foreground">{formatDate(w.due_date)}</span>,
  },
]

const WAVE_COLUMN_KEYS: WaveColumnKey[] = WAVE_COLUMN_REGISTRY.map((c) => c.key)

// survey_ids deliberately LAST (far right) — it's the least-often-needed
// column for a quick glance and can run long (comma-separated IDs).
const DEFAULT_WAVE_COLUMNS: WaveColumnKey[] = [
  'wave',
  'project',
  'fielded',
  'delivered',
  'n_collected',
  'n_actual',
  'status',
  'survey_ids',
]

const WAVE_COLUMNS_STORAGE_KEY = 'sot.rerunWaveColumns'

/** Personal-to-browser column prefs, like the List view's hiddenCols. Guards
 * against unknown/renamed keys (a stale localStorage entry from a prior
 * registry shape) by filtering to keys that still exist in the registry, and
 * falls back to the default order if nothing valid survives. */
function loadStoredWaveColumns(): WaveColumnKey[] | null {
  try {
    const raw = localStorage.getItem(WAVE_COLUMNS_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter((k): k is WaveColumnKey => WAVE_COLUMN_KEYS.includes(k as WaveColumnKey))
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

function saveStoredWaveColumns(keys: WaveColumnKey[]) {
  try {
    localStorage.setItem(WAVE_COLUMNS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // storage unavailable/full — the in-memory choice still works this visit
  }
}

/** Extracts the leading pixel size from a grid track (e.g. '100px' -> 100,
 * 'minmax(130px,1.1fr)' -> 130) so the scroll wrapper gets a sensible
 * min-width even though the column set is now dynamic. Approximate by
 * design — it only needs to keep columns from getting too cramped. */
function trackMinPx(width: string): number {
  const m = width.match(/(\d+)px/)
  return m ? Number(m[1]) : 80
}

/** The waves grid itself — header row + drag-to-reorder body — built from
 * whichever columns are currently visible. The ⠿ grip is a fixed first
 * track outside the column registry so row-reorder can never be hidden or
 * moved by the column picker. */
function WavesTable({
  waves,
  waveColumns,
  onDragEnd,
  onOpenWave,
}: {
  waves: SeriesWave[]
  waveColumns: WaveColumnKey[]
  onDragEnd: (result: DropResult) => void
  onOpenWave: (id: string) => void
}) {
  const visibleColumns = waveColumns
    .map((key) => WAVE_COLUMN_REGISTRY.find((c) => c.key === key))
    .filter((c): c is WaveColumnDef => !!c)
  const gridTemplate = ['22px', ...visibleColumns.map((c) => c.width)].join(' ')
  const minWidth = 22 + visibleColumns.reduce((sum, c) => sum + trackMinPx(c.width) + 8, 0)

  return (
    <div className="overflow-x-auto thin-scroll">
      <div style={{ minWidth }}>
        <div
          className="grid items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <span />
          {visibleColumns.map((col) => (
            <span key={col.key} title={col.tooltip} className={col.align === 'right' ? 'text-right' : undefined}>
              {col.label}
            </span>
          ))}
        </div>
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="rerun-series-waves">
            {(dropProvided, dropSnapshot) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className={dropSnapshot.isDraggingOver ? 'bg-primary/5' : undefined}
              >
                {waves.map((w, index) => {
                  const s = waveStatus(w, new Date().toISOString().slice(0, 10))
                  return (
                    <Draggable key={w.id} draggableId={w.id} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          role="button"
                          tabIndex={0}
                          onClick={() => onOpenWave(w.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              onOpenWave(w.id)
                            }
                          }}
                          title={`Wave ${w.rerun_number} · ${s.tip} — click to open`}
                          style={{ ...dragProvided.draggableProps.style, gridTemplateColumns: gridTemplate }}
                          className={`grid items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 border-l-2 ${s.ring} cursor-pointer hover:bg-accent/50 hover:ring-1 hover:ring-inset hover:ring-primary/30 transition ${
                            dragSnapshot.isDragging ? 'bg-card shadow-lg ring-1 ring-primary/40 rounded-lg' : ''
                          }`}
                        >
                          <span
                            {...dragProvided.dragHandleProps}
                            onClick={(e) => e.stopPropagation()}
                            title="Drag to reorder this wave within the series"
                            aria-label="Drag to reorder"
                            className="text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing justify-self-center"
                          >
                            ⠿
                          </span>
                          {visibleColumns.map((col) => cloneElement(col.render(w, s), { key: col.key }))}
                        </div>
                      )}
                    </Draggable>
                  )
                })}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  )
}

export function RerunSeriesRecord({ seriesId }: { seriesId: string }) {
  const router = useRouter()
  const { data, isLoading, error } = useRerunSeriesRecord(seriesId)
  const actions = useRerunSeriesActions()
  const { data: teamMembers = [] } = useTeamMembers()

  const [editingDetails, setEditingDetails] = useState(false)
  const [editingDefaults, setEditingDefaults] = useState(false)
  const [pendingPrompt, setPendingPrompt] = useState<{ action: 'pause' | 'end'; wave: NonNullable<PendingWave> } | null>(null)
  const [localWaves, setLocalWaves] = useState<SeriesWave[] | null>(null)
  const [waveColumns, setWaveColumnsState] = useState<WaveColumnKey[]>(DEFAULT_WAVE_COLUMNS)

  useEffect(() => {
    if (data?.waves) setLocalWaves([...data.waves].sort((a, b) => a.rerun_number - b.rerun_number))
  }, [data?.waves])

  // Hydrate the column prefs from localStorage on mount (client-only, like
  // ProjectTable's density/hiddenCols reads) — avoids an SSR/client mismatch.
  useEffect(() => {
    const stored = loadStoredWaveColumns()
    if (stored) setWaveColumnsState(stored)
  }, [])

  // Accepts a plain string[] (the shared ColumnsMenu's onChange contract) and
  // narrows/filters to the known WaveColumnKey shape before storing — the menu
  // only ever emits keys drawn from WAVE_COLUMN_REGISTRY, so this is a cheap
  // defensive guard rather than a real narrowing need.
  function setWaveColumns(next: string[]) {
    const filtered = next.filter((k): k is WaveColumnKey => WAVE_COLUMN_KEYS.includes(k as WaveColumnKey))
    setWaveColumnsState(filtered)
    saveStoredWaveColumns(filtered)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 text-sm text-destructive">
        Couldn&apos;t load this rerun series{error ? `: ${(error as Error).message}` : '.'}
      </div>
    )
  }

  const { series } = data
  // Falls back to the query's own sorted waves so there's no empty-state flash
  // between data arriving and the sync effect above committing localWaves;
  // localWaves only actually diverges during/after an in-flight drag-reorder.
  const waves = localWaves ?? [...data.waves].sort((a, b) => a.rerun_number - b.rerun_number)
  const fd = (series.future_defaults ?? {}) as FutureDefaultsUI

  const primaryCaptain =
    teamMembers.find((m) => m.id === fd.captain_id) ??
    teamMembers.find((m) => m.email?.toLowerCase() === (series.owner_email ?? '').toLowerCase())
  const coCaptainNames = (fd.co_captain_ids ?? [])
    .map((cid) => teamMembers.find((m) => m.id === cid)?.name)
    .filter((n): n is string => !!n)

  function runPauseOrEnd(action: 'pause' | 'end') {
    actions.mutate(
      { action, seriesId, dryRun: true },
      {
        onSuccess: (res) => {
          if (res.pendingWave) setPendingPrompt({ action, wave: res.pendingWave })
          else commitPauseOrEnd(action, false)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function commitPauseOrEnd(action: 'pause' | 'end', cancelPending: boolean) {
    actions.mutate(
      { action, seriesId, cancelPending },
      {
        onSuccess: () => {
          toast(action === 'pause' ? 'Series paused.' : 'Rerun service ended.', 'success')
          setPendingPrompt(null)
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function resumeOrReactivate(action: 'resume' | 'reactivate') {
    actions.mutate(
      { action, seriesId },
      {
        onSuccess: () => toast(action === 'resume' ? 'Series resumed.' : 'Series reactivated.', 'success'),
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function arm() {
    actions.mutate(
      { action: 'arm', seriesId, armed: true },
      {
        onSuccess: () => toast('Auto-spawn armed — future waves are created automatically.', 'success'),
        onError: (e) => toast((e as Error).message),
      }
    )
  }
  function spawnNext() {
    actions.mutate(
      { action: 'spawn_next', seriesId },
      {
        onSuccess: (res) => {
          if (res.spawn?.created) toast(`Wave created: ${res.spawn.waveName}`, 'success')
          else toast(res.spawn?.reason ? `Nothing to create — ${res.spawn.reason}.` : 'Nothing to create yet.')
        },
        onError: (e) => toast((e as Error).message),
      }
    )
  }

  function onDragEnd(result: DropResult) {
    if (!result.destination) return
    const from = result.source.index
    const to = result.destination.index
    if (from === to) return
    const prevOrder = waves
    const next = Array.from(prevOrder)
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setLocalWaves(next)
    actions.mutate(
      { action: 'reorder', seriesId, orderedWaveIds: next.map((w) => w.id) },
      {
        onSuccess: (res) => {
          const ordered = res.waves ?? next
          const label = ordered.map((w) => w.project_code ?? w.project_name).join(' → ')
          toast(`New order: ${label}`, 'success')
        },
        onError: (e) => {
          setLocalWaves(prevOrder)
          toast((e as Error).message)
        },
      }
    )
  }

  const defaultsSummary = [
    fd.n_target != null ? `N ${fmtNum(fd.n_target)}` : null,
    fd.audience || null,
    fd.money_model || null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">
              {series.client} — {series.survey_name}
            </h1>
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              <BaseTypeTag baseType={series.base_type} rerunService={series.rerun_service} className="text-xs px-2 py-0.5" />
              <span
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-primary/40 text-primary bg-primary/5"
                title="This is a first-class rerun series record — a wave belongs here via series_id."
              >
                ↻ Rerun series
              </span>
              {!series.in_service ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border" title="Out of rerun service — no more waves will be created.">
                  Ended
                </span>
              ) : series.paused ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300" title="Paused — auto-spawning is stopped until resumed.">
                  ⏸ Paused
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" title="In rerun service.">
                  In service
                </span>
              )}
              <span
                className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
                title={series.service_mode === 'auto' ? 'Waves are created automatically before they’re due.' : 'Waves are created by hand ("Create next wave").'}
              >
                {series.service_mode === 'auto' ? 'Auto' : 'Manual'}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border" title="Cadence between waves.">
                {cadenceLabel(series.cadence_months)}
              </span>
              {series.is_overdue && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-700 dark:text-red-300" title="Past the effective next-wave date.">
                  ⚠ Overdue
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {primaryCaptain?.name ?? series.owner_email ?? 'Unassigned'} (primary)
              {coCaptainNames.length > 0 && <> · co-captain {coCaptainNames.join(', ')}</>}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {series.in_service &&
              (series.paused ? (
                <button
                  onClick={() => resumeOrReactivate('resume')}
                  disabled={actions.isPending}
                  className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  ▶ Resume
                </button>
              ) : (
                <button
                  onClick={() => runPauseOrEnd('pause')}
                  disabled={actions.isPending}
                  title="Temporary — auto-spawning stops until you resume. The series stays live."
                  className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  ⏸ Pause
                </button>
              ))}
            {series.in_service ? (
              <button
                onClick={() => runPauseOrEnd('end')}
                disabled={actions.isPending}
                title="Permanent — out of rerun service. Past waves and this record stay for history; reactivate anytime."
                className="text-xs border border-border text-muted-foreground hover:text-red-600 dark:hover:text-red-400 hover:border-ring px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              >
                ⛔ End rerun service
              </button>
            ) : (
              <button
                onClick={() => resumeOrReactivate('reactivate')}
                disabled={actions.isPending}
                className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
              >
                ↺ Reactivate
              </button>
            )}
            {!series.auto_armed && (
              <button
                onClick={arm}
                disabled={actions.isPending}
                title="Auto-spawn is off until armed — a safety check after seeding/promotion. Arming lets the cadence create waves automatically from now on."
                className="text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15 transition-colors disabled:opacity-40"
              >
                ⚡ Arm auto-spawn
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pending-wave prompt (pause/end with an un-fielded spawned wave) */}
      {pendingPrompt && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPendingPrompt(null)}>
          <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-md p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-foreground">{pendingPrompt.action === 'pause' ? 'Pause' : 'End'} rerun service</h3>
            <p className="text-xs text-muted-foreground">
              Wave {pendingPrompt.wave.rerun_number} ({pendingPrompt.wave.project_code ?? pendingPrompt.wave.project_name}) was already
              created but hasn&apos;t started fielding yet. Cancel it, or leave it as-is?
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => commitPauseOrEnd(pendingPrompt.action, true)}
                disabled={actions.isPending}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                Cancel that wave
              </button>
              <button
                onClick={() => commitPauseOrEnd(pendingPrompt.action, false)}
                disabled={actions.isPending}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-foreground/90 hover:bg-accent transition-colors disabled:opacity-40"
              >
                Leave it
              </button>
              <button onClick={() => setPendingPrompt(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Back out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next-wave callout */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Wave {series.next_wave_no} · auto-creates {series.effective_next ? formatDate(series.effective_next) : 'no date computed yet'}
            {defaultsSummary && <span className="text-muted-foreground font-normal"> · {defaultsSummary}</span>}
          </p>
          {!series.auto_armed && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              ⚡ Auto-spawn is OFF until armed — create the next wave by hand once to review it (this arms auto-spawn going forward).
            </p>
          )}
        </div>
        <button
          onClick={spawnNext}
          disabled={actions.isPending || !series.in_service}
          title="Manually push the next wave now (applies the future-wave defaults below). For a series that isn't armed yet, this first manual push also turns on auto-spawn going forward."
          className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 shrink-0"
        >
          {actions.isPending ? 'Working…' : 'Create next wave now'}
        </button>
      </div>

      {/* Series details */}
      <SeriesDetailsSection series={series} onSave={(fields) => {
        actions.mutate(
          { action: 'update', seriesId, fields },
          {
            onSuccess: () => { toast('Series details updated ✓', 'success'); setEditingDetails(false) },
            onError: (e) => toast((e as Error).message),
          }
        )
      }} editing={editingDetails} setEditing={setEditingDetails} saving={actions.isPending} />

      {/* Defaults for future waves */}
      <FutureDefaultsSection
        fd={fd}
        editing={editingDefaults}
        setEditing={setEditingDefaults}
        saving={actions.isPending}
        teamMembers={teamMembers}
        onSave={(next) => {
          actions.mutate(
            { action: 'set_defaults', seriesId, future_defaults: next as unknown as Record<string, unknown> },
            {
              onSuccess: () => {
                toast('Future-wave defaults updated — affects waves created from now on', 'success')
                setEditingDefaults(false)
              },
              onError: (e) => toast((e as Error).message),
            }
          )
        }}
      />

      {/* Waves list */}
      <div className="bg-card border border-border shadow-sm rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Waves</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Click a row to open the wave · drag the ⠿ grip to reorder within this series
            </p>
          </div>
          <ColumnsMenu
            visibleKeys={waveColumns}
            allColumns={WAVE_COLUMN_REGISTRY}
            defaultKeys={DEFAULT_WAVE_COLUMNS}
            onChange={setWaveColumns}
            buttonTitle="Choose which wave columns you see, and their order — personal to you, remembered in this browser"
          />
        </div>
        {waves.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No waves yet — <button onClick={spawnNext} className="text-primary hover:underline">Create the next wave</button>
          </div>
        ) : (
          <WavesTable waves={waves} waveColumns={waveColumns} onDragEnd={onDragEnd} onOpenWave={(id) => router.push(`/projects/${id}`)} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Series details — editable via the `update` action.
// ---------------------------------------------------------------------------

function SeriesDetailsSection({
  series,
  onSave,
  editing,
  setEditing,
  saving,
}: {
  series: import('@/lib/hooks/useRerunSeriesRecord').SeriesStatusRow
  onSave: (fields: RerunSeriesFieldsPatch) => void
  editing: boolean
  setEditing: (v: boolean) => void
  saving: boolean
}) {
  const [cadence, setCadence] = useState(series.cadence_months != null ? String(series.cadence_months) : '')
  const [deliveryCadence, setDeliveryCadence] = useState(series.delivery_cadence ?? '')
  const [serviceMode, setServiceMode] = useState(series.service_mode)
  const [templateId, setTemplateId] = useState(series.template_id ?? '')
  const [ownerEmail, setOwnerEmail] = useState(series.owner_email ?? '')
  // base_type may be blank for a legacy Rerun-Service series (migration 074);
  // '' keeps the <select> a controlled string. Picking PS/B2B classifies it.
  const [baseType, setBaseType] = useState(series.base_type ?? '')
  const [surveyName, setSurveyName] = useState(series.survey_name)
  const [notes, setNotes] = useState(series.notes ?? '')

  function openEdit() {
    setCadence(series.cadence_months != null ? String(series.cadence_months) : '')
    setDeliveryCadence(series.delivery_cadence ?? '')
    setServiceMode(series.service_mode)
    setTemplateId(series.template_id ?? '')
    setOwnerEmail(series.owner_email ?? '')
    setBaseType(series.base_type ?? '')
    setSurveyName(series.survey_name)
    setNotes(series.notes ?? '')
    setEditing(true)
  }

  const Field = ({ label, value, tip }: { label: string; value: string; tip?: string }) => (
    <div>
      <div className="text-[11px] text-muted-foreground flex items-center">
        {label}
        {tip && <InfoTooltip text={tip} />}
      </div>
      <div className="text-sm text-foreground truncate">{value}</div>
    </div>
  )

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Series details</h2>
        {!editing && (
          <button onClick={openEdit} className="text-[12px] text-primary hover:underline">
            ✎ Edit
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Cadence" value={cadenceLabel(series.cadence_months)} tip="How often a new wave runs (monthly, quarterly, etc.). Drives the next-wave due date." />
          <Field label="Delivery cadence" value={series.delivery_cadence ?? '—'} tip="When each wave is delivered to the client (free text, e.g. “Beginning of month”)." />
          <Field label="Source template" value={series.template_id ?? '—'} tip="The survey template the original wave was built from. Later waves can use different survey IDs — see the Waves table." />
          <Field label="Owner" value={series.owner_email ?? '—'} tip="Who owns this rerun series — receives the weekly rerun digest and is the go-to person for it." />
          <Field label="Fielding start (anchor)" value={formatDate(series.anchor_date)} tip="Fallback due-date anchor for a seeded/fresh series with no wave dates yet." />
          <Field label="Next due" value={series.effective_next ? formatDate(series.effective_next) : '—'} tip="When the next wave is due to field — computed from the last wave’s date plus the cadence." />
          <Field label="In service" value={!series.in_service ? 'Ended' : series.paused ? 'Paused' : 'Yes'} tip="Whether the series is actively running. Ended = no more waves; Paused = temporarily stopped; Yes = live." />
          <Field label="Mode" value={series.service_mode === 'auto' ? 'Auto' : 'Manual'} tip="Auto = waves are created automatically before they’re due. Manual = you create each wave by hand." />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Survey name</span>
            <input value={surveyName} onChange={(e) => setSurveyName(e.target.value)} className={inputCls} />
          </label>
          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Base type
              <select value={baseType} onChange={(e) => setBaseType(e.target.value)} className={inputCls}>
                <option value="PS">PS</option>
                <option value="B2B">B2B</option>
              </select>
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Cadence
              <select value={cadence} onChange={(e) => setCadence(e.target.value)} className={inputCls}>
                {CADENCE_OPTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Delivery cadence
              <input
                type="text"
                placeholder="e.g. Beginning of month"
                value={deliveryCadence}
                onChange={(e) => setDeliveryCadence(e.target.value)}
                className={`${inputCls} w-48`}
              />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Mode
              <select value={serviceMode} onChange={(e) => setServiceMode(e.target.value)} className={inputCls}>
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Template
              <input type="text" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${inputCls} w-40`} />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Owner email
              <input
                type="text"
                inputMode="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className={`${inputCls} w-48`}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted-foreground">Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} resize-none`} />
          </label>
          <div className="flex items-center gap-3">
            <button
              disabled={saving}
              onClick={() =>
                onSave({
                  survey_name: surveyName.trim() || series.survey_name,
                  base_type: baseType as 'PS' | 'B2B',
                  cadence_months: cadence ? Number(cadence) : null,
                  delivery_cadence: deliveryCadence.trim() || null,
                  service_mode: serviceMode,
                  template_id: templateId.trim() || null,
                  owner_email: ownerEmail.trim() || null,
                  notes: notes.trim() || null,
                })
              }
              className="text-[12px] px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)} className="text-[12px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Defaults for future waves — editable via the `set_defaults` action.
// ---------------------------------------------------------------------------

function FutureDefaultsSection({
  fd,
  onSave,
  editing,
  setEditing,
  saving,
  teamMembers,
}: {
  fd: FutureDefaultsUI
  onSave: (next: FutureDefaultsUI) => void
  editing: boolean
  setEditing: (v: boolean) => void
  saving: boolean
  teamMembers: import('@/lib/hooks/useTeamMembers').TeamMember[]
}) {
  const [nTarget, setNTarget] = useState(fd.n_target != null ? String(fd.n_target) : '')
  const [audience, setAudience] = useState(fd.audience ?? '')
  const [moneyModel, setMoneyModel] = useState(fd.money_model ?? '')
  const [templateId, setTemplateId] = useState(fd.template_id ?? '')
  const [complianceOverride, setComplianceOverride] = useState(fd.compliance_required_override === true)
  const [captainId, setCaptainId] = useState(fd.captain_id ?? '')
  const [coCaptainIds, setCoCaptainIds] = useState<string[]>(fd.co_captain_ids ?? [])
  const [addingCoCaptain, setAddingCoCaptain] = useState(false)

  function openEdit() {
    setNTarget(fd.n_target != null ? String(fd.n_target) : '')
    setAudience(fd.audience ?? '')
    setMoneyModel(fd.money_model ?? '')
    setTemplateId(fd.template_id ?? '')
    setComplianceOverride(fd.compliance_required_override === true)
    setCaptainId(fd.captain_id ?? '')
    setCoCaptainIds(fd.co_captain_ids ?? [])
    setEditing(true)
  }

  const byId = new Map(teamMembers.map((m) => [m.id, m]))
  const primaryName = fd.captain_id ? byId.get(fd.captain_id)?.name ?? 'Unknown' : 'Default rerun captain'
  const coNames = (fd.co_captain_ids ?? []).map((cid) => byId.get(cid)?.name ?? 'Unknown')
  const available = assignableMembers(teamMembers).filter((m) => m.id !== captainId && !coCaptainIds.includes(m.id))

  const DField = ({ label, tip, children }: { label: string; tip: string; children: ReactNode }) => (
    <div>
      <div className="text-[11px] text-muted-foreground flex items-center">
        {label}
        <InfoTooltip text={tip} />
      </div>
      <div className="text-foreground truncate">{children}</div>
    </div>
  )

  return (
    <div className="bg-card border border-border shadow-sm rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Defaults for future waves</h2>
          <p className="text-[11px] text-muted-foreground">Applies to new waves only; existing waves are untouched.</p>
        </div>
        {!editing && (
          <button onClick={openEdit} className="text-[12px] text-primary hover:underline shrink-0">
            ✎ Edit defaults
          </button>
        )}
      </div>

      {!editing ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <DField label="N target" tip="Default target response count applied to each new wave.">
            {fmtNum(fd.n_target)}
          </DField>
          <DField label="Audience" tip="Default audience / sample description applied to each new wave.">
            {fd.audience || '—'}
          </DField>
          <DField label="Money model" tip="Default cost model for new waves — PS suppliers or B2B blasts.">
            {fd.money_model || '—'}
          </DField>
          <DField label="Default template" tip="New waves start from this template. Each wave’s actual survey IDs can differ — see the Waves table.">
            {fd.template_id || '—'}
          </DField>
          <DField label="Compliance" tip="A rerun inherits wave 1’s compliance approval, so review is waived from wave 2 on — unless you require it on every wave here.">
            {fd.compliance_required_override === true ? 'Required on every wave' : 'Waived (wave ≥ 2)'}
          </DField>
          <DField label="Captain" tip="Default captain (and co-captains) assigned to each new wave.">
            {primaryName}
            {coNames.length > 0 && <span className="text-muted-foreground"> · {coNames.join(', ')}</span>}
          </DField>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              N target
              <input type="number" min={0} value={nTarget} onChange={(e) => setNTarget(e.target.value)} className={`${inputCls} w-24`} />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Audience
              <input type="text" value={audience} onChange={(e) => setAudience(e.target.value)} className={`${inputCls} w-56`} />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Money model
              <select value={moneyModel} onChange={(e) => setMoneyModel(e.target.value)} className={inputCls}>
                {MONEY_MODEL_OPTS.map((o) => (
                  <option key={o} value={o}>
                    {o || '—'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Template
              <input type="text" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${inputCls} w-40`} />
            </label>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <input type="checkbox" checked={complianceOverride} onChange={(e) => setComplianceOverride(e.target.checked)} />
            Require compliance review on every future wave (overrides the default wave ≥ 2 waiver)
          </label>
          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
            <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
              Captain
              <select value={captainId} onChange={(e) => setCaptainId(e.target.value)} className={inputCls}>
                <option value="">Default rerun captain</option>
                {assignableMembers(teamMembers).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground flex-wrap">
              Co-captains:
              {coCaptainIds.map((cid) => (
                <span key={cid} className="inline-flex items-center gap-1 text-foreground">
                  {byId.get(cid)?.name ?? 'Unknown'}
                  <button
                    onClick={() => setCoCaptainIds(coCaptainIds.filter((x) => x !== cid))}
                    className="text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400"
                    title="Remove"
                  >
                    ✕
                  </button>
                </span>
              ))}
              {addingCoCaptain ? (
                <select
                  autoFocus
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) setCoCaptainIds([...coCaptainIds, e.target.value])
                    setAddingCoCaptain(false)
                  }}
                  onBlur={() => setAddingCoCaptain(false)}
                  className={inputCls}
                >
                  <option value="">— pick —</option>
                  {available.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              ) : (
                <button onClick={() => setAddingCoCaptain(true)} className="text-primary hover:underline">
                  ＋ add
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={saving}
              onClick={() =>
                onSave({
                  ...fd,
                  n_target: nTarget ? Number(nTarget) : null,
                  audience: audience.trim() || null,
                  money_model: moneyModel || null,
                  template_id: templateId.trim() || null,
                  compliance_required_override: complianceOverride ? true : null,
                  captain_id: captainId || null,
                  co_captain_ids: coCaptainIds,
                })
              }
              className="text-[12px] px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save defaults'}
            </button>
            <button onClick={() => setEditing(false)} className="text-[12px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

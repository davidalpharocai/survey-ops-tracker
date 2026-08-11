'use client'
import { useEffect, useState } from 'react'
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
import { waveStatus } from '@/lib/reruns/waveStatus'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { Skeleton } from '@/components/shared/Skeleton'
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

const TYPE_BADGE: Record<string, string> = {
  PS: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  B2B: 'bg-violet-500/20 text-violet-600 dark:text-violet-400',
}

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

const WAVE_GRID = '22px 68px 92px 96px 96px 84px 84px 100px'

function deliveredCell(w: SeriesWave): string {
  if (w.delivered_at || w.board_column === 'Delivery') return formatDate(w.deliver_date ?? w.delivered_at)
  return w.deliver_date ? `~${formatDate(w.deliver_date)}` : '—'
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

  useEffect(() => {
    if (data?.waves) setLocalWaves([...data.waves].sort((a, b) => a.rerun_number - b.rerun_number))
  }, [data?.waves])

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
              <span className={`text-xs px-2 py-0.5 rounded ${TYPE_BADGE[series.base_type] ?? ''}`}>{series.base_type}</span>
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
          title="Create the next wave right now, applying the future-wave defaults below."
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
        <div className="px-4 py-2.5 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Waves</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Click a row to open the wave · drag the ⠿ grip to reorder within this series
          </p>
        </div>
        {waves.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No waves yet — <button onClick={spawnNext} className="text-primary hover:underline">Create the next wave</button>
          </div>
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <div className="min-w-[720px]">
              <div
                className="grid items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border"
                style={{ gridTemplateColumns: WAVE_GRID }}
              >
                <span />
                <span title="Wave number">Wave</span>
                <span title="Permanent project ID">Survey ID</span>
                <span title="When it went (or goes) live in the field">Fielded / rerun date</span>
                <span title="When it was (or is expected to be) sent to the client">Delivered</span>
                <span className="text-right" title="Responses collected so far">N collected</span>
                <span className="text-right" title="Final usable response count">N actual</span>
                <span title="Wave status">Status</span>
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
                                onClick={() => router.push(`/projects/${w.id}`)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    router.push(`/projects/${w.id}`)
                                  }
                                }}
                                title={`Wave ${w.rerun_number} · ${s.tip} — click to open`}
                                style={{ ...dragProvided.draggableProps.style, gridTemplateColumns: WAVE_GRID }}
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
                                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded text-center whitespace-nowrap ${s.chip}`}>
                                  Wave {w.rerun_number}
                                </span>
                                <span className="text-xs font-mono text-muted-foreground truncate">{w.project_code ?? '—'}</span>
                                <span className="text-xs text-muted-foreground">{formatDate(w.launch_date)}</span>
                                <span className="text-xs text-muted-foreground">{deliveredCell(w)}</span>
                                <span className="text-sm text-foreground text-right tabular-nums">{fmtNum(w.n_collected)}</span>
                                <span className="text-sm text-foreground text-right tabular-nums">{fmtNum(w.n_actual)}</span>
                                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded text-center whitespace-nowrap w-fit ${s.chip}`}>{s.label}</span>
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
  const [baseType, setBaseType] = useState(series.base_type)
  const [surveyName, setSurveyName] = useState(series.survey_name)
  const [notes, setNotes] = useState(series.notes ?? '')

  function openEdit() {
    setCadence(series.cadence_months != null ? String(series.cadence_months) : '')
    setDeliveryCadence(series.delivery_cadence ?? '')
    setServiceMode(series.service_mode)
    setTemplateId(series.template_id ?? '')
    setOwnerEmail(series.owner_email ?? '')
    setBaseType(series.base_type)
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
          <Field label="Cadence" value={cadenceLabel(series.cadence_months)} />
          <Field label="Delivery cadence" value={series.delivery_cadence ?? '—'} />
          <Field label="Template" value={series.template_id ?? '—'} />
          <Field label="Owner" value={series.owner_email ?? '—'} />
          <Field label="Fielding start (anchor)" value={formatDate(series.anchor_date)} tip="Fallback due-date anchor for a seeded/fresh series with no wave dates yet." />
          <Field label="Next due" value={series.effective_next ? formatDate(series.effective_next) : '—'} />
          <Field label="In service" value={!series.in_service ? 'Ended' : series.paused ? 'Paused' : 'Yes'} />
          <Field label="Mode" value={series.service_mode === 'auto' ? 'Auto' : 'Manual'} />
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
          <div>
            <div className="text-[11px] text-muted-foreground">N target</div>
            <div className="text-foreground">{fmtNum(fd.n_target)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Audience</div>
            <div className="text-foreground truncate">{fd.audience || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Money model</div>
            <div className="text-foreground">{fd.money_model || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Template</div>
            <div className="text-foreground truncate">{fd.template_id || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Compliance</div>
            <div className="text-foreground">{fd.compliance_required_override === true ? 'Required on every wave' : 'Waived (wave ≥ 2)'}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Captain</div>
            <div className="text-foreground truncate">
              {primaryName}
              {coNames.length > 0 && <span className="text-muted-foreground"> · {coNames.join(', ')}</span>}
            </div>
          </div>
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

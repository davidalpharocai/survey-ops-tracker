'use client'
import { useEffect, useRef, useState } from 'react'
import { STAGE_ORDER } from '@/lib/utils/stage'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useClients } from '@/lib/hooks/useClients'
import { NewClientModal } from '@/components/client/NewClientModal'

const NEW_CLIENT_VALUE = '__new__'

const SELECT_CLASSES =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring'

const DUE_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  twodays: 'In 2 days',
  week: 'This week',
  month: 'This month',
  none: 'No due date',
  custom: 'Custom range',
}

function Field({
  label,
  tooltip,
  children,
}: {
  label: string
  tooltip?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-center text-[11px] text-muted-foreground uppercase tracking-wider">
        {label}
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      {children}
    </label>
  )
}

/** A removable active-filter chip. */
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-primary/15 text-primary rounded-full pl-2.5 pr-1 py-0.5">
      {label}
      <button
        onClick={onClear}
        aria-label={`Clear ${label}`}
        title={`Clear ${label}`}
        className="rounded-full w-4 h-4 flex items-center justify-center hover:bg-primary/20 leading-none"
      >
        ✕
      </button>
    </span>
  )
}

interface BoardFiltersProps {
  captains: { id: string; name: string; initials: string }[]
  captainFilter: string | null
  currentMemberId?: string | null
  typeFilter: string | null
  dueFilter: string | null
  dueFrom: string | null
  dueTo: string | null
  stageFilter: string | null
  clientFilter: string | null
  search: string
  onCaptainChange: (id: string | null) => void
  onTypeChange: (type: string | null) => void
  onDueChange: (due: string | null) => void
  onDueFromChange: (date: string | null) => void
  onDueToChange: (date: string | null) => void
  onStageChange: (stage: string | null) => void
  onClientChange: (client: string | null) => void
  onSearchChange: (q: string) => void
}

export function BoardFilters({
  captains,
  captainFilter,
  currentMemberId = null,
  typeFilter,
  dueFilter,
  dueFrom,
  dueTo,
  stageFilter,
  clientFilter,
  search,
  onCaptainChange,
  onTypeChange,
  onDueChange,
  onDueFromChange,
  onDueToChange,
  onStageChange,
  onClientChange,
  onSearchChange,
}: BoardFiltersProps) {
  const { data: clients = [] } = useClients()
  const [showNewClient, setShowNewClient] = useState(false)
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

  // Close the Filters popover on outside-click / Escape (mirrors AppMenu).
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const captainLabel = captainFilter
    ? captainFilter === 'unassigned'
      ? 'Unassigned'
      : captains.find(c => c.id === captainFilter)?.initials ?? '—'
    : null
  const activeCount = [captainFilter, clientFilter, typeFilter, dueFilter, stageFilter].filter(
    Boolean
  ).length
  const anyActive = activeCount > 0 || !!search

  function clearDue() {
    onDueChange(null)
    onDueFromChange(null)
    onDueToChange(null)
  }
  function clearAll() {
    onCaptainChange(null)
    onClientChange(null)
    onTypeChange(null)
    clearDue()
    onStageChange(null)
    onSearchChange('')
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Filters popover trigger */}
        <div ref={popRef} className="relative">
          <button
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            title="Filter the board by captain, client, type, due date, or stage"
            className="inline-flex items-center gap-1.5 text-xs bg-muted border border-border text-foreground/80 rounded-lg px-3 py-1.5 hover:border-ring transition-colors"
          >
            <span aria-hidden="true">⧩</span> Filters
            {activeCount > 0 && (
              <span className="ml-0.5 text-[11px] font-medium bg-primary/15 text-primary rounded-full px-1.5">
                {activeCount}
              </span>
            )}
            <span aria-hidden="true" className="text-muted-foreground">▾</span>
          </button>
          {open && (
            <div className="absolute left-0 top-full mt-2 z-40 w-64 bg-popover border border-border rounded-xl shadow-xl p-3 flex flex-col gap-3">
              <Field label="Captain" tooltip="Show only projects led by this captain — the team member responsible end-to-end.">
                <select
                  value={captainFilter ?? ''}
                  onChange={e => onCaptainChange(e.target.value || null)}
                  className={`${SELECT_CLASSES} w-full`}
                >
                  <option value="">All Captains</option>
                  <option value="unassigned">Unassigned</option>
                  {captains.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.id === currentMemberId ? `${c.initials} (me)` : c.initials}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Client" tooltip="Filter by client (firm). Pick + New Client at the bottom to add one without leaving the board.">
                <select
                  value={clientFilter ?? ''}
                  onChange={e => {
                    const value = e.target.value
                    if (value === NEW_CLIENT_VALUE) {
                      setShowNewClient(true)
                      return
                    }
                    onClientChange(value || null)
                  }}
                  className={`${SELECT_CLASSES} w-full`}
                >
                  <option value="">All Clients</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value={NEW_CLIENT_VALUE}>+ New Client</option>
                </select>
              </Field>
              <Field label="Type" tooltip="Filter by project type: PS (PureSpectrum consumer panel), B2B (expert/business panel), or Rerun (repeat wave of an earlier study).">
                <select
                  value={typeFilter ?? ''}
                  onChange={e => onTypeChange(e.target.value || null)}
                  className={`${SELECT_CLASSES} w-full`}
                >
                  <option value="">All Types</option>
                  <option value="PS">PS</option>
                  <option value="B2B">B2B</option>
                  <option value="Rerun">Rerun</option>
                </select>
              </Field>
              <Field label="Due" tooltip="Filter by due date — a preset window, or a custom range.">
                <select
                  value={dueFilter ?? ''}
                  onChange={e => onDueChange(e.target.value || null)}
                  className={`${SELECT_CLASSES} w-full`}
                >
                  <option value="">All</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="twodays">In 2 days</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="none">No due date</option>
                  <option value="custom">Custom range…</option>
                </select>
              </Field>
              {dueFilter === 'custom' && (
                <div className="flex gap-2">
                  <Field label="From">
                    <input
                      type="date"
                      value={dueFrom ?? ''}
                      onChange={e => onDueFromChange(e.target.value || null)}
                      className={`${SELECT_CLASSES} w-full`}
                    />
                  </Field>
                  <Field label="To">
                    <input
                      type="date"
                      value={dueTo ?? ''}
                      onChange={e => onDueToChange(e.target.value || null)}
                      className={`${SELECT_CLASSES} w-full`}
                    />
                  </Field>
                </div>
              )}
              <Field label="Stage" tooltip="Filter by pipeline stage, from Submitted through Delivery (or Closed).">
                <select
                  value={stageFilter ?? ''}
                  onChange={e => onStageChange(e.target.value || null)}
                  className={`${SELECT_CLASSES} w-full`}
                >
                  <option value="">All Stages</option>
                  {STAGE_ORDER.map(stage => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                  <option value="Closed">Closed</option>
                </select>
              </Field>
            </div>
          )}
        </div>

        {/* Active-filter chips — each clears just its own filter. */}
        {captainLabel && <Chip label={`Captain: ${captainLabel}`} onClear={() => onCaptainChange(null)} />}
        {clientFilter && <Chip label={`Client: ${clientFilter}`} onClear={() => onClientChange(null)} />}
        {typeFilter && <Chip label={`Type: ${typeFilter}`} onClear={() => onTypeChange(null)} />}
        {dueFilter && <Chip label={`Due: ${DUE_LABELS[dueFilter] ?? dueFilter}`} onClear={clearDue} />}
        {stageFilter && <Chip label={`Stage: ${stageFilter}`} onClear={() => onStageChange(null)} />}

        {anyActive && (
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-foreground underline decoration-dotted"
          >
            Clear all
          </button>
        )}

        {/* Search stays inline — it's the most-used control. */}
        <input
          id="board-search"
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Project or client…  ( / )"
          className={`${SELECT_CLASSES} placeholder:text-muted-foreground w-44`}
        />
      </div>
      {showNewClient && <NewClientModal onClose={() => setShowNewClient(false)} />}
    </>
  )
}

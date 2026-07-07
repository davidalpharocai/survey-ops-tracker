'use client'
import { useState } from 'react'
import { STAGE_ORDER } from '@/lib/utils/stage'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useClients } from '@/lib/hooks/useClients'
import { NewClientModal } from '@/components/client/NewClientModal'

const NEW_CLIENT_VALUE = '__new__'

const SELECT_CLASSES =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring'

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

  return (
    <>
    <div className="flex items-end gap-3 flex-wrap">
      <Field label="Captain" tooltip="Show only projects led by this captain — the team member responsible end-to-end.">
        <select
          value={captainFilter ?? ''}
          onChange={e => onCaptainChange(e.target.value || null)}
          className={SELECT_CLASSES}
        >
          <option value="">All Captains</option>
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
          className={SELECT_CLASSES}
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
          className={SELECT_CLASSES}
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
          className={SELECT_CLASSES}
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
        <>
          <Field label="From">
            <input
              type="date"
              value={dueFrom ?? ''}
              onChange={e => onDueFromChange(e.target.value || null)}
              className={SELECT_CLASSES}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={dueTo ?? ''}
              onChange={e => onDueToChange(e.target.value || null)}
              className={SELECT_CLASSES}
            />
          </Field>
        </>
      )}
      <Field label="Stage" tooltip="Filter by pipeline stage, from Submitted through Delivery (or Closed).">
        <select
          value={stageFilter ?? ''}
          onChange={e => onStageChange(e.target.value || null)}
          className={SELECT_CLASSES}
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
      <Field label="Search" tooltip="Match against project or client name.">
        <input
          id="board-search"
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Project or client…  ( / )"
          className={`${SELECT_CLASSES} placeholder:text-muted-foreground w-44`}
        />
      </Field>
    </div>
    {showNewClient && <NewClientModal onClose={() => setShowNewClient(false)} />}
    </>
  )
}

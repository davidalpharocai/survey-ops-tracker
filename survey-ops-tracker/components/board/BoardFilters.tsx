'use client'
import { STAGE_ORDER } from '@/lib/utils/stage'

const SELECT_CLASSES =
  'bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
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
  stageFilter: string | null
  search: string
  onCaptainChange: (id: string | null) => void
  onTypeChange: (type: string | null) => void
  onDueChange: (due: string | null) => void
  onStageChange: (stage: string | null) => void
  onSearchChange: (q: string) => void
}

export function BoardFilters({
  captains,
  captainFilter,
  currentMemberId = null,
  typeFilter,
  dueFilter,
  stageFilter,
  search,
  onCaptainChange,
  onTypeChange,
  onDueChange,
  onStageChange,
  onSearchChange,
}: BoardFiltersProps) {
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <Field label="Captain">
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
      <Field label="Type">
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
      <Field label="Due">
        <select
          value={dueFilter ?? ''}
          onChange={e => onDueChange(e.target.value || null)}
          className={SELECT_CLASSES}
        >
          <option value="">Any time</option>
          <option value="overdue">Due today or overdue</option>
          <option value="tomorrow">Due tomorrow</option>
          <option value="twodays">Due in 2 days</option>
        </select>
      </Field>
      <Field label="Stage">
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
      <Field label="Search">
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Project or client…"
          className={`${SELECT_CLASSES} placeholder:text-muted-foreground w-44`}
        />
      </Field>
    </div>
  )
}

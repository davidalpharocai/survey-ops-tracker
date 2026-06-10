'use client'

interface BoardFiltersProps {
  captains: { id: string; name: string; initials: string }[]
  captainFilter: string | null
  currentMemberId?: string | null
  typeFilter: string | null
  overdueOnly: boolean
  onCaptainChange: (id: string | null) => void
  onTypeChange: (type: string | null) => void
  onOverdueOnly: (v: boolean) => void
}

export function BoardFilters({
  captains,
  captainFilter,
  currentMemberId = null,
  typeFilter,
  overdueOnly,
  onCaptainChange,
  onTypeChange,
  onOverdueOnly,
}: BoardFiltersProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={captainFilter ?? ''}
        onChange={e => onCaptainChange(e.target.value || null)}
        className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring"
      >
        <option value="">All Captains</option>
        {captains.map(c => (
          <option key={c.id} value={c.id}>
            {c.id === currentMemberId ? `${c.initials} (me)` : c.initials}
          </option>
        ))}
      </select>
      <select
        value={typeFilter ?? ''}
        onChange={e => onTypeChange(e.target.value || null)}
        className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring"
      >
        <option value="">All Types</option>
        <option value="PS">PS</option>
        <option value="B2B">B2B</option>
        <option value="Rerun">Rerun</option>
      </select>
      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={overdueOnly}
          onChange={e => onOverdueOnly(e.target.checked)}
          className="rounded"
        />
        Overdue only
      </label>
    </div>
  )
}

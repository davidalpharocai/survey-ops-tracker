'use client'

interface BoardFiltersProps {
  captains: { id: string; name: string; initials: string }[]
  captainFilter: string | null
  typeFilter: string | null
  overdueOnly: boolean
  onCaptainChange: (id: string | null) => void
  onTypeChange: (type: string | null) => void
  onOverdueOnly: (v: boolean) => void
}

export function BoardFilters({
  captains,
  captainFilter,
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
        className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500"
      >
        <option value="">All Captains</option>
        {captains.map(c => (
          <option key={c.id} value={c.id}>
            {c.initials}
          </option>
        ))}
      </select>
      <select
        value={typeFilter ?? ''}
        onChange={e => onTypeChange(e.target.value || null)}
        className="bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-slate-500"
      >
        <option value="">All Types</option>
        <option value="PS">PS</option>
        <option value="B2B">B2B</option>
        <option value="Rerun">Rerun</option>
      </select>
      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
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

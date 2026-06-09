'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'

interface BudgetWidgetProps {
  projectId: string
  budget: number | null
  actualSpend: number | null
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function EditableAmount({
  value,
  onSave,
  placeholder,
}: {
  value: number | null
  onSave: (v: number | null) => void
  placeholder: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEdit() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commitEdit() {
    const parsed = parseFloat(draft.replace(/[^0-9.]/g, ''))
    onSave(isNaN(parsed) ? null : parsed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={e => {
          if (e.key === 'Enter') commitEdit()
          if (e.key === 'Escape') setEditing(false)
        }}
        placeholder={placeholder}
        className="w-24 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-xs text-slate-100 focus:outline-none focus:border-blue-500 text-right"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="text-xs text-slate-200 hover:text-white hover:underline transition-colors cursor-pointer"
      title="Click to edit"
    >
      {formatCurrency(value)}
    </button>
  )
}

export function BudgetWidget({ projectId, budget, actualSpend }: BudgetWidgetProps) {
  const updateProject = useUpdateProject()

  function saveBudget(v: number | null) {
    updateProject.mutate({ id: projectId, updates: { budget: v } })
  }

  function saveActualSpend(v: number | null) {
    updateProject.mutate({ id: projectId, updates: { actual_spend: v } })
  }

  const hasBoth = budget != null && actualSpend != null
  const remaining = hasBoth ? budget - actualSpend : null
  const isOver = remaining != null && remaining < 0
  const pct = hasBoth && budget > 0 ? Math.min((actualSpend / budget) * 100, 100) : 0

  return (
    <div className="border-t border-slate-800 pt-3 mt-1">
      <p className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">Budget</p>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">Allocated</span>
          <EditableAmount value={budget} onSave={saveBudget} placeholder="e.g. 5000" />
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-slate-500">Actual Spend</span>
          <EditableAmount value={actualSpend} onSave={saveActualSpend} placeholder="e.g. 3200" />
        </div>
        {hasBoth && (
          <>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">
                {isOver ? '⚠ Over budget' : 'Remaining'}
              </span>
              <span className={`text-xs font-medium ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                {isOver ? '-' : ''}{formatCurrency(Math.abs(remaining!))}
              </span>
            </div>
          </>
        )}
        {!hasBoth && (
          <p className="text-xs text-slate-600">Click values above to enter budget</p>
        )}
      </div>
    </div>
  )
}

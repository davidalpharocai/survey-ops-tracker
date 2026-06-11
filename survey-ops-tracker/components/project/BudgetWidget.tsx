'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

interface BudgetWidgetProps {
  projectId: string
  budget: number | null
  actualSpend: number | null
  nTarget: number | null
  nCollected: number
  nActual: number | null
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function formatCostPerN(value: number | null): string {
  if (value == null) return '—'
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 2 })
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
        className="w-24 bg-muted border border-border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:border-blue-500 text-right"
      />
    )
  }

  return (
    <button
      onClick={startEdit}
      className="text-xs text-foreground hover:underline transition-colors cursor-pointer"
      title="Click to edit"
    >
      {formatCurrency(value)}
    </button>
  )
}

export function BudgetWidget({ projectId, budget, actualSpend, nTarget, nCollected, nActual }: BudgetWidgetProps) {
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

  // Cost per N: target = budget / N target; actual = spend / best-known N (N Actual once cleaned, else N Collected)
  const targetCostPerN = budget != null && nTarget != null && nTarget > 0 ? budget / nTarget : null
  const effectiveN = nActual ?? (nCollected > 0 ? nCollected : null)
  const actualCostPerN = actualSpend != null && effectiveN != null ? actualSpend / effectiveN : null
  const costPerNOver = targetCostPerN != null && actualCostPerN != null && actualCostPerN > targetCostPerN

  return (
    <div className="border-t border-border pt-3 mt-1">
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Budget
        <InfoTooltip text="Internal cost tracking for this project — not client-facing. Click a value to edit it." />
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground flex items-center">
            Allocated
            <InfoTooltip text="Budget allocated to this project." />
          </span>
          <EditableAmount value={budget} onSave={saveBudget} placeholder="e.g. 5000" />
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground flex items-center">
            Actual Spend
            <InfoTooltip text="What has actually been spent so far." />
          </span>
          <EditableAmount value={actualSpend} onSave={saveActualSpend} placeholder="e.g. 3200" />
        </div>
        {hasBoth && (
          <>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
              <div
                className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                {isOver ? '⚠ Over budget' : 'Remaining'}
                <InfoTooltip text="Allocated budget minus actual spend." />
              </span>
              <span className={`text-xs font-medium ${isOver ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {isOver ? '-' : ''}{formatCurrency(Math.abs(remaining!))}
              </span>
            </div>
          </>
        )}
        {!hasBoth && (
          <p className="text-xs text-muted-foreground/50">Click values above to enter budget</p>
        )}
        {(targetCostPerN != null || actualCostPerN != null) && (
          <div className="border-t border-border pt-2 mt-1 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                Target Cost / N
                <InfoTooltip text="Allocated budget ÷ N Target." />
              </span>
              <span className="text-xs text-foreground">{formatCostPerN(targetCostPerN)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                Actual Cost / N
                <InfoTooltip text="Actual spend ÷ N Actual (or N Collected until cleaning is done)." />
              </span>
              <span
                className={`text-xs font-medium ${
                  actualCostPerN == null
                    ? 'text-foreground'
                    : costPerNOver
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {formatCostPerN(actualCostPerN)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

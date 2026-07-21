'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useProjectBlasts } from '@/lib/hooks/useProjectBlasts'
import { totalBidDollars, costPerN } from '@/lib/utils/blast'

interface BudgetWidgetProps {
  projectId: string
  budget: number | null
  nCollected: number
}

function money(value: number | null): string {
  if (value == null) return '—'
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function rate(value: number | null): string {
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
        className="w-24 bg-muted border border-border rounded px-2 py-0.5 text-sm text-foreground focus:outline-none focus:border-blue-500 text-right"
      />
    )
  }
  return (
    <button onClick={startEdit} className="text-sm text-foreground hover:underline transition-colors cursor-pointer" title="Click to edit">
      {money(value)}
    </button>
  )
}

export function BudgetWidget({ projectId, budget, nCollected }: BudgetWidgetProps) {
  const updateProject = useUpdateProject()
  const { data: blasts, isError } = useProjectBlasts(projectId)

  const actual = blasts ? totalBidDollars(blasts) : null
  const cpn = actual != null ? costPerN(actual, nCollected) : null
  const hasBudget = budget != null && budget > 0
  const usedPct = hasBudget && actual != null ? Math.min((actual / budget) * 100, 100) : 0
  const remaining = hasBudget && actual != null ? budget - actual : null
  const over = remaining != null && remaining < 0

  function saveBudget(v: number | null) {
    updateProject.mutate({ id: projectId, updates: { budget: v } })
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
        Budgets
        <InfoTooltip text="Internal cost tracking for this project — not client-facing." />
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground flex items-center">
            Total budget
            <InfoTooltip text="The total $ allocated to this project — the max to spend, tracked by you & Shanu. A calculation is coming; typed in for now." />
          </span>
          <EditableAmount value={budget} onSave={saveBudget} placeholder="e.g. 6000" />
        </div>

        <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-2 font-medium">Spend</p>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground flex items-center">
            Actual $
            <InfoTooltip text="The sum of all blast totals below ($/bid × # of completes for each). Computed, not typed." />
          </span>
          <span className="text-sm font-medium text-foreground">{isError ? '—' : money(actual)}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground flex items-center">
            Total bid / N
            <InfoTooltip text="Actual $ ÷ N Collected — the all-in cost per completed response (includes blast fees)." />
          </span>
          <span className="text-sm text-foreground">{isError ? '—' : rate(cpn)}</span>
        </div>

        {isError && (
          <p className="text-xs text-muted-foreground/60">Spend appears once the latest database migration is applied.</p>
        )}

        {hasBudget && actual != null && (
          <>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
              <div
                className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : 'bg-emerald-400'}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center">
                {over ? '⚠ Over budget' : 'Budget used'}
                <InfoTooltip text="Actual $ ÷ Total budget. This is spend-vs-budget only — not full ROI until other cost lines are added." />
              </span>
              <span className={`text-sm font-medium ${over ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {Math.round(usedPct)}% · {over ? '-' : ''}{money(Math.abs(remaining!))} {over ? 'over' : 'left'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

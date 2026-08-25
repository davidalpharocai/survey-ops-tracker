'use client'
import { useState } from 'react'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { costPerN } from '@/lib/utils/blast'
import { CostLines } from './CostLines'
import { PricingWidget } from './PricingWidget'

interface BudgetWidgetProps {
  projectId: string
  budget: number | null
  nCollected: number
  /** Combined actual spend (blasts + PS suppliers + flat cost lines) — the DB
   *  source of truth, maintained by recompute_project_spend. */
  actualSpend: number | null
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

/**
 * The Money-section rollup: the flat vendor cost lines, the spend summary, the
 * budget ceiling, and the client-price/margin block.
 *
 * Split by who may see what. COST TO RUN is public — actual spend, cost per N and
 * the vendor cost lines show for everyone, because that is the number the team
 * needs to run the job. The BUDGET (a cost ceiling: the most we intend to spend)
 * and everything in PricingWidget (price per N, contract value, margin) are
 * restricted to holders of `view_financials`. The gate is soft: it hides, it does
 * not secure.
 */
export function BudgetWidget({ projectId, budget, nCollected, actualSpend }: BudgetWidgetProps) {
  const updateProject = useUpdateProject()
  // False until the capability check settles true, so a restricted figure can
  // never flash on screen while the answer is still in flight.
  const canViewFinancials = useCanViewFinancials()

  // actual_spend is trigger-maintained (Σ blast bid×completes + Σ supplier cpi×n_collected
  // + Σ flat cost lines), so this reconciles with the hero budget and the Insights
  // tab for every project type.
  const actual = actualSpend ?? 0
  const cpn = costPerN(actual, nCollected)
  const hasBudget = budget != null && budget > 0
  const usedPct = hasBudget && actual != null ? Math.min((actual / budget) * 100, 100) : 0
  const remaining = hasBudget && actual != null ? budget - actual : null
  const over = remaining != null && remaining < 0

  function saveBudget(v: number | null) {
    updateProject.mutate({ id: projectId, updates: { budget: v } })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Cost lines first — they belong with the supplier/blast inputs above,
          which already draw the hairline this block sits under, so CostLines
          renders none of its own. Public: this is cost to run. */}
      <CostLines projectId={projectId} />

      <div className="border-t border-border pt-3">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-medium flex items-center">
          {/* Without the budget row there is nothing to distinguish from spend, so
              the header says what is actually on screen. */}
          {canViewFinancials ? 'Budgets' : 'Spend'}
          <InfoTooltip text="Internal cost tracking for this project — not client-facing." />
        </p>
        <div className="flex flex-col gap-2">
          {canViewFinancials && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground flex items-center">
                  Total budget
                  <InfoTooltip text="The total $ allocated to this project — the max to spend, tracked by you & Shanu. This is a COST CEILING, not what the client pays: it is not expected to match the contract value below, and there is nothing wrong with the two differing. A calculation is coming; typed in for now." />
                </span>
                <EditableAmount value={budget} onSave={saveBudget} placeholder="e.g. 6000" />
              </div>
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest mt-2 font-medium">Spend</p>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground flex items-center">
              Actual $
              <InfoTooltip text="Actual spend to date — blasts ($/bid × completes), PS suppliers (CPI × N collected), and the flat vendor fees in Other costs. Computed, not typed." />
            </span>
            <span className="text-sm font-medium text-foreground">{money(actual)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground flex items-center">
              Cost / N
              <InfoTooltip text="Actual $ ÷ N Collected — the all-in cost per completed response." />
            </span>
            <span className="text-sm text-foreground">{rate(cpn)}</span>
          </div>

          {/* Budget-vs-spend is as restricted as the budget itself — the bar alone
              would leak the ceiling by showing what fraction of it is gone. */}
          {canViewFinancials && hasBudget && (
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
                  <InfoTooltip text="Actual $ ÷ Total budget. Spend against the ceiling only — for whether the job actually makes money, read Margin below." />
                </span>
                <span className={`text-sm font-medium ${over ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {Math.round(usedPct)}% · {over ? '-' : ''}{money(Math.abs(remaining!))} {over ? 'over' : 'left'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Revenue side. Self-gating on the same capability and self-fetching from
          the page's existing caches, so no restricted value is ever threaded
          through a prop that a public caller could render. */}
      <PricingWidget projectId={projectId} budget={budget} actualSpend={actualSpend} />
    </div>
  )
}

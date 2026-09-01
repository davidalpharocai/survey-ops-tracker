'use client'

import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Caret } from '@/components/shared/Caret'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { CalcMark } from './fields'
import { FieldCell, DateCell, TextCell, SelectCell, useSavedFlash } from './fields'
import {
  useProjectCosts,
  useAddCost,
  useUpdateCost,
  useDeleteCost,
  totalCostLines,
  costKindLabel,
  COST_KINDS,
  type ProjectCost,
} from '@/lib/hooks/useProjectCosts'

const TIP = {
  header:
    'FLAT vendor fees on this project — a fixed platform charge, or a bought contacts export (ZoomInfo, Apollo, …). Each is a dollar amount typed exactly as invoiced, and each counts toward the project’s actual spend. Two things must NOT go here, because the app already counts them and entering them again double-charges the project: respondent rewards ($/bid × completes on the blast) and the per-message send charge ($/send × # people on the blast).',
  kind:
    'SMS/Email Blast = a FIXED platform fee that does not scale with how many messages went out — a subscription slice, a setup charge. Do NOT use it for the per-message send cost: that is $/send × # people on the blast itself and is already in the project’s spend, so entering it here charges it twice (this happened on PR00362, to the tune of $1,876.70). Contacts Export = a purchased contact list, i.e. what it cost to ACQUIRE the contacts, as opposed to sending to them.',
  amount:
    'The flat fee in dollars, exactly as invoiced — cents included. There is no quantity × rate here: what you type is the number. Feeds the project’s actual spend.',
  date: 'When the fee was incurred — the invoice or send date. Informational; it does not affect the total.',
  description:
    'Optional note on what this fee was for — e.g. “Twilio send, 40k numbers” or “ZoomInfo pull, 3PL contacts”. Doesn’t affect the cost.',
  subtotal:
    'Σ of the flat vendor fees above. Already included in Actual $ — it is one of the three terms behind that number (blasts, suppliers, these).',
}

function money(v: number | null): string {
  if (v == null) return '—'
  // Cents shown here, unlike the whole-dollar rollups: these are invoiced
  // amounts and a fee really can be $249.99.
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Inline-editable dollar amount, composed on FieldCell so it looks identical to
 * the surrounding cells. NOT NumberCell: that routes through commitNumber, which
 * Math.rounds its input — fine for an N, silently destructive for a $249.99
 * invoice against a numeric(10,2) column.
 */
function MoneyCell({
  label,
  tooltip,
  value,
  onSave,
}: {
  label: string
  tooltip?: string
  value: number | null
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  function begin() {
    setDraft(value != null ? String(value) : '')
    setError(null)
    escaped.current = false
    setEditing(true)
  }

  function commit() {
    if (escaped.current) {
      escaped.current = false
      setError(null)
      setEditing(false)
      return
    }
    const raw = draft.trim().replace(/[$,]/g, '')
    if (raw === '') {
      onSave(null)
    } else {
      const n = parseFloat(raw)
      if (Number.isNaN(n)) {
        // Unparseable — keep the editor open and leave the stored value alone.
        setError('Not an amount')
        return
      }
      onSave(n)
    }
    flash()
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder="e.g. 250 or 249.99"
          aria-invalid={error != null}
          onChange={e => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              escaped.current = true
              e.currentTarget.blur()
            }
          }}
          className={cn(
            'w-full rounded border bg-muted px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
            error ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-ring',
          )}
        />
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </FieldCell>
    )
  }

  return (
    <FieldCell label={label} tooltip={tooltip} editable onEdit={begin} saved={saved}>
      {value == null ? (
        <span className="text-muted-foreground/50">— set</span>
      ) : (
        <span className="tabular-nums">{money(value)}</span>
      )}
    </FieldCell>
  )
}

/**
 * The flat vendor cost lines in the Money section. PUBLIC — this is cost to run,
 * which everyone sees; only the revenue side (price, contract value, margin) and
 * the budget ceiling are capability-gated.
 *
 * Modelled on `BlastBlocks`: a collapsible subheader with a right-aligned
 * "+ Add cost", one inset block per line with every field click-to-edit through
 * the cost hooks, and a ✕ remove with a session-level Undo bar. Writes go
 * straight to project_costs from the browser (no RPC), exactly like the blast
 * hooks; the 080 trigger recomputes `actual_spend`.
 *
 * Renders no top hairline of its own — the caller (BudgetWidget) already draws
 * one directly above, and a second would double up.
 */
export function CostLines({ projectId }: { projectId: string }) {
  const supabase = createClient()
  const { data: costs, isError } = useProjectCosts(projectId)
  const add = useAddCost(projectId)

  const { data: user } = useQuery({
    queryKey: ['auth-user'],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: Infinity,
  })
  const userName = user?.email?.split('@')[0] ?? 'Unknown'

  const [expanded, setExpanded] = useState(true)
  // Session-level Undo: the last-removed line's payload. Cleared when re-added
  // or replaced by a newer removal.
  const [undo, setUndo] = useState<ProjectCost | null>(null)

  if (isError) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Other costs</p>
        <p className="text-xs text-muted-foreground/70">Cost lines need the latest database migration.</p>
      </div>
    )
  }

  const list = costs ?? []
  const count = list.length
  const subtotal = totalCostLines(list)

  // The per-block ✕ deletes via its own useDeleteCost; here we just stash the
  // removed line so the Undo bar can re-add it.
  function handleRemove(cost: ProjectCost) {
    setUndo(cost)
  }

  function handleUndo() {
    if (!undo) return
    add.mutate(
      {
        kind: undo.kind,
        amount: undo.amount,
        description: undo.description,
        incurred_on: undo.incurred_on,
        created_by: undo.created_by ?? userName,
      },
      { onSuccess: () => setUndo(null) },
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center">
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <Caret open={expanded} className="text-primary" />
            Other costs · {count}
          </button>
          <InfoTooltip text={TIP.header} />
        </span>
        <button
          onClick={() =>
            // Defaults to the send fee — the far more common of the two — with
            // today's date, so the only thing left to type is the amount.
            add.mutate({
              kind: 'sms_email_blast',
              amount: 0,
              description: '',
              incurred_on: new Date().toISOString().slice(0, 10),
              created_by: userName,
            })
          }
          disabled={add.isPending}
          className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          {add.isPending ? 'Adding…' : '+ Add cost'}
        </button>
      </div>

      {undo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          <span>
            Removed {costKindLabel(undo.kind)} {money(undo.amount)}.
          </span>
          <button onClick={handleUndo} className="shrink-0 font-medium text-foreground/80 hover:text-foreground">
            ↩ Undo
          </button>
        </div>
      )}

      {expanded && (
        <div className="flex flex-col gap-2">
          {list.map((c, i) => (
            <CostBlock key={c.id} cost={c} index={i} onRemove={handleRemove} />
          ))}
          {count === 0 && (
            <p className="text-xs text-muted-foreground/60">
              No vendor fees logged yet — use + Add cost for a send fee or a contacts export.
            </p>
          )}
        </div>
      )}

      {count > 0 && (
        <div className="mt-1.5 flex items-center justify-between">
          <span className="flex items-center text-xs text-muted-foreground">
            Other costs total
            <InfoTooltip text={TIP.subtotal} />
            <CalcMark from="the sum of the cost lines above" />
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">{money(subtotal)}</span>
        </div>
      )}
    </div>
  )
}

/** One editable cost line: kind, amount, date incurred, description — each cell
 *  writes through useUpdateCost. The ✕ hands the whole row up for session-level
 *  Undo and deletes it. */
function CostBlock({
  cost,
  index,
  onRemove,
}: {
  cost: ProjectCost
  index: number
  onRemove: (c: ProjectCost) => void
}) {
  const update = useUpdateCost(cost.project_id)
  const del = useDeleteCost(cost.project_id)
  const save = (updates: Partial<ProjectCost>) => update.mutate({ id: cost.id, updates })

  function remove() {
    onRemove(cost)
    del.mutate(cost.id)
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-2.5">
      <div className="mb-0.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Cost {index + 1}
        </span>
        <button
          onClick={remove}
          title="Remove cost line"
          className="shrink-0 text-sm text-muted-foreground/50 transition-colors hover:text-red-600 dark:hover:text-red-400"
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <SelectCell
          label="Kind"
          tooltip={TIP.kind}
          value={cost.kind}
          options={COST_KINDS.map(k => ({ value: k.value, label: k.label }))}
          onSave={v => save({ kind: v })}
        />
        <MoneyCell
          label="Amount (flat fee)"
          tooltip={TIP.amount}
          value={cost.amount}
          onSave={v => save({ amount: v ?? 0 })}
        />
        <DateCell
          label="Incurred"
          tooltip={TIP.date}
          mode="date"
          value={cost.incurred_on}
          onSave={iso => save({ incurred_on: iso })}
        />
        <div className="sm:col-span-2">
          <TextCell
            label="Description"
            tooltip={TIP.description}
            value={cost.description}
            placeholder="e.g. Twilio send, 40k numbers"
            onSave={v => save({ description: v || null })}
          />
        </div>
      </div>
    </div>
  )
}

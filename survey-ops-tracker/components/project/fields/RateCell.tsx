'use client'

import { useState } from 'react'
import { FieldCell, useSavedFlash } from './FieldCell'

export interface RateCellProps {
  label: string
  tooltip?: string
  /** Dollars, to the cent. Null renders as "— set" and means not recorded. */
  value: number | null
  onSave: (v: number | null) => void
  placeholder?: string
  /** Decimal places to display. A $/send rate is 2 cents, so it needs 2+. */
  decimals?: number
}

/**
 * A field-grid cell for a MONEY RATE — a number that has cents.
 *
 * WHY THIS EXISTS RATHER THAN NumberCell, which looks identical and would have
 * been one line: NumberCell commits through `commitNumber`
 * (lib/utils/formula.ts:16), which is `Math.round(parseFloat(n))`. That is
 * correct for an N — you cannot collect 4.3 responses — and silently destructive
 * for a rate. **$0.02 saves as 0.**
 *
 * And it is worse than a bad first save. NumberCell seeds its draft from the
 * stored value and commits on blur, so OPENING the cell and clicking away —
 * changing nothing — rounds the stored rate to zero. Since migration 095 makes 0
 * a legitimate rate (an owned list that costs nothing to send to), nothing
 * downstream flags it: isSendCostUnknown returns false, the row renders "send
 * $0.00" as a fact, and the project's spend quietly drops by the whole send cost.
 * On PR00309 that is $1,915.76 deleted by a stray click.
 *
 * This codebase had already learned this twice and written it down both times —
 * CostLines' EditableAmount ("silently destructive for a $249.99 invoice") and
 * PricingWidget's EditableRate ("$3.50 would save as $4"). Both are local
 * components, so the lesson was not reusable and the third caller repeated the
 * bug. Hence a shared cell: the next person reaching for NumberCell for a rate
 * finds this beside it.
 *
 * Parsing is deliberately plain `parseFloat` with $ and commas stripped — NO
 * `=`-formula support, because evalSum also rounds.
 */
export function RateCell({
  label,
  tooltip,
  value,
  onSave,
  placeholder = 'e.g. 0.02',
  decimals = 2,
}: RateCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, flash] = useSavedFlash()

  function begin() {
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    const raw = draft.trim().replace(/[$,]/g, '')
    if (raw === '') {
      if (value != null) { onSave(null); flash() }
      setEditing(false)
      return
    }
    const parsed = parseFloat(raw)
    // Reject rather than coerce. A typo must come back to the person typing it;
    // silently writing 0 or null is how a rate disappears.
    if (Number.isNaN(parsed) || parsed < 0) { setEditing(false); return }
    if (parsed !== value) { onSave(parsed); flash() }
    setEditing(false)
  }

  return (
    <FieldCell label={label} tooltip={tooltip} editable editing={editing} onEdit={begin} saved={saved}>
      {editing ? (
        <input
          autoFocus
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          placeholder={placeholder}
          className="w-24 rounded border border-border bg-muted px-2 py-0.5 text-sm text-foreground focus:border-blue-500 focus:outline-none"
        />
      ) : value == null ? (
        <span className="text-muted-foreground/50">— set</span>
      ) : (
        <span className="tabular-nums">
          ${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 4) })}
        </span>
      )}
    </FieldCell>
  )
}

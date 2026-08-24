'use client'

import { useState } from 'react'
import { FieldCell, useSavedFlash } from './FieldCell'

export interface SelectCellProps {
  label: string
  tooltip?: string
  value: string
  options: { value: string; label: string }[]
  onSave: (v: string) => void
}

/**
 * Inline-editable single-select field. Click the value (or the pencil) to open
 * an inline <select>; commits on change and flashes "Saved ✓". Blur/Escape
 * closes without committing.
 *
 * A <select> whose value matches NO option falls back to displaying the first
 * option, so an unset field would open already sitting on that option — picking
 * it fired no change event and silently saved nothing (you had to pick a
 * different option, close, reopen, then pick the one you wanted). When the
 * current value matches nothing we therefore render an explicit empty
 * placeholder option and select it, so every real option is a real change.
 */
export function SelectCell({ label, tooltip, value, options, onSave }: SelectCellProps) {
  const [editing, setEditing] = useState(false)
  const [saved, flash] = useSavedFlash()

  const current = options.find(o => o.value === value)

  if (editing) {
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <select
          autoFocus
          value={current ? value : ''}
          onChange={e => {
            const next = e.target.value
            // The placeholder is a no-op, not a save of ''.
            if (!next) {
              setEditing(false)
              return
            }
            onSave(next)
            flash()
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full rounded border border-border bg-muted px-2 py-1 text-sm text-foreground focus:border-ring focus:outline-none"
        >
          {!current && (
            <option value="">— set —</option>
          )}
          {options.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldCell>
    )
  }

  return (
    <FieldCell
      label={label}
      tooltip={tooltip}
      editable
      onEdit={() => setEditing(true)}
      saved={saved}
    >
      {current ? (
        <span className="truncate">{current.label}</span>
      ) : (
        <span className="text-muted-foreground/50">— set</span>
      )}
    </FieldCell>
  )
}

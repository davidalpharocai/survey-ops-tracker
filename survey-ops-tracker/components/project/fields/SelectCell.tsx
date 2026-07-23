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
          value={value}
          onChange={e => {
            onSave(e.target.value)
            flash()
            setEditing(false)
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => {
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full rounded border border-border bg-muted px-2 py-1 text-sm text-foreground focus:border-ring focus:outline-none"
        >
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

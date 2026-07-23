'use client'

import { useRef, useState } from 'react'
import { commitNumber } from '@/lib/utils/formula'
import { FieldCell, useSavedFlash } from './FieldCell'

export interface NumberCellProps {
  label: string
  tooltip?: string
  value: number | null
  onSave: (n: number | null) => void
  placeholder?: string
  readOnly?: boolean
}

/**
 * Inline-editable numeric field. Accepts plain numbers, comma-grouped numbers,
 * and `=`-prefixed sums (e.g. `=4200+800`); the formula/comma handling is
 * resolved internally via commitNumber so consumers receive a ready-to-write
 * number (or null when cleared). Commits on blur and Enter, cancels on Escape.
 */
export function NumberCell({
  label,
  tooltip,
  value,
  onSave,
  placeholder = 'e.g. 4200 or =4200+800',
  readOnly = false,
}: NumberCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  function begin() {
    if (readOnly) return
    setDraft(value != null ? String(value) : '')
    setEditing(true)
  }

  function commit() {
    if (escaped.current) {
      escaped.current = false
      setEditing(false)
      return
    }
    const s = commitNumber(draft)
    if (s === '—') {
      onSave(null)
    } else {
      const n = parseFloat(s.replace(/,/g, ''))
      if (Number.isNaN(n)) {
        // Unparseable garbage — leave the stored value untouched.
        setEditing(false)
        return
      }
      onSave(n)
    }
    flash()
    setEditing(false)
  }

  if (editing) {
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={draft}
          placeholder={placeholder}
          onChange={e => setDraft(e.target.value)}
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
          className="w-full rounded border border-border bg-muted px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
      </FieldCell>
    )
  }

  return (
    <FieldCell
      label={label}
      tooltip={tooltip}
      editable={!readOnly}
      onEdit={begin}
      saved={saved}
    >
      {value == null ? (
        <span className="text-muted-foreground/50">{readOnly ? '—' : '— set'}</span>
      ) : (
        <span className="truncate">{value.toLocaleString()}</span>
      )}
    </FieldCell>
  )
}

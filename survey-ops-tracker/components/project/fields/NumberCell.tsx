'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
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
  const [error, setError] = useState<string | null>(null)
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  function begin() {
    if (readOnly) return
    setDraft(value != null ? String(value) : '')
    setError(null)
    setEditing(true)
  }

  function commit() {
    if (escaped.current) {
      escaped.current = false
      setError(null)
      setEditing(false)
      return
    }
    const s = commitNumber(draft)
    if (s === '—') {
      onSave(null)
    } else {
      const n = parseFloat(s.replace(/,/g, ''))
      if (Number.isNaN(n)) {
        // Unparseable garbage — keep the editor open, surface the hint, and
        // leave the stored value untouched.
        setError('Not a number')
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
          inputMode="numeric"
          value={draft}
          placeholder={placeholder}
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

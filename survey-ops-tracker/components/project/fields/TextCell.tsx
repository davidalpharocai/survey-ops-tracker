'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { FieldCell, useSavedFlash } from './FieldCell'
import { CopyableText } from '@/components/shared/CopyableText'

export interface TextCellProps {
  label: string
  tooltip?: string
  value: string | null
  onSave: (v: string) => void
  placeholder?: string
  /** Hide the pencil and disable editing; the value is shown read-only. */
  readOnly?: boolean
  /** Render the display value in the warning color. */
  warn?: boolean
  /** Appended after the display value, e.g. " · overdue". */
  suffix?: string
  /** Render the value as a text-primary link (following it calls onClickValue). */
  isLink?: boolean
  onClickValue?: () => void
  /** Show the value with a hover tooltip (full text) + one-click copy — for long
   *  identifiers like Survey IDs that get cut off. Editing moves to the pencil. */
  copyable?: boolean
}

/**
 * Inline-editable single-line text field. Click the value (or the pencil) to
 * edit; commits on blur and Enter, cancels on Escape, then flashes "Saved ✓".
 */
export function TextCell({
  label,
  tooltip,
  value,
  onSave,
  placeholder,
  readOnly = false,
  warn = false,
  suffix,
  isLink = false,
  onClickValue,
  copyable = false,
}: TextCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  function begin() {
    if (readOnly) return
    setDraft(value ?? '')
    setEditing(true)
  }

  function commit() {
    if (escaped.current) {
      escaped.current = false
      setEditing(false)
      return
    }
    onSave(draft.trim())
    flash()
    setEditing(false)
  }

  if (editing) {
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <input
          autoFocus
          type="text"
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

  const hasValue = value != null && value !== ''
  let display
  if (!hasValue) {
    display = (
      <span className="text-muted-foreground/50">{readOnly ? '—' : '— set'}</span>
    )
  } else if (isLink) {
    display = (
      <button
        type="button"
        onClick={onClickValue}
        className="truncate text-left text-primary hover:underline"
      >
        {value}
        {suffix}
      </button>
    )
  } else if (copyable) {
    // Full value on hover + one-click copy; edit via the pencil (FieldCell skips
    // its click-to-edit wrap when valueInteractive, so no nested buttons).
    display = (
      <CopyableText
        value={value}
        className={cn('text-[14.3px]', warn && 'text-amber-600 dark:text-amber-400')}
      />
    )
  } else {
    display = (
      // title = the full value, so a cut-off value is always readable on hover.
      <span className={cn('truncate', warn && 'text-amber-600 dark:text-amber-400')} title={value ?? undefined}>
        {value}
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
    )
  }

  return (
    <FieldCell
      label={label}
      tooltip={tooltip}
      editable={!readOnly}
      valueInteractive={isLink || (copyable && hasValue)}
      onEdit={begin}
      saved={saved}
    >
      {display}
    </FieldCell>
  )
}

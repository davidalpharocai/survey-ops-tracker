'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  formatDate,
  formatDateTime,
  fromISODate,
  parseDateInput,
  parseDateTimeInput,
  toISODate,
  toISODateTime,
  type YMDT,
} from '@/lib/utils/dateInput'
import { FieldCell, useSavedFlash } from './FieldCell'

export interface DateCellProps {
  label: string
  tooltip?: string
  /** ISO value: 'YYYY-MM-DD' for date mode, full ISO ('YYYY-MM-DDTHH:MM') for datetime. */
  value: string | null
  mode?: 'date' | 'datetime'
  onSave: (iso: string | null) => void
  /** Render the display value in the warning color. */
  warn?: boolean
  /** Appended after the display value, e.g. " · overdue". */
  suffix?: string
}

function parseISODateTime(iso: string): YMDT | null {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/)
  if (!m) return null
  return {
    y: +m[1],
    m: +m[2],
    d: +m[3],
    hh: m[4] ? +m[4] : 0,
    mm: m[5] ? +m[5] : 0,
    hasTime: !!m[4],
  }
}

/** ISO value -> human display string ('—' when empty/invalid). */
function displayFor(value: string | null, mode: 'date' | 'datetime'): string {
  if (!value) return '—'
  if (mode === 'datetime') {
    const p = parseISODateTime(value)
    return p ? formatDateTime(p) : '—'
  }
  const ymd = fromISODate(value.slice(0, 10))
  return ymd ? formatDate(ymd) : '—'
}

/** ISO value -> pre-filled editable text ('' when empty). */
function editableFor(value: string | null, mode: 'date' | 'datetime'): string {
  const d = displayFor(value, mode)
  return d === '—' ? '' : d
}

/**
 * Inline-editable date (or datetime) field. Type a date (`M/D/YYYY` or
 * `Mon D, YYYY`, plus a time in datetime mode) — invalid input shows an inline
 * error and does NOT commit — or use the calendar button's native picker.
 * Commits on blur and Enter, cancels on Escape. Emits an ISO string, or null
 * when cleared.
 */
export function DateCell({
  label,
  tooltip,
  value,
  mode = 'date',
  onSave,
  warn = false,
  suffix,
}: DateCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, flash] = useSavedFlash()
  const escaped = useRef(false)

  function begin() {
    setDraft(editableFor(value, mode))
    setError(null)
    setEditing(true)
  }

  function finish(iso: string | null) {
    onSave(iso)
    flash()
    setError(null)
    setEditing(false)
  }

  function commitText() {
    if (escaped.current) {
      escaped.current = false
      setError(null)
      setEditing(false)
      return
    }
    const raw = draft.trim()
    if (raw === '') {
      finish(null)
      return
    }
    const parsed = mode === 'datetime' ? parseDateTimeInput(raw) : parseDateInput(raw)
    if (!parsed) {
      // Invalid — keep the editor open and surface the error; do not commit.
      setError('Not a real date')
      return
    }
    finish(mode === 'datetime' ? toISODateTime(raw) : toISODate(raw))
  }

  function commitNative(v: string) {
    finish(v === '' ? null : v)
  }

  if (editing) {
    const nativeValue = mode === 'datetime' ? (value ?? '').slice(0, 16) : (value ?? '').slice(0, 10)
    return (
      <FieldCell label={label} tooltip={tooltip} editing saved={saved}>
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={draft}
            placeholder={mode === 'datetime' ? 'e.g. Jul 6, 2026 2:00pm' : 'e.g. 7/6/2026'}
            aria-invalid={error != null}
            onChange={e => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            onBlur={commitText}
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
              'min-w-0 flex-1 rounded border bg-muted px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
              error ? 'border-red-500 focus:border-red-500' : 'border-border focus:border-ring',
            )}
          />
          <span className="relative inline-flex shrink-0">
            <button
              type="button"
              title="Pick from calendar"
              aria-label="Pick from calendar"
              className="rounded border border-border bg-muted px-1.5 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              📅
            </button>
            <input
              type={mode === 'datetime' ? 'datetime-local' : 'date'}
              value={nativeValue}
              tabIndex={-1}
              aria-hidden
              onMouseDown={e => {
                const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
                el.showPicker?.()
              }}
              onChange={e => commitNative(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </span>
        </div>
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </FieldCell>
    )
  }

  const display = displayFor(value, mode)
  const hasValue = display !== '—'

  return (
    <FieldCell label={label} tooltip={tooltip} editable onEdit={begin} saved={saved}>
      {hasValue ? (
        <span className={cn('truncate', warn && 'text-amber-600 dark:text-amber-400')}>
          {display}
          {suffix && <span className="text-muted-foreground">{suffix}</span>}
        </span>
      ) : (
        <span className="text-muted-foreground/50">— set</span>
      )}
    </FieldCell>
  )
}

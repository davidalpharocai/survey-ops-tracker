'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { CalcMark } from './CalcMark'
import { cn } from '@/lib/utils'

/**
 * Brief "Saved ✓" flash for inline-edit cells. Mirrors the toast wording the
 * app uses on mutation success ("Saved ✓"), but inline and self-clearing so the
 * presentational cells stay free of any mutation/toast dependency.
 */
export function useSavedFlash(ms = 1200): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const flash = useCallback(() => {
    setSaved(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSaved(false), ms)
  }, [ms])
  return [saved, flash]
}

export interface FieldCellProps {
  /** Uppercase field label. */
  label: string
  /** Optional (i) explainer next to the label. */
  tooltip?: string
  /** Whether the field can be edited — controls the hover-reveal pencil and click-to-edit. */
  editable?: boolean
  /** True while the inline editor is open — suppresses the pencil/click-to-edit and renders {children} as the editor. */
  editing?: boolean
  /** Begin editing — fired by the pencil and (unless valueInteractive) by clicking the value. */
  onEdit?: () => void
  /** Briefly flash "Saved ✓" beside the label. */
  saved?: boolean
  /**
   * Set when the value slot renders its own interactive element (e.g. a link):
   * the cell then must NOT wrap it in a click-to-edit button (nested buttons are
   * invalid HTML). The hover-reveal pencil still edits.
   */
  valueInteractive?: boolean
  /**
   * Mark this row as a CALCULATED figure — renders the `=` marker beside the
   * label. Pass the formula as a string to spell it out in the marker's tooltip
   * (e.g. "$/bid × completes").
   *
   * Explicit rather than inferred from `!editable`, on purpose. Not every
   * read-only cell is a calculation: some are read-only because of who is
   * signed in, or because the value is owned elsewhere. Labelling those "=" would
   * be a confident lie, and a wrong explanation is worse than none — which is the
   * whole reason this marker exists (the old Audience Size tooltip described the
   * wrong quantity for a year).
   */
  computed?: boolean | string
  /** The value slot: the display node, or the editor when `editing`. */
  children: ReactNode
}

/**
 * Base field-grid row: an uppercase label (+ optional InfoTooltip) stacked over
 * a value slot, with a hover-reveal pencil and subtle hover background when
 * editable, closed by a bottom hairline. The specialized cells (Text/Number/
 * Date/Select) compose this — they own their editing state and editor markup
 * and hand FieldCell either the display node or the editor via {children}.
 */
export function FieldCell({
  label,
  tooltip,
  editable = false,
  editing = false,
  onEdit,
  saved = false,
  valueInteractive = false,
  computed = false,
  children,
}: FieldCellProps) {
  const canEdit = editable && !editing
  const wrapValue = canEdit && !valueInteractive

  return (
    <div
      className={cn(
        'group relative border-b border-border/60 px-1.5 py-1.5 -mx-1.5 transition-colors',
        canEdit && 'hover:bg-muted/40',
      )}
    >
      <div className="flex items-center gap-1 text-[12px] uppercase tracking-wide text-muted-foreground">
        <span className="truncate">{label}</span>
        {tooltip && <InfoTooltip text={tooltip} />}
        {computed && <CalcMark from={typeof computed === 'string' ? computed : undefined} />}
        {saved && (
          <span
            aria-live="polite"
            className="ml-1 normal-case tracking-normal text-emerald-600 dark:text-emerald-400"
          >
            Saved ✓
          </span>
        )}
      </div>

      {wrapValue ? (
        <button
          type="button"
          onClick={onEdit}
          title="Click to edit"
          className="mt-0.5 flex w-full items-center text-left text-[14.3px] text-foreground cursor-pointer"
        >
          <span className="min-w-0 flex-1 truncate">{children}</span>
        </button>
      ) : (
        <div className="mt-0.5 text-[14.3px] text-foreground">{children}</div>
      )}

      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          title="Edit"
          /* THE PENCIL IS ONLY ALLOWED TO HIDE WHEN IT IS REDUNDANT.
             Normally clicking the value edits too, so a hover-reveal pencil is a
             second way into the same thing and hiding it costs nothing. But when
             valueInteractive is set, the value click is taken — a Survey ID copies,
             a link navigates — and the pencil becomes the ONLY way to edit. Hidden
             until hover, at text-xs, in a corner, that is indistinguishable from a
             read-only field: David could not edit the Survey IDs on PR00426 and
             reasonably concluded the field was broken.
             Worse, it was inconsistent with itself — `valueInteractive` is
             `copyable && hasValue`, so the same field was click-to-edit while empty
             and click-to-copy once filled. */
          className={cn(
            'absolute right-1 top-1.5 text-xs leading-none transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100',
            valueInteractive
              ? 'text-foreground/70 opacity-100'
              : 'text-muted-foreground opacity-0',
          )}
        >
          ✎
        </button>
      )}
    </div>
  )
}

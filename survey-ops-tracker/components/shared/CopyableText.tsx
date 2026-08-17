'use client'
import { useState } from 'react'

/**
 * A (possibly long) DATA VALUE shown truncated, but never lost: the FULL value
 * is on hover (native title tooltip) AND one click away from the clipboard.
 * A small ⧉ appears on hover; clicking it copies the value and flashes a ✓.
 * Keeps the tidy truncated layout (no wrapping, no layout shift).
 *
 * Use anywhere a saved value can get cut off — survey IDs, project codes/names,
 * client names, URLs, emails, notes. Put it in a width-constrained parent (a
 * table cell, a flex row with min-w-0) so the truncation has something to clip
 * against; with no width limit it simply shows the full value + the copy icon.
 */
export function CopyableText({
  value,
  className = '',
  mono = false,
  title,
  empty = '—',
}: {
  value: string | null | undefined
  /** Applied to the wrapper (e.g. text size/color, max-w-…). */
  className?: string
  /** Monospace the value (survey IDs / codes read better mono). */
  mono?: boolean
  /** Override the hover tooltip text (defaults to the value itself). */
  title?: string
  /** Rendered when there's no value. */
  empty?: string
}) {
  const [copied, setCopied] = useState(false)
  const text = (value ?? '').toString()
  if (!text) return <span className={`text-muted-foreground/50 ${className}`}>{empty}</span>

  async function copy(e: React.MouseEvent) {
    // Don't let the click bubble into a row/card that navigates or edits.
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* clipboard blocked (rare) — the hover tooltip + select-to-copy still work */
    }
  }

  return (
    <span className={`group/copy inline-flex items-center gap-1 min-w-0 max-w-full ${className}`}>
      <span className={`truncate ${mono ? 'font-mono' : ''}`} title={title ?? text}>
        {text}
      </span>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : `Copy: ${text}`}
        className={`shrink-0 leading-none text-xs transition-opacity focus:opacity-100 focus:outline-none ${
          copied
            ? 'opacity-100 text-emerald-600 dark:text-emerald-400'
            : 'opacity-0 group-hover/copy:opacity-100 text-muted-foreground/60 hover:text-foreground'
        }`}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  )
}

'use client'

import { useId, useRef } from 'react'
import { GLOSSARY } from './glossary'
import { useModalDialog } from './useModalDialog'

/**
 * "How to read this": the ten terms the finance page uses, one sentence each,
 * in a drawer beside the page so a reader can keep the figure they were
 * puzzling over in view. A modal dialog: focus moves in, Tab stays inside,
 * Escape closes and hands focus back to the button that opened it.
 */
export function GlossaryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const ref = useModalDialog(open, onClose, { initialFocus: closeRef })
  const titleId = useId()
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-card shadow-2xl outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[440px] sm:border-l sm:border-border"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-foreground">How to read this page</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The words the finance page uses, one sentence each. Every figure is a floor: a study with nothing logged adds $0.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the glossary"
            className="shrink-0 rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--chart-price)]"
          >
            ✕
          </button>
        </header>
        <dl className="min-h-0 flex-1 divide-y divide-border/60 overflow-auto px-4">
          {GLOSSARY.map(t => (
            <div key={t.id} id={`term-${t.id}`} className="py-2.5">
              <dt className="text-[13px] font-semibold text-foreground">{t.term}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{t.text}</dd>
            </div>
          ))}
        </dl>
        <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Esc closes.</footer>
      </div>
    </>
  )
}

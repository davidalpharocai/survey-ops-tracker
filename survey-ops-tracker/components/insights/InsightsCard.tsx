'use client'

import type { ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'

/**
 * The card frame every Insights section sits in: a title with its (i), the
 * scope chip (which surveys the card counts, so a number is never read as
 * being about more than it is), the body, and a computed closing sentence.
 * The same shape as the finance cards, without any of their money plumbing.
 */
export function InsightsCard({
  id, title, help, scope, verdict, actions, children, className = '',
}: {
  id?: string
  title: string
  /** One or two plain sentences for the (i). */
  help: string
  /** Which surveys the card counts, e.g. "Delivered · 1–27 Sep 2026 · 46 surveys". */
  scope?: string
  /** The computed closing sentence. */
  verdict?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {title}
          <InfoTooltip text={help} />
        </h2>
        {scope && (
          <span
            className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
            title="Which studies this card counts"
          >
            {scope}
          </span>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 py-3">{children}</div>
      {verdict && (
        <p className="border-t border-border px-4 py-2 text-[13px] text-foreground/90">{verdict}</p>
      )}
    </section>
  )
}

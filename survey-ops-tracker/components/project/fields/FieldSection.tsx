'use client'

import type { ReactNode } from 'react'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { cn } from '@/lib/utils'

export interface FieldSectionProps {
  title: string
  tooltip?: string
  /** Trims the top padding so the first section top-aligns with the rail. */
  first?: boolean
  children: ReactNode
}

/**
 * A titled block of field cells: an uppercase, tracking-wide section header
 * (with an optional InfoTooltip) over a responsive two-column grid that wraps
 * the cells.
 */
export function FieldSection({ title, tooltip, first = false, children }: FieldSectionProps) {
  return (
    <section className={cn(first ? 'pt-0' : 'pt-5')}>
      <h3 className="mb-2.5 flex items-center border-b border-border pb-1.5 text-[12px] font-bold uppercase tracking-wider text-foreground">
        {title}
        {tooltip && <InfoTooltip text={tooltip} />}
      </h3>
      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">{children}</div>
    </section>
  )
}

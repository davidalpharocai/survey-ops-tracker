'use client'

import type { ReactNode } from 'react'

/**
 * A count inside a sentence ("9 on hold") that opens the surveys behind it,
 * where a big tile button would be too loud. A real <button>, so it is
 * reachable by keyboard; the dotted underline says it can be clicked. Never
 * put one inside another button.
 */
export function OpenCount({ children, onOpen, title }: { children: ReactNode; onOpen: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="rounded-sm font-medium text-foreground/80 underline decoration-dotted underline-offset-2 hover:text-foreground hover:decoration-solid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

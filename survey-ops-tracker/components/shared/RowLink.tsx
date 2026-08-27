'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'

interface RowLinkProps {
  /** Where the row goes. A real URL — this renders a real <a href>. */
  href: string
  children: ReactNode
  /** Extra classes. Deliberately appended last so a caller can win. */
  className?: string
  title?: string
}

/**
 * The anchor half of a click-anywhere row.
 *
 * Table rows in the tracker navigate from an `onClick` on the `<tr>`. That is
 * convenient, but it is not a link: no "Open in new tab", no middle-click, no
 * cmd/ctrl-click, no URL in the status bar, no keyboard focus, and a screen
 * reader never announces it. Dropping a real `<a href>` into the row's primary
 * cell restores all of that while the row keeps its whole-row click.
 *
 * Two details carry the whole thing:
 *
 *  - `stopPropagation` so a plain left-click navigates ONCE (via the anchor)
 *    instead of also firing the row's handler. It only stops React's bubbling —
 *    the anchor's own default is untouched, so cmd/ctrl-click, middle-click and
 *    "Open in new tab" all still open a new tab.
 *  - no colour or decoration of its own. Tailwind's preflight already resets
 *    `a { color: inherit; text-decoration: inherit }`, so this renders
 *    pixel-identically to the plain text it replaced — no stray blue, no
 *    underline. The only added paint is a keyboard focus ring, which replaces
 *    the ring the row used to draw when it was a fake `role="button"`.
 */
export function RowLink({ href, children, className = '', title }: RowLinkProps) {
  return (
    <Link
      href={href}
      title={title}
      onClick={e => e.stopPropagation()}
      className={`rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {children}
    </Link>
  )
}

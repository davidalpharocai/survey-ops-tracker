'use client'

import { useEffect, useState } from 'react'

/**
 * When the numbers on screen were read from the database.
 *
 * David, 2026-09-23, after a survey read 7 in the tracker and something older to
 * a salesperson: "this cant happen again so make sure its patched."
 *
 * SalesLiveRefresh is the patch; this is the proof. A page that refreshes itself
 * is still a page you have to TRUST, and the one thing a stale screen cannot do
 * is admit it is stale. This carries the server's own render time, so if the
 * refresh ever stops working the label stops advancing and says so plainly
 * instead of leaving a wrong number looking authoritative.
 *
 * ── WHY IT RENDERS NOTHING ON THE SERVER ────────────────────────────────────
 * Formatting a time server-side then again on the client is a hydration
 * mismatch: the server has no timezone and would print UTC, the browser prints
 * local. Rendering only after mount means one formatting, in the reader's own
 * clock, and no mismatch to suppress.
 */
export function AsOf({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const d = new Date(iso)
    setLabel(Number.isNaN(d.getTime())
      ? null
      : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
  }, [iso])

  if (!label) return null
  return (
    <span
      className="hidden shrink-0 text-[11px] text-muted-foreground/70 lg:inline"
      title="When this page last read the database. It refreshes when you come back to the tab, and once a minute while you are looking at it."
    >
      as of {label}
    </span>
  )
}

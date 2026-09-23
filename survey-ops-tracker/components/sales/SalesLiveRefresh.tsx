'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps the sales tier current, since realtime cannot.
 *
 * David, 2026-09-23: "the two sides of SOCC (sales and non-sales view) need to
 * communicate in real time ... PR00383 N collected is 7 on non-sales view side,
 * but showing as 6 to alex."
 *
 * ── WHY NOT JUST MOUNT RealtimeSync HERE ────────────────────────────────────
 * Because it would subscribe cleanly and deliver nothing, which is worse than
 * not being there. Supabase's postgres_changes honours RLS, and migrations 102
 * and 105 deliberately dropped every base-table policy the sales tier had --
 * sales reaches survey_projects only through the sales_projects view. Measured
 * with two real sessions and one idempotent write: the analyst channel received
 * the event, the sales channel received zero, both having reported SUBSCRIBED.
 * The only way to make that subscription pay out would be to readmit sales to
 * the base table, which is the exact hole 105 was written to close.
 *
 * ── SO: REFRESH, NOT SUBSCRIBE ──────────────────────────────────────────────
 * The sales pages are server components that read their views on render, so the
 * fix is to render them again. router.refresh() re-runs the server render and
 * PRESERVES client React state, which is what makes this safe here: a
 * half-typed search box, a chosen account filter and a scroll position all
 * survive it.
 *
 * On focus and on becoming visible, because that is the actual moment someone
 * looks -- David's case was a tab that had been open since before the number
 * changed. Plus a slow interval so a screen left open on a desk does not drift
 * all afternoon. Nothing happens while the tab is hidden: refreshing a tab
 * nobody is looking at spends a query to update pixels no one sees.
 */

/** Slow on purpose. N moves over hours, not seconds, and every tick is a
 *  re-render of a page reading five views. */
const INTERVAL_MS = 60_000

export function SalesLiveRefresh() {
  const router = useRouter()

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }

    // `visibilitychange` covers tab switching; `focus` covers switching back to
    // the whole browser window, which does not always fire the former.
    document.addEventListener('visibilitychange', refreshIfVisible)
    window.addEventListener('focus', refreshIfVisible)
    const timer = setInterval(refreshIfVisible, INTERVAL_MS)

    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible)
      window.removeEventListener('focus', refreshIfVisible)
      clearInterval(timer)
    }
  }, [router])

  return null
}

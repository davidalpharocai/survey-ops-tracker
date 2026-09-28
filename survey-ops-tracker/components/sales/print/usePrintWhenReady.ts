'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Print only once the page is really drawn.
 *
 * The old pages called window.print() two animation frames after mount. That
 * is before the web fonts arrive and before the logo decodes, so a fast
 * machine could bake the fallback face into the PDF, and a slow one a blank
 * box where the wordmark goes. The sequence here is: fonts ready, logo
 * decoded, two frames for layout, then print. The button runs the same thing.
 */
export async function printWhenReady(): Promise<void> {
  try { await document.fonts?.ready } catch { /* no Font Loading API: print anyway */ }
  const logo = document.querySelector<HTMLImageElement>('img.st-logo')
  if (logo) {
    try { await logo.decode() } catch { /* a broken image must not block printing */ }
  }
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  window.print()
}

/**
 * Open the print dialog by itself — but only when `enabled` was true on first
 * render, which the documents set when there is nothing left to check before
 * sending. Decided once: a checklist that empties while someone types a name
 * must not throw a print dialog at them mid-keystroke.
 *
 * No "already ran" ref. In development React mounts, unmounts and remounts
 * every effect; a ref would survive that and swallow the one real run. The
 * cancelled flag lets the first, discarded run stand down instead.
 */
export function usePrintWhenReady(enabled: boolean): () => Promise<void> {
  const initial = useRef(enabled)
  useEffect(() => {
    if (!initial.current) return
    let cancelled = false
    ;(async () => {
      try { await document.fonts?.ready } catch { /* ignore */ }
      if (!cancelled) await printWhenReady()
    })()
    return () => { cancelled = true }
  }, [])
  return useCallback(() => printWhenReady(), [])
}

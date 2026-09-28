'use client'

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * What a modal panel owes a keyboard and screen-reader user, in one place, so
 * the drill panel and the glossary drawer behave the same:
 *
 *   · focus moves INTO the panel when it opens (to `initialFocus`, else the
 *     panel itself);
 *   · Tab and Shift+Tab cycle inside it and never escape to the page behind;
 *   · Escape closes it;
 *   · closing returns focus to whatever opened it (the figure the reader
 *     clicked), so they are not dropped at the top of the page;
 *   · the page behind does not scroll while it is open.
 *
 * The old drill panel did none of this: Escape worked, but focus stayed on the
 * card behind, Tab walked out of the panel into the page, and a screen reader
 * was never told a dialog had opened.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

/** The elements Tab can reach inside `root`, in document order. Hidden ones
 *  (display:none ancestors) are skipped where the browser can tell. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el =>
    !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden]'))
}

// useLayoutEffect warns during server rendering; the panel only ever opens in
// the browser, but the component is imported by a page that is prerendered.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useModalDialog(
  open: boolean,
  onClose: () => void,
  opts: { initialFocus?: RefObject<HTMLElement | null> } = {},
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  // Read through a ref so a parent that passes a fresh arrow each render does
  // not tear the listeners down (and move focus) on every render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const initialRef = opts.initialFocus

  useIsoLayoutEffect(() => {
    if (!open) return
    // Captured BEFORE focus moves: at this point the active element is still
    // the control the reader used to open the panel. That can be an SVG mark
    // (a chart bar is a focusable <g role="button">), which is an SVGElement,
    // not an HTMLElement — both can take focus back.
    const active = document.activeElement
    const trigger = active instanceof HTMLElement || active instanceof SVGElement ? active : null
    const root = ref.current
    const first = initialRef?.current ?? root
    first?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (!ref.current) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(ref.current)
      if (items.length === 0) { e.preventDefault(); ref.current.focus(); return }
      const firstEl = items[0], lastEl = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && ref.current.contains(active)
      if (e.shiftKey) {
        if (!inside || active === firstEl || active === ref.current) { e.preventDefault(); lastEl.focus() }
      } else if (!inside || active === lastEl) {
        e.preventDefault(); firstEl.focus()
      }
    }
    // Capture phase, so a control inside the panel that handles its own keys
    // cannot swallow Escape before the panel sees it.
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      // Back to the figure that opened it — if it is still on the page.
      if (trigger && trigger.isConnected) trigger.focus()
    }
  }, [open, initialRef])

  return ref
}

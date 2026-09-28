'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// useLayoutEffect measures before paint (no flash of a 640px chart squeezed
// into a 358px phone card); on the server it would do nothing, so fall back
// to useEffect there to keep SSR quiet.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The width a chart renders at before it has measured its container (and
 *  on the server). The SVG also scales to 100% of its box, so even this
 *  first paint never overflows a phone screen. */
export const DEFAULT_CHART_WIDTH = 640

/**
 * Track an element's content width with a ResizeObserver.
 *
 * SSR-safe: starts at `fallback`, measures on mount, then follows resizes.
 * Where ResizeObserver does not exist (jsdom, very old browsers) it keeps
 * the one measurement it could take, or the fallback when layout reports 0.
 * `fixed` short-circuits everything, for print layouts and tests.
 */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(
  fallback = DEFAULT_CHART_WIDTH,
  fixed?: number,
) {
  const ref = useRef<T>(null)
  const [measured, setMeasured] = useState(fallback)

  useIsoLayoutEffect(() => {
    if (fixed != null) return
    const el = ref.current
    if (!el) return
    const read = () => {
      const w = Math.floor(el.getBoundingClientRect().width || el.clientWidth || 0)
      // Ignore 0: a chart inside a collapsed tab reports 0 and would draw
      // nothing; keep the last good width until it is shown again.
      if (w > 0) setMeasured((prev) => (Math.abs(prev - w) >= 1 ? w : prev))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => read())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])

  return [ref, fixed ?? measured] as const
}

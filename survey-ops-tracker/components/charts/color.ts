'use client'

/**
 * Just enough colour maths to put readable text on a coloured cell.
 *
 * Heatmap cells mix a token colour toward the card surface and then fade
 * with an opacity channel, so whether ink or white text reads on a given
 * cell depends on the hue, the strength, the opacity AND the theme — a
 * light periwinkle on a dark card needs dark text far sooner than teal on a
 * white card. Guessing from "strength" alone got that wrong in dark mode, so
 * the heatmap resolves the real token values from the page and measures.
 */

import { useEffect, useState, type RefObject } from 'react'

export type RGB = [number, number, number]

/** Parse #rgb, #rrggbb or rgb()/rgba() into 0..255 channels. */
export function parseColor(input: string): RGB | null {
  const s = input.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as RGB
  m = /^#([0-9a-f]{6})/i.exec(s)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

/** `a` weighted by t (0..1) over `b`. */
export const mixRgb = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => a[i] * t + b[i] * (1 - t)) as RGB

function channel(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
export const luminance = (c: RGB) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

/** WCAG contrast ratio. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Resolve `var(--token)` colours to RGB against an element, and again
 * whenever the theme class on <html> changes. Anything that is not a plain
 * var() (or does not resolve, as in jsdom) comes back null, and the caller
 * falls back to its heuristic.
 */
export function useResolvedColors(ref: RefObject<HTMLElement | null>, colors: string[]): (RGB | null)[] {
  const key = colors.join('|')
  const [resolved, setResolved] = useState<(RGB | null)[]>(() => colors.map(() => null))
  useEffect(() => {
    const read = () => {
      const el = ref.current ?? (typeof document !== 'undefined' ? document.documentElement : null)
      if (!el || typeof getComputedStyle === 'undefined') return
      const cs = getComputedStyle(el)
      setResolved(
        key.split('|').map((c) => {
          const v = /^var\((--[\w-]+)\)$/.exec(c.trim())
          return parseColor(v ? cs.getPropertyValue(v[1]) : c)
        }),
      )
    }
    read()
    if (typeof MutationObserver === 'undefined') return
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    return () => mo.disconnect()
  }, [key, ref])
  return resolved
}

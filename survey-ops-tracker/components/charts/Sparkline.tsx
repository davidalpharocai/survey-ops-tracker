'use client'

/**
 * A word-sized trend for KPI tiles ("surveys delivered", "on-time %"): a 2px
 * line, a faint wash, an end dot on the latest value, and an optional dashed
 * goal. No axes, no table toggle — the tile beside it prints the number, and
 * the accessible name spells out the trend.
 *
 * ── ANSWERING A HOVER AT 32px ───────────────────────────────────────────────
 * It used to answer nothing at all: no hit area, no crosshair, not even a
 * cursor change. A reader (David, 2026-09-28: "nothing happens when i hover
 * over the graphs") pointed at the tile trend — the first graphic on
 * /insights — and concluded the whole page was dead.
 *
 * There is still no room for a floating card over a 32px graphic, so THE
 * READOUT IS NOT OURS: pass `onActive` and the caller is told which point the
 * pointer (or the arrow keys) is on, and prints it where it already has room.
 * What this file owns is the aiming: a full-height hit band per point, a
 * crosshair and a ringed dot on the point under it, a crosshair CURSOR so the
 * graphic says it can be read before it is read, and a tab stop with
 * arrow-key stepping so the same figures are reachable without a mouse.
 *
 * Grown from the hand-rolled cumulative-completes sparkline on the project
 * Insights tab, but measured to its box instead of stretched with
 * preserveAspectRatio="none" (which turns the end dot into an ellipse).
 */

import { useState, type KeyboardEvent } from 'react'
import { fmtCount, type Formatter } from './format'
import { isNum, useSvgId } from './primitives'
import { linear } from './scale'
import { useChartWidth } from './useChartWidth'

export interface SparklineProps {
  values: (number | null | undefined)[]
  /** Period names, for the accessible summary (e.g. month names). */
  labels?: string[]
  ariaLabel: string
  height?: number
  width?: number
  color?: string
  /** A 10% wash under the line (default true). */
  area?: boolean
  /** A dashed goal line. */
  goal?: number | null
  /** Start the scale at zero (default true: a count trend should not exaggerate). */
  includeZero?: boolean
  valueFormat?: Formatter
  /** Index of the first point INSIDE the reader's chosen window; everything
   *  left of it is context. Drawn as a dashed rule, so a 32px trend moves
   *  when the date range does. Null, 0 or out of range draws nothing — a
   *  boundary at the first point is the edge of the graphic. */
  boundary?: number | null
  /** Called with the index under the pointer or the keyboard cursor, and null
   *  when it leaves. Passing it makes the sparkline readable: hit bands, a
   *  crosshair, a crosshair cursor, a tab stop and arrow keys. The CALLER
   *  prints the readout — see the header. */
  onActive?: (i: number | null) => void
  className?: string
}

export function Sparkline({
  values,
  labels,
  ariaLabel,
  height = 32,
  width: fixedWidth,
  color = 'var(--chart-cat-1)',
  area = true,
  goal,
  includeZero = true,
  valueFormat = fmtCount,
  boundary = null,
  onActive,
  className = '',
}: SparklineProps) {
  const [ref, W] = useChartWidth<HTMLDivElement>(160, fixedWidth)
  const clipId = useSvgId('spark')
  const [activeRaw, setActiveRaw] = useState<number | null>(null)
  const n = values.length
  const nums = values.filter(isNum)
  // The values can change under us (a new date range is a new array), so the
  // remembered index is checked against the CURRENT length every render
  // rather than trusted.
  const active = activeRaw != null && activeRaw >= 0 && activeRaw < n ? activeRaw : null
  const setActive = (i: number | null) => {
    const next = i == null || i < 0 || i >= n ? null : i
    setActiveRaw(next)
    onActive?.(next)
  }
  const interactive = !!onActive
  // The newest point with a figure: where the end dot sits, and where a
  // keyboard cursor starts.
  let lastI = -1
  for (let i = n - 1; i >= 0; i--)
    if (isNum(values[i])) {
      lastI = i
      break
    }
  const at = boundary != null && boundary > 0 && boundary < n ? boundary : null
  const trend = describeTrend(values, labels, valueFormat, goal)
  // The rule is a fact about the picture, so it rides in the name a screen
  // reader gets, not only in the pixels.
  const summary = at == null ? trend : `${trend} Your dates start at ${labels?.[at] ?? 'the marked point'}.`

  if (nums.length === 0) {
    return (
      <div ref={ref} className={`w-full ${className}`}>
        <span role="img" aria-label={`${ariaLabel}: no data`} className="block text-xs text-muted-foreground">
          No trend yet
        </span>
      </div>
    )
  }

  const pad = 4
  let lo = Math.min(...nums, ...(isNum(goal) ? [goal] : []))
  let hi = Math.max(...nums, ...(isNum(goal) ? [goal] : []))
  if (includeZero) lo = Math.min(0, lo)
  if (lo === hi) {
    hi = lo === 0 ? 1 : hi + Math.abs(hi) * 0.1
    if (!includeZero) lo = lo - Math.abs(lo) * 0.1
  }
  const x = (i: number) => (n === 1 ? W - pad : pad + (i / (n - 1)) * (W - 2 * pad))
  const y = linear([lo, hi], [height - pad, pad])

  let d = ''
  let wash = ''
  let runStart = -1
  const closeRun = (end: number) => {
    if (runStart >= 0 && end > runStart) wash += `${runPath(values, runStart, end, x, y)}L${x(end)},${y(Math.max(lo, 0))}L${x(runStart)},${y(Math.max(lo, 0))}Z`
    runStart = -1
  }
  values.forEach((v, i) => {
    if (!isNum(v)) {
      closeRun(i - 1)
      return
    }
    d += `${runStart < 0 ? 'M' : 'L'}${x(i)},${y(v)}`
    if (runStart < 0) runStart = i
  })
  closeRun(n - 1)

  // Each point's hit band reaches half way to its neighbours, and the ends
  // reach the edge: every pixel of the graphic belongs to some month, so a
  // pointer anywhere over it gets an answer.
  const bandL = (i: number) => (i === 0 ? 0 : (x(i - 1) + x(i)) / 2)
  const bandR = (i: number) => (i === n - 1 ? W : (x(i) + x(i + 1)) / 2)

  const step = (delta: number) => setActive(Math.min(n - 1, Math.max(0, (active ?? lastI) + delta)))
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const k = e.key
    if (k === 'ArrowRight' || k === 'ArrowDown') step(1)
    else if (k === 'ArrowLeft' || k === 'ArrowUp') step(-1)
    else if (k === 'Home') setActive(0)
    else if (k === 'End') setActive(n - 1)
    else if (k === 'Escape') setActive(null)
    else return
    // Only once the key is known to be ours: Tab and Shift+Tab must still leave.
    e.preventDefault()
  }

  return (
    <div ref={ref} className={`w-full min-w-0 ${className}`}>
      <svg
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={`${ariaLabel}. ${summary}`}
        tabIndex={interactive ? 0 : undefined}
        onFocus={interactive ? () => setActive(active ?? lastI) : undefined}
        onBlur={interactive ? () => setActive(null) : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        className={`block h-auto w-full max-w-full rounded${
          interactive ? ' cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-ring' : ''
        }`}
      >
        {/* No <title>: aria-label already names it, and a <title> would repeat
            the name as the description and pop up as a browser tooltip. */}
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={W} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {isNum(goal) && (
            <line x1={0} x2={W} y1={y(goal)} y2={y(goal)} strokeWidth={1} strokeDasharray="3 3" style={{ stroke: 'var(--chart-goal)' }} />
          )}
          {/* Where the reader's dates begin. Drawn under the line, so it
              never breaks the shape the tile is there to show. */}
          {at != null && (
            <line
              data-part="range-start"
              x1={x(at)}
              x2={x(at)}
              y1={0}
              y2={height}
              strokeWidth={1}
              strokeDasharray="2 2"
              style={{ stroke: 'var(--chart-axis)' }}
            />
          )}
          {/* The wash means "amount down to zero"; on a scale that does not
              start at zero it would draw blocks that mean nothing. */}
          {area && includeZero && wash && <path d={wash} opacity={0.1} style={{ fill: color }} />}
          <path data-mark="spark" d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
          {lastI >= 0 && (
            <circle cx={x(lastI)} cy={y(values[lastI] as number)} r={3} strokeWidth={1.5} style={{ fill: color, stroke: 'var(--chart-surface)' }} />
          )}
          {/* The point being read: a crosshair to say WHICH one, and a ring on
              it when it has a figure. A point with no figure gets the
              crosshair alone — the readout says the figure is missing, and a
              dot would invent one. */}
          {active != null && (
            <g data-part="spark-active" pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={0} y2={height} strokeWidth={1} style={{ stroke: 'var(--chart-axis)' }} />
              {isNum(values[active]) && (
                <circle
                  cx={x(active)}
                  cy={y(values[active] as number)}
                  r={3.5}
                  strokeWidth={1.5}
                  style={{ fill: color, stroke: 'var(--chart-surface)' }}
                />
              )}
            </g>
          )}
        </g>
        {/* Hit bands last, so they sit above every mark. Leaving the STRIP
            clears the readout; crossing between two bands does not, so the
            readout never flickers on the way across. */}
        {interactive && (
          <g data-part="spark-hits" onMouseLeave={() => setActive(null)}>
            {values.map((_, i) => (
              <rect
                key={i}
                data-spark-hit={i}
                x={bandL(i)}
                y={0}
                width={Math.max(0, bandR(i) - bandL(i))}
                height={height}
                fill="transparent"
                onMouseEnter={() => setActive(i)}
              />
            ))}
          </g>
        )}
      </svg>
    </div>
  )
}

function runPath(
  values: (number | null | undefined)[],
  from: number,
  to: number,
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let p = ''
  for (let i = from; i <= to; i++) p += `${i === from ? 'M' : 'L'}${x(i)},${y(values[i] as number)}`
  return p
}

/** "From 12 (Apr) to 18 (Sep), peak 21 (Jul); goal 20." */
export function describeTrend(
  values: (number | null | undefined)[],
  labels: string[] | undefined,
  fmt: Formatter,
  goal?: number | null,
): string {
  const pts = values.map((v, i) => ({ v, l: labels?.[i] })).filter((p): p is { v: number; l: string | undefined } => isNum(p.v))
  if (pts.length === 0) return 'No data.'
  const at = (p: { l?: string }) => (p.l ? ` (${p.l})` : '')
  const first = pts[0]
  const last = pts[pts.length - 1]
  let peak = pts[0]
  for (const p of pts) if (p.v > peak.v) peak = p
  let s = pts.length === 1 ? `${fmt(last.v)}${at(last)}` : `From ${fmt(first.v)}${at(first)} to ${fmt(last.v)}${at(last)}`
  if (pts.length > 2 && peak !== last && peak !== first) s += `, peak ${fmt(peak.v)}${at(peak)}`
  if (isNum(goal)) s += `; goal ${fmt(goal)}`
  return s + '.'
}

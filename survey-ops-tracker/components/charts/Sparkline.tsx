'use client'

/**
 * A word-sized trend for KPI tiles ("surveys delivered", "on-time %"): a 2px
 * line, a faint wash, an end dot on the latest value, and an optional dashed
 * goal. No axes, no tooltip, no table toggle — the tile beside it prints the
 * number, and the accessible name spells out the trend.
 *
 * Grown from the hand-rolled cumulative-completes sparkline on the project
 * Insights tab, but measured to its box instead of stretched with
 * preserveAspectRatio="none" (which turns the end dot into an ellipse).
 */

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
  className = '',
}: SparklineProps) {
  const [ref, W] = useChartWidth<HTMLDivElement>(160, fixedWidth)
  const clipId = useSvgId('spark')
  const nums = values.filter(isNum)
  const summary = describeTrend(values, labels, valueFormat, goal)

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
  const n = values.length
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

  let lastI = -1
  for (let i = n - 1; i >= 0; i--)
    if (isNum(values[i])) {
      lastI = i
      break
    }

  return (
    <div ref={ref} className={`w-full min-w-0 ${className}`}>
      <svg
        width={W}
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={`${ariaLabel}. ${summary}`}
        className="block h-auto w-full max-w-full"
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
          {/* The wash means "amount down to zero"; on a scale that does not
              start at zero it would draw blocks that mean nothing. */}
          {area && includeZero && wash && <path d={wash} opacity={0.1} style={{ fill: color }} />}
          <path data-mark="spark" d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
          {lastI >= 0 && (
            <circle cx={x(lastI)} cy={y(values[lastI] as number)} r={3} strokeWidth={1.5} style={{ fill: color, stroke: 'var(--chart-surface)' }} />
          )}
        </g>
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

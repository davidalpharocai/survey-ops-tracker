'use client'

/**
 * Trend lines over ordered categories (months, weeks), one or more series.
 *
 * Built for Insights: on-time %, cycle time and similar trends, with a goal
 * line (horizontal reference) and labelled vertical rules ("new intake form
 * from here"). Points are evenly spaced — the x axis is an ordered list of
 * periods, not a time scale, which is what every SOCC trend is.
 *
 * Hover snaps to the nearest period (a crosshair, not a 2px target) and the
 * tooltip lists every series at that period. A missing value breaks the
 * line: a line drawn through a gap would invent a figure.
 */

import { useMemo, useState } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import { Rules, ZeroNote } from './ColumnChart'
import type { LegendItem } from './Legend'
import { fmtCount, MISSING, type Formatter } from './format'
import { edgeRoom, fitAxisLabels, linear, niceDomain, textWidth } from './scale'
import {
  CategoryTicks,
  ChartSvg,
  ChartTooltip,
  FitText,
  FONT,
  HALO,
  Mark,
  anyDrill,
  describeRefs,
  describeRules,
  describeSeries,
  isNum,
  useTooltip,
  type TipRow,
} from './primitives'
import type { CategoryRule, ChartCommon, ReferenceLine, Series } from './types'
import { useChartWidth } from './useChartWidth'

/** Length of a labelled category tick; the x labels clear it. */
const TICK_LEN = 5
/** Baseline to the middle of the x label: clear of the tick, not floating. */
const TICK_GAP = 8

export interface LineChartProps<D> extends ChartCommon<D> {
  data: D[]
  x: (d: D) => string
  /** A stable key per period, e.g. "2026-09" (default: the label). `rules[].at`
   *  matches it, so a window longer than a year can tell one "Sep" from the
   *  next. (Not called `key`: React keeps that prop for itself.) */
  xKey?: (d: D) => string
  /** A NARROW form of the period label for the axis only, e.g. "Sep 26" for
   *  "September 2026". The tooltip, the accessible summary and the table
   *  always use `x`, so nothing is lost by shortening; the axis text also
   *  carries the long form as its title=. Omit it and the axis uses `x`. */
  xShort?: (d: D) => string
  /** Table header for the period column (default "Period"). */
  xLabel?: string
  series: Series<D>[]
  valueFormat?: Formatter
  axisFormat?: Formatter
  /** Dots on every point (default: on for 24 points or fewer). */
  markers?: boolean
  /** A 10% wash under each line. */
  area?: boolean
  /** Horizontal goal / reference lines. */
  referenceLines?: ReferenceLine[]
  /** Labelled vertical rules at a period key. */
  rules?: CategoryRule[]
  yDomain?: [number, number]
  /** Start the value axis at zero (default true; switch off for a narrow band like 90–100%). */
  includeZero?: boolean
  note?: (d: D) => string | null | undefined
}

export function LineChart<D>({
  data,
  x,
  xKey: keyOf = x,
  xShort,
  xLabel = 'Period',
  series,
  valueFormat = fmtCount,
  axisFormat,
  markers,
  area = false,
  referenceLines = [],
  rules = [],
  yDomain,
  includeZero = true,
  note,
  ariaLabel,
  title,
  info,
  height = 220,
  width: fixedWidth,
  emptyMessage,
  onSelect,
  href,
  table: showTableToggle = true,
  tableOpen,
  className,
}: LineChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const [active, setActive] = useState<number | null>(null)
  const fmtAxis = axisFormat ?? valueFormat
  const interactive = anyDrill(data, onSelect, href)
  const empty = data.length === 0 || series.length === 0 || data.every((d) => series.every((s) => !isNum(s.value(d))))
  const allZero = !empty && data.every((d) => series.every((s) => { const v = s.value(d); return !isNum(v) || v === 0 }))
  const colorOf = (s: Series<D>, i: number) => s.color ?? `var(--chart-cat-${(i % 8) + 1})`

  const layout = useMemo(() => {
    if (empty) return null
    const narrow = W < 420
    const tickFont = narrow ? FONT.small : FONT.tick
    const n = data.length
    const labels = data.map(x)
    // What the axis prints. The long form stays on the tooltip and the table.
    const axisLabels = xShort ? data.map(xShort) : labels
    const rulesH = rules.length * 14
    const top = 6 + rulesH + 8
    const bottom = TICK_LEN + TICK_GAP + 13
    const plotH = Math.max(60, height - top - bottom)
    const H = top + plotH + bottom

    let lo = Infinity
    let hi = -Infinity
    for (const d of data)
      for (const s of series) {
        const v = s.value(d)
        if (!isNum(v)) continue
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    for (const r of referenceLines) {
      lo = Math.min(lo, r.value)
      hi = Math.max(hi, r.value)
    }
    const dom = yDomain
      ? { min: yDomain[0], max: yDomain[1], ticks: niceDomain(yDomain[0], yDomain[1], { includeZero: false }).ticks.filter((t) => t >= yDomain[0] - 1e-9 && t <= yDomain[1] + 1e-9) }
      : niceDomain(lo, hi, { includeZero, count: plotH < 120 ? 3 : 5 })
    const tickLabels = dom.ticks.map(fmtAxis)
    const left = Math.ceil(Math.max(...tickLabels.map((t) => textWidth(t, tickFont)), 12)) + 8

    // A single series is labelled at its end, so reserve room for that label.
    let right = 8
    let endLabel: { i: number; v: number; text: string } | null = null
    if (series.length === 1) {
      for (let i = n - 1; i >= 0; i--) {
        const v = series[0].value(data[i])
        if (isNum(v)) {
          endLabel = { i, v, text: valueFormat(v) }
          break
        }
      }
      if (endLabel && endLabel.i === n - 1) right = Math.max(right, textWidth(endLabel.text, tickFont) + 10)
    }
    // The newest period's label is centred on the last point, which sits at
    // plotR — so half of it hangs past the plot. Reserve that room, or the
    // month a reader looks at first (and the one labelIndices guarantees is
    // drawn) runs off the SVG and is silently cut: ChartSvg's viewBox is the
    // pixel box, so nothing scales it back in.
    const endHalf = textWidth(axisLabels[n - 1] ?? '', tickFont) / 2
    right = Math.min(Math.max(right, endHalf), Math.max(8, W * 0.25))
    const plotL = left
    const plotR = Math.max(plotL + 40, W - right)
    const plotW = plotR - plotL
    const pad = n === 1 ? 0 : Math.min(12, plotW / (2 * n))
    const step = n === 1 ? plotW : (plotW - 2 * pad) / (n - 1)
    const px = (i: number) => (n === 1 ? plotL + plotW / 2 : plotL + pad + i * step)
    const plotTop = top
    const plotBottom = top + plotH
    const y = linear([dom.min, dom.max], [plotBottom, plotTop])
    const slot = n === 1 ? plotW : step
    // One step smaller beats thinning (fitAxisLabels): twelve "Oct 25" labels
    // fit the half-width Insights panel at 10px and collide by a hair at 11.
    // The VALUE axis keeps tickFont either way — only the periods move.
    const fit = fitAxisLabels(axisLabels, slot, tickFont, { minFontSize: FONT.small })
    const kept = new Set(fit.picks)
    return {
      narrow, tickFont, n, labels, axisLabels, rulesH, H, plotL, plotR, plotW, px, step, plotTop, plotBottom, y, dom, tickLabels, endLabel,
      band: step,
      xFont: fit.fontSize,
      // Which periods carry a label; the rest still get a tick, and their
      // words are still in the tooltip and the table. `room` is the width the
      // thinning left a label, capped at twice its distance to each edge so a
      // pinned end label ellipsises (recoverable from its title) rather than
      // being cut by the viewBox.
      shows: (i: number) => kept.has(i),
      room: (i: number) => edgeRoom(fit.rooms[i] ?? slot, px(i), W),
    }
  }, [empty, W, data, x, xShort, series, rules.length, height, referenceLines, yDomain, includeZero, fmtAxis, valueFormat])

  const summary = useMemo(() => {
    if (empty) return ''
    const labels = data.map(x)
    const head = data.length === 1 ? `1 period, ${labels[0]}.` : `${data.length} periods, ${labels[0]} to ${labels[labels.length - 1]}.`
    const parts = series.map((s) => describeSeries(s.label, data.map((d, i) => ({ label: labels[i], value: s.value(d) })), valueFormat))
    let s = `${head} ${[...parts, ...describeRefs(referenceLines, valueFormat)].join('; ')}.`
    const ruleText = describeRules(rules, data.map(keyOf), labels)
    if (ruleText.length) s += ` Marked: ${ruleText.join('; ')}.`
    return s
  }, [empty, data, x, keyOf, series, valueFormat, referenceLines, rules])

  const showMarkers = markers ?? data.length <= 24

  const legend: LegendItem[] = [
    ...(series.length > 1
      ? series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s, i), shape: s.dashed ? ('dash' as const) : ('line' as const), description: s.description }))
      : []),
    ...referenceLines.map((r, i) => ({ key: `ref${i}`, label: r.label, color: r.color ?? 'var(--chart-goal)', shape: 'dash' as const })),
  ]

  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'x', label: xLabel },
          ...series.map((s) => ({ key: s.key, label: s.label, align: 'right' as const, title: s.description })),
          ...(note ? [{ key: '__n', label: 'Note', title: 'Caveats on this period (the same note the tooltip shows)' }] : []),
        ],
        rows: data.map((d, i) => ({
          key: `${i}`,
          cells: [
            x(d),
            ...series.map((s) => (isNum(s.value(d)) ? valueFormat(s.value(d) as number) : MISSING)),
            ...(note ? [note(d) ?? ''] : []),
          ],
          onSelect: onSelect ? () => onSelect(d) : undefined,
          href: href?.(d) ?? null,
        })),
      }
    : null

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      title={title}
      info={info}
      legend={legend}
      table={table}
      tableOpen={tableOpen}
      empty={empty}
      emptyMessage={emptyMessage}
      height={height}
      plotRef={ref}
      className={className}
    >
      {layout && (
        <>
          <ChartSvg width={W} height={layout.H} label={ariaLabel} summary={summary} interactive={interactive}>
            {layout.dom.ticks.map((t, i) => (
              <g key={`t${i}`}>
                <line
                  x1={layout.plotL}
                  x2={layout.plotR}
                  y1={layout.y(t)}
                  y2={layout.y(t)}
                  strokeWidth={1}
                  style={{ stroke: t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)' }}
                />
                <text
                  x={layout.plotL - 6}
                  y={layout.y(t)}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="fill-muted-foreground tabular-nums"
                  style={{ fontSize: layout.tickFont }}
                >
                  {layout.tickLabels[i]}
                </text>
              </g>
            ))}

            {referenceLines.map((r, i) => (
              <g key={`ref${i}`} pointerEvents="none">
                <line
                  x1={layout.plotL}
                  x2={layout.plotR}
                  y1={layout.y(r.value)}
                  y2={layout.y(r.value)}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  style={{ stroke: r.color ?? 'var(--chart-goal)' }}
                />
                {/* Left end: the right end carries the latest value's label. */}
                <FitText
                  text={r.label}
                  maxWidth={layout.plotW - 8}
                  fontSize={FONT.small}
                  x={layout.plotL + 3}
                  y={layout.y(r.value) - 7}
                  className="fill-muted-foreground"
                  halo
                />
              </g>
            ))}

            <Rules rules={rules} keys={data.map(keyOf)} layout={layout} W={W} xAt={layout.px} />

            {allZero && <ZeroNote x={(layout.plotL + layout.plotR) / 2} y={(layout.plotTop + layout.plotBottom) / 2 - 12} />}

            {/* crosshair: the reader aims at a period, not at a 2px line */}
            {active != null && (
              <line
                x1={layout.px(active)}
                x2={layout.px(active)}
                y1={layout.plotTop}
                y2={layout.plotBottom}
                strokeWidth={1}
                pointerEvents="none"
                style={{ stroke: 'var(--chart-axis)' }}
              />
            )}

            {series.map((s, si) => {
              const c = colorOf(s, si)
              const vals = data.map((d) => s.value(d))
              const segs: { d: string; from: number; to: number }[] = []
              let cur: { d: string; from: number; to: number } | null = null
              vals.forEach((v, i) => {
                if (!isNum(v)) {
                  if (cur) segs.push(cur)
                  cur = null
                  return
                }
                const pt = `${layout.px(i)},${layout.y(v)}`
                if (!cur) cur = { d: `M${pt}`, from: i, to: i }
                else {
                  cur.d += `L${pt}`
                  cur.to = i
                }
              })
              if (cur) segs.push(cur)
              const base = layout.y(Math.max(layout.dom.min, Math.min(0, layout.dom.max)))
              return (
                <g key={s.key} pointerEvents="none">
                  {area &&
                    segs
                      .filter((g) => g.to > g.from)
                      .map((g, gi) => (
                        <path
                          key={`a${gi}`}
                          d={`${g.d}L${layout.px(g.to)},${base}L${layout.px(g.from)},${base}Z`}
                          opacity={0.1}
                          style={{ fill: c }}
                        />
                      ))}
                  {segs.map((g, gi) => (
                    <path
                      key={gi}
                      data-mark="line"
                      data-series={s.key}
                      d={g.d}
                      fill="none"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeDasharray={s.dashed ? '6 4' : undefined}
                      style={{ stroke: c }}
                    />
                  ))}
                  {vals.map((v, i) => {
                    if (!isNum(v)) return null
                    // An isolated point (no neighbour to draw a line to) always
                    // gets a dot, or it would be invisible.
                    const isolated = !isNum(vals[i - 1]) && !isNum(vals[i + 1])
                    if (!showMarkers && !isolated && active !== i) return null
                    return (
                      <circle
                        key={`p${i}`}
                        data-mark="point"
                        data-series={s.key}
                        cx={layout.px(i)}
                        cy={layout.y(v)}
                        r={active === i ? 5 : 4}
                        strokeWidth={2}
                        style={{ fill: c, stroke: 'var(--chart-surface)' }}
                      />
                    )
                  })}
                </g>
              )
            })}

            {layout.endLabel && (
              <text
                x={layout.px(layout.endLabel.i) + 7}
                y={layout.y(layout.endLabel.v)}
                dominantBaseline="central"
                className="fill-foreground tabular-nums"
                pointerEvents="none"
                style={{ fontSize: layout.tickFont, fontWeight: 500, ...HALO }}
              >
                {layout.endLabel.text}
              </text>
            )}

            {data.map((d, i) => {
              const cx = layout.px(i)
              const halfL = layout.n === 1 ? layout.plotW / 2 : i === 0 ? cx - layout.plotL : layout.step / 2
              const halfR = layout.n === 1 ? layout.plotW / 2 : i === layout.n - 1 ? layout.plotR - cx : layout.step / 2
              const rows: TipRow[] = series.map((s, si) => {
                const v = s.value(d)
                return { key: s.key, label: s.label, value: isNum(v) ? valueFormat(v) : MISSING, color: colorOf(s, si) }
              })
              const nums = series.map((s) => s.value(d)).filter(isNum)
              const tipY = nums.length ? layout.y(Math.max(...nums)) : layout.plotTop
              const noteText = note?.(d) ?? undefined
              const aria = [x(d), ...rows.map((r) => `${r.label} ${r.value}`), noteText].filter(Boolean).join(', ')
              return (
                <Mark
                  key={`h${i}`}
                  dataKey={`h${i}`}
                  label={aria}
                  hit={{ x: cx - halfL, y: layout.plotTop, w: halfL + halfR, h: layout.plotBottom - layout.plotTop + 18 }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => {
                    setActive(i)
                    show({ x: cx, y: tipY, title: x(d), rows, note: noteText })
                  }}
                  onHide={() => {
                    setActive(null)
                    hide()
                  }}
                >
                  {layout.shows(i) && (
                    <FitText
                      text={layout.axisLabels[i]}
                      full={layout.labels[i]}
                      maxWidth={layout.room(i)}
                      fontSize={layout.xFont}
                      x={cx}
                      y={layout.plotBottom + TICK_LEN + TICK_GAP}
                      anchor="middle"
                    />
                  )}
                </Mark>
              )
            })}
            {/* a tick per period, so a thinned label still leaves a mark
                where its point sits */}
            <CategoryTicks
              at={data.map((_, i) => layout.px(i))}
              base={layout.plotBottom}
              labelled={(i) => layout.shows(i)}
              size={TICK_LEN}
            />
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

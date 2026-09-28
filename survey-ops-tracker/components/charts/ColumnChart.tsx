'use client'

/**
 * Vertical columns by category (usually month): grouped side by side, or
 * stacked into one column.
 *
 * Built for two readers:
 *   - Finance Results (C1): client price (teal) vs our cost (navy) per month,
 *     a hatched "spend with no price" bar, kept % in a strip above, survey
 *     count under each month, faded months where coverage is thin, click a
 *     month to open its surveys.
 *   - Insights: surveys delivered per month, stacked by type.
 *
 * WHY THE OVERLAY IS A STRIP, NOT A SECOND AXIS: kept % and dollars are
 * different units. Drawing both on one plot needs two y-scales, and the
 * alignment of two scales is arbitrary — the chart would invent a
 * relationship. So the overlay gets its own thin band above the columns,
 * sharing only the x positions.
 */

import { useMemo, type ReactNode } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import type { LegendItem } from './Legend'
import { fmtCount, MISSING, type Formatter } from './format'
import { labelStep, linear, niceDomain, roundedBar, textWidth } from './scale'
import {
  ChartSvg,
  ChartTooltip,
  FitText,
  FONT,
  HALO,
  HatchDef,
  Mark,
  anyDrill,
  describeRefs,
  describeRules,
  describeSeries,
  isNum,
  useSvgId,
  useTooltip,
  type TipRow,
} from './primitives'
import type { CategoryRule, ChartCommon, ReferenceLine, Series } from './types'
import { useChartWidth } from './useChartWidth'

/** A text label attached to each category, with a name for the table header. */
export interface DatumLabel<D> {
  name: string
  text: (d: D) => string | null | undefined
  description?: string
}

/** A second measure drawn as a line in its own strip above the columns. */
export interface ColumnOverlay<D> {
  label: string
  value: (d: D) => number | null | undefined
  format: Formatter
  color?: string
  description?: string
}

export interface ColumnChartProps<D> extends ChartCommon<D> {
  data: D[]
  /** The category label, e.g. "Aug". */
  x: (d: D) => string
  /** A stable key per category, e.g. "2026-09" (default: the label).
   *  `rules[].at` matches it, so a window longer than a year can tell one
   *  "Sep" from the next. (Not called `key`: React keeps that prop for itself.) */
  xKey?: (d: D) => string
  /** Table header for the category column (default "Category"). */
  xLabel?: string
  series: Series<D>[]
  mode?: 'grouped' | 'stacked'
  /** Formats values in labels, tooltips and the table (default: counts). */
  valueFormat?: Formatter
  /** Formats y-axis ticks (default: valueFormat). Pass a compact formatter for money. */
  axisFormat?: Formatter
  /** Per-category opacity 0..1, e.g. cost coverage. Faded columns stay
   *  clickable, are named in the legend and marked in the table. */
  opacity?: (d: D) => number | null | undefined
  /** What a faded column means, for the legend and table (default "fewer
   *  records behind this figure"). */
  opacityNote?: string
  /** A sentence added to the tooltip, e.g. "Costs not recorded before June". */
  note?: (d: D) => string | null | undefined
  /** Text above each column/group, e.g. kept %. */
  topLabel?: DatumLabel<D>
  /** Text under each category label, e.g. "4 surveys". */
  subLabel?: DatumLabel<D>
  overlay?: ColumnOverlay<D>
  referenceLines?: ReferenceLine[]
  /** Vertical rules before a category key, e.g. "costs reliable from here". */
  rules?: CategoryRule[]
  /** Force the value domain (otherwise nice ticks around the data and zero). */
  yDomain?: [number, number]
}

const BAR_MAX = 24
const GAP = 2
/** The faintest a faded column gets: still findable against the card. */
const MIN_OPACITY = 0.35

export function ColumnChart<D>({
  data,
  x,
  xKey: keyOf = x,
  xLabel = 'Category',
  series,
  mode = 'grouped',
  valueFormat = fmtCount,
  axisFormat,
  opacity,
  opacityNote = 'fewer records behind this figure',
  note,
  topLabel,
  subLabel,
  overlay,
  referenceLines = [],
  rules = [],
  yDomain,
  ariaLabel,
  title,
  info,
  height = 240,
  width: fixedWidth,
  emptyMessage,
  onSelect,
  href,
  table: showTableToggle = true,
  tableOpen,
  className,
}: ColumnChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const hatchId = useSvgId('hatch')
  const fmtAxis = axisFormat ?? valueFormat
  const interactive = anyDrill(data, onSelect, href)
  const opOf = (d: D) => (opacity ? clamp01(opacity(d)) : 1)
  const anyFaded = !!opacity && data.some((d) => opOf(d) < 1)

  const empty =
    data.length === 0 || series.length === 0 || data.every((d) => series.every((s) => !isNum(s.value(d))))
  // Data exists but is all zero: draw the axis and SAY so, rather than
  // leaving an empty plot that looks like a failed load.
  const allZero = !empty && data.every((d) => series.every((s) => { const v = s.value(d); return !isNum(v) || v === 0 }))

  const layout = useMemo(() => {
    if (empty) return null
    const narrow = W < 420
    const tickFont = narrow ? FONT.small : FONT.tick
    const n = data.length
    const labels = data.map(x)

    // ── vertical budget: rule labels, overlay strip, top labels, plot, x labels
    const rulesH = rules.length * 14
    const overlayH = overlay ? 44 : 0
    const topH = topLabel ? 16 : 0
    const top = 6 + rulesH + overlayH + topH
    const bottom = 18 + (subLabel ? 14 : 0) + 2
    const plotH = Math.max(60, height - top - bottom)
    const H = top + plotH + bottom

    // ── value domain
    let lo = 0
    let hi = 0
    for (const d of data) {
      if (mode === 'stacked') {
        let pos = 0
        let neg = 0
        for (const s of series) {
          const v = s.value(d)
          if (!isNum(v)) continue
          if (v >= 0) pos += v
          else neg += v
        }
        hi = Math.max(hi, pos)
        lo = Math.min(lo, neg)
      } else {
        for (const s of series) {
          const v = s.value(d)
          if (!isNum(v)) continue
          hi = Math.max(hi, v)
          lo = Math.min(lo, v)
        }
      }
    }
    for (const r of referenceLines) {
      hi = Math.max(hi, r.value)
      lo = Math.min(lo, r.value)
    }
    const dom = yDomain
      ? { min: yDomain[0], max: yDomain[1], ticks: niceDomain(yDomain[0], yDomain[1]).ticks.filter((t) => t >= yDomain[0] && t <= yDomain[1]) }
      : niceDomain(lo, hi, { count: plotH < 120 ? 3 : 5 })

    // ── horizontal budget: y tick labels on the left
    const tickLabels = dom.ticks.map(fmtAxis)
    const left = Math.ceil(Math.max(...tickLabels.map((t) => textWidth(t, tickFont)), 12)) + 8
    const right = 6
    const plotL = left
    const plotR = Math.max(plotL + 40, W - right)
    const plotW = plotR - plotL
    const band = plotW / n
    const plotTop = top
    const plotBottom = top + plotH
    const y = linear([dom.min, dom.max], [plotBottom, plotTop])

    const nS = mode === 'grouped' ? series.length : 1
    const barW = Math.max(2, Math.min(BAR_MAX, (band * 0.8 - (nS - 1) * GAP) / nS))
    const groupW = nS * barW + (nS - 1) * GAP

    return {
      narrow, tickFont, n, labels, rulesH, overlayH, topH, H, plotL, plotR, plotW, band,
      plotTop, plotBottom, y, dom, tickLabels, barW, groupW,
      xStep: labelStep(labels, band, tickFont),
      subStep: subLabel ? labelStep(data.map((d) => subLabel.text(d) ?? ''), band, FONT.small) : 1,
      topStep: topLabel ? labelStep(data.map((d) => topLabel.text(d) ?? ''), band, tickFont) : 1,
    }
  }, [empty, W, data, x, series, mode, rules.length, overlay, topLabel, subLabel, height, referenceLines, yDomain, fmtAxis])

  const summary = useMemo(() => {
    if (empty) return ''
    const labels = data.map(x)
    const head =
      data.length === 1 ? `1 category, ${labels[0]}.` : `${data.length} categories, ${labels[0]} to ${labels[labels.length - 1]}.`
    const parts = series.map((s) =>
      describeSeries(s.label, data.map((d, i) => ({ label: labels[i], value: s.value(d) })), valueFormat),
    )
    // Stacked: the column total is the headline figure, so say it too.
    if (mode === 'stacked' && series.length > 1) {
      const totals = data.map((d, i) => {
        const vals = series.map((s) => s.value(d)).filter(isNum)
        return { label: labels[i], value: vals.length ? vals.reduce((a, b) => a + b, 0) : null }
      })
      parts.push(describeSeries('Total', totals, valueFormat))
    }
    if (overlay) parts.push(describeSeries(overlay.label, data.map((d, i) => ({ label: labels[i], value: overlay.value(d) })), overlay.format))
    parts.push(...describeRefs(referenceLines, valueFormat))
    let s = `${head} ${parts.join('; ')}.`
    const ruleText = describeRules(rules, data.map(keyOf), labels)
    if (ruleText.length) s += ` Marked: ${ruleText.join('; ')}.`
    const faded = opacity ? data.filter((d) => clamp01(opacity(d)) < 1) : []
    if (faded.length) s += ` Faded (${opacityNote}): ${faded.map(x).join(', ')}.`
    return s
  }, [empty, data, x, keyOf, series, mode, overlay, valueFormat, referenceLines, rules, opacity, opacityNote])

  const legend: LegendItem[] = [
    ...(series.length > 1 || series.some((s) => s.hatch)
      ? series.map((s, i) => ({
          key: s.key,
          label: s.label,
          color: s.color ?? `var(--chart-cat-${(i % 8) + 1})`,
          shape: s.hatch ? ('hatch' as const) : ('rect' as const),
          description: s.description,
        }))
      : []),
    ...(overlay
      ? [{ key: '__overlay', label: overlay.label, color: overlay.color ?? 'var(--chart-keep)', shape: 'line' as const, description: overlay.description ?? 'Drawn in its own strip above the columns, on its own scale.' }]
      : []),
    ...referenceLines.map((r, i) => ({ key: `__ref${i}`, label: r.label, color: r.color ?? 'var(--chart-goal)', shape: 'dash' as const })),
    // A fade is a caveat, and a caveat the legend does not name is one only
    // a mouse user (reading the tooltip note) would ever learn about.
    ...(anyFaded
      ? [
          {
            key: '__faded',
            label: `Faded: ${opacityNote}`,
            color: `color-mix(in oklab, ${series[0]?.color ?? 'var(--chart-cat-1)'} ${Math.round(MIN_OPACITY * 100)}%, var(--chart-surface))`,
          },
        ]
      : []),
  ]

  const hasNotes = !!note || anyFaded
  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'x', label: xLabel },
          ...series.map((s) => ({ key: s.key, label: s.label, align: 'right' as const, title: s.description })),
          ...(overlay ? [{ key: '__o', label: overlay.label, align: 'right' as const, title: overlay.description }] : []),
          ...(topLabel ? [{ key: '__t', label: topLabel.name, align: 'right' as const, title: topLabel.description }] : []),
          ...(subLabel ? [{ key: '__s', label: subLabel.name, align: 'right' as const, title: subLabel.description }] : []),
          ...(hasNotes ? [{ key: '__n', label: 'Note', title: 'Caveats on this row: the tooltip note, or why the column is faded' }] : []),
        ],
        rows: data.map((d, i) => {
          const faded = opOf(d) < 1
          return {
            key: `${i}`,
            muted: faded,
            cells: [
              x(d),
              ...series.map((s) => fmtVal(s.value(d), valueFormat)),
              ...(overlay ? [fmtVal(overlay.value(d), overlay.format)] : []),
              ...(topLabel ? [topLabel.text(d) ?? MISSING] : []),
              ...(subLabel ? [subLabel.text(d) ?? MISSING] : []),
              ...(hasNotes ? [note?.(d) || (faded ? `Faded: ${opacityNote}` : '')] : []),
            ],
            onSelect: onSelect ? () => onSelect(d) : undefined,
            href: href?.(d) ?? null,
          }
        }),
      }
    : null

  /** The top of category d's column (or its tallest bar): where its top label sits. */
  const topOf = (d: D): number => {
    if (!layout) return 0
    const y0 = layout.y(0)
    if (mode === 'stacked') {
      let pos = 0
      for (const s of series) {
        const v = s.value(d)
        if (isNum(v) && v > 0) pos += v
      }
      return Math.min(y0, layout.y(pos))
    }
    let t = y0
    for (const s of series) {
      const v = s.value(d)
      if (isNum(v)) t = Math.min(t, layout.y(v))
    }
    return t
  }

  // Where each reference line's label goes. It used to sit at the left end of
  // its line, which is where the FIRST column's top label sits: a month whose
  // total was near the goal printed "40" under "Goal: 40 a month". So try the
  // left and right ends, above then below the line, and take the first spot
  // clear of every top label.
  const topBoxes: Box[] =
    layout && topLabel
      ? data.flatMap((d, i) => {
          const t = topLabel.text(d)
          if (!t || i % layout.topStep !== 0) return []
          const cx = layout.plotL + layout.band * (i + 0.5)
          const w = textWidth(t, layout.tickFont)
          const base = topOf(d) - 5 // the label's alphabetic baseline
          return [{ x0: cx - w / 2, x1: cx + w / 2, y0: base - layout.tickFont * 0.8, y1: base + layout.tickFont * 0.25 }]
        })
      : []
  const refPlacement = (r: ReferenceLine): { x: number; y: number; anchor: 'start' | 'end' } => {
    const l = layout!
    const ly = l.y(r.value)
    const tw = textWidth(r.label, FONT.small)
    const spots = [
      { x: l.plotL + 3, y: ly - 7, anchor: 'start' as const },
      { x: l.plotR - 3, y: ly - 7, anchor: 'end' as const },
      { x: l.plotL + 3, y: ly + 8, anchor: 'start' as const },
      { x: l.plotR - 3, y: ly + 8, anchor: 'end' as const },
    ]
    for (const p of spots) {
      if (p.y + FONT.small / 2 > l.plotBottom) continue
      const x0 = p.anchor === 'start' ? p.x : p.x - tw
      const box = { x0: x0 - 2, x1: x0 + tw + 2, y0: p.y - FONT.small / 2 - 1, y1: p.y + FONT.small / 2 + 1 }
      if (!topBoxes.some((b) => overlaps(box, b))) return p
    }
    return spots[0]
  }

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
            <HatchDef id={hatchId} />
            {/* gridlines + y ticks (the zero line is drawn later, stronger) */}
            {layout.dom.ticks.map((t, i) => (
              <g key={`t${i}`}>
                {t !== 0 && (
                  <line x1={layout.plotL} x2={layout.plotR} y1={layout.y(t)} y2={layout.y(t)} strokeWidth={1} style={{ stroke: 'var(--chart-grid)' }} />
                )}
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

            {/* one Mark per category: bars, labels, hit area */}
            {data.map((d, i) => {
              const cx = layout.plotL + layout.band * (i + 0.5)
              const gx = cx - layout.groupW / 2
              const op = opOf(d)
              const y0 = layout.y(0)
              const bars: ReactNode[] = []
              const topY = topOf(d)
              if (mode === 'stacked') {
                // Positive segments stack up from zero, negatives down; only the
                // outermost segment on each side gets the rounded end.
                const vals = series.map((s) => s.value(d))
                const lastPos = lastIndex(vals, (v) => isNum(v) && v > 0)
                const lastNeg = lastIndex(vals, (v) => isNum(v) && v < 0)
                let pos = 0
                let neg = 0
                let posCount = 0
                let negCount = 0
                series.forEach((s, si) => {
                  const v = vals[si]
                  if (!isNum(v) || v === 0) return
                  const from = v > 0 ? pos : neg
                  const to = from + v
                  if (v > 0) pos = to
                  else neg = to
                  const touchesBase = v > 0 ? posCount++ === 0 : negCount++ === 0
                  const yA = layout.y(from)
                  const yB = layout.y(to)
                  let yTop = Math.min(yA, yB)
                  let h = Math.abs(yB - yA)
                  // the 2px surface gap between touching segments
                  // (below a positive segment, above a negative one).
                  if (!touchesBase) {
                    h -= GAP
                    if (v < 0) yTop += GAP
                  }
                  if (h <= 0) return
                  const end = v > 0 ? (si === lastPos ? 'top' : 'none') : si === lastNeg ? 'bottom' : 'none'
                  bars.push(
                    <path
                      key={s.key}
                      data-mark="column"
                      data-series={s.key}
                      d={roundedBar(gx, yTop, layout.barW, h, end)}
                      style={{ fill: s.hatch ? `url(#${hatchId})` : s.color ?? `var(--chart-cat-${(si % 8) + 1})` }}
                    />,
                  )
                })
              } else {
                series.forEach((s, si) => {
                  const v = s.value(d)
                  if (!isNum(v)) return
                  const bx = gx + si * (layout.barW + GAP)
                  const yv = layout.y(v)
                  const yTop = Math.min(y0, yv)
                  const h = Math.abs(yv - y0)
                  if (h <= 0) return
                  bars.push(
                    <path
                      key={s.key}
                      data-mark="column"
                      data-series={s.key}
                      d={roundedBar(bx, yTop, layout.barW, h, v >= 0 ? 'top' : 'bottom')}
                      style={{ fill: s.hatch ? `url(#${hatchId})` : s.color ?? `var(--chart-cat-${(si % 8) + 1})` }}
                    />,
                  )
                })
              }

              const rows: TipRow[] = series.map((s, si) => ({
                key: s.key,
                label: s.label,
                value: fmtVal(s.value(d), valueFormat),
                color: s.hatch ? undefined : s.color ?? `var(--chart-cat-${(si % 8) + 1})`,
                hatch: s.hatch,
              }))
              if (overlay) rows.push({ key: '__o', label: overlay.label, value: fmtVal(overlay.value(d), overlay.format), color: overlay.color ?? 'var(--chart-keep)' })
              const tText = topLabel?.text(d)
              const sText = subLabel?.text(d)
              const noteText = [sText ? `${subLabel!.name}: ${sText}` : null, note?.(d)].filter(Boolean).join(' · ')
              const aria = [
                x(d),
                ...rows.map((r) => `${r.label} ${r.value}`),
                tText ? `${topLabel!.name} ${tText}` : null,
                noteText || null,
              ]
                .filter(Boolean)
                .join(', ')

              return (
                <Mark
                  key={`c${i}`}
                  dataKey={`c${i}`}
                  label={aria}
                  hit={{ x: layout.plotL + layout.band * i, y: 6 + layout.rulesH, w: layout.band, h: layout.H - 6 - layout.rulesH }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => show({ x: cx, y: Math.max(layout.plotTop - layout.topH, topY), title: x(d), rows, note: noteText || undefined })}
                  onHide={hide}
                >
                  <g opacity={op}>{bars}</g>
                  {topLabel && tText && i % layout.topStep === 0 && (
                    <text
                      x={cx}
                      y={topY - 5}
                      textAnchor="middle"
                      className="fill-foreground tabular-nums"
                      style={{ fontSize: layout.tickFont, fontWeight: 500, ...HALO }}
                    >
                      {tText}
                    </text>
                  )}
                  {i % layout.xStep === 0 && (
                    <FitText
                      text={layout.labels[i]}
                      maxWidth={layout.band * layout.xStep - 4}
                      fontSize={layout.tickFont}
                      x={cx}
                      y={layout.plotBottom + 11}
                      anchor="middle"
                    />
                  )}
                  {subLabel && sText && i % layout.subStep === 0 && (
                    <FitText
                      text={sText}
                      maxWidth={layout.band * layout.subStep - 4}
                      fontSize={FONT.small}
                      x={cx}
                      y={layout.plotBottom + 25}
                      anchor="middle"
                    />
                  )}
                </Mark>
              )
            })}

            {/* zero line: the baseline every column grows from */}
            <line
              x1={layout.plotL}
              x2={layout.plotR}
              y1={layout.y(0)}
              y2={layout.y(0)}
              strokeWidth={layout.dom.min < 0 ? 1.5 : 1}
              style={{ stroke: 'var(--chart-axis)' }}
            />

            {referenceLines.map((r, i) => {
              const p = refPlacement(r)
              return (
                <g key={`r${i}`} pointerEvents="none">
                  <line
                    x1={layout.plotL}
                    x2={layout.plotR}
                    y1={layout.y(r.value)}
                    y2={layout.y(r.value)}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    style={{ stroke: r.color ?? 'var(--chart-goal)' }}
                  />
                  <FitText
                    text={r.label}
                    maxWidth={layout.plotW - 8}
                    fontSize={FONT.small}
                    x={p.x}
                    y={p.y}
                    anchor={p.anchor}
                    className="fill-muted-foreground"
                    halo
                  />
                </g>
              )
            })}

            {allZero && <ZeroNote x={(layout.plotL + layout.plotR) / 2} y={(layout.plotTop + layout.plotBottom) / 2} />}

            {overlay && <OverlayStrip data={data} overlay={overlay} layout={layout} />}

            <Rules rules={rules} keys={data.map(keyOf)} layout={layout} W={W} />
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

/** "Every value here is zero" — shared with LineChart. */
export function ZeroNote({ x, y }: { x: number; y: number }) {
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground" pointerEvents="none" style={{ fontSize: FONT.label, ...HALO }}>
      Every value here is zero
    </text>
  )
}

function fmtVal(v: number | null | undefined, f: Formatter): string {
  return isNum(v) ? f(v) : MISSING
}

function clamp01(v: number | null | undefined): number {
  if (!isNum(v)) return 1
  return Math.min(1, Math.max(MIN_OPACITY, v))
}

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

function lastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i
  return -1
}

interface StripLayout {
  plotL: number
  plotR: number
  band: number
  rulesH: number
  overlayH: number
  tickFont: number
  narrow: boolean
}

/** The overlay line in its own band above the columns (see the file header). */
function OverlayStrip<D>({ data, overlay, layout }: { data: D[]; overlay: ColumnOverlay<D>; layout: StripLayout }) {
  const top = 6 + layout.rulesH
  const vals = data.map((d) => overlay.value(d))
  const nums = vals.filter(isNum)
  if (nums.length === 0) return null
  const lo = Math.min(...nums)
  const hi = Math.max(...nums)
  const y = linear(lo === hi ? [lo - 1, hi + 1] : [lo, hi], [top + layout.overlayH - 8, top + 16])
  const cx = (i: number) => layout.plotL + layout.band * (i + 0.5)
  const color = overlay.color ?? 'var(--chart-keep)'
  const texts = vals.map((v) => (isNum(v) ? overlay.format(v) : ''))
  const step = labelStep(texts, layout.band, layout.tickFont)
  // Break the line at missing values: a gap says "no figure", a line through
  // it would invent one.
  const segs: string[] = []
  let cur = ''
  vals.forEach((v, i) => {
    if (!isNum(v)) {
      if (cur) segs.push(cur)
      cur = ''
      return
    }
    cur += `${cur ? 'L' : 'M'}${cx(i)},${y(v)}`
  })
  if (cur) segs.push(cur)
  return (
    <g pointerEvents="none">
      <line x1={layout.plotL} x2={layout.plotR} y1={top + layout.overlayH} y2={top + layout.overlayH} strokeWidth={1} style={{ stroke: 'var(--chart-grid)' }} />
      {textWidth(overlay.label, FONT.small) <= layout.plotL - 4 && (
        <text x={0} y={top + 6} dominantBaseline="central" className="fill-muted-foreground" style={{ fontSize: FONT.small }}>
          {overlay.label}
        </text>
      )}
      {segs.map((p, i) => (
        <path key={i} d={p} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: color }} />
      ))}
      {vals.map((v, i) =>
        isNum(v) ? (
          <g key={i}>
            <circle data-mark="overlay" cx={cx(i)} cy={y(v)} r={4} strokeWidth={2} style={{ fill: color, stroke: 'var(--chart-surface)' }} />
            {i % step === 0 && (
              <text
                x={cx(i)}
                y={y(v) - 8}
                textAnchor="middle"
                className="fill-foreground tabular-nums"
                style={{ fontSize: layout.tickFont, ...HALO }}
              >
                {texts[i]}
              </text>
            )}
          </g>
        ) : null,
      )}
    </g>
  )
}

interface RuleLayout {
  plotL: number
  band: number
  plotBottom: number
  tickFont: number
}

/**
 * Vertical rules at the left edge of a category, labels stacked one per line
 * above the plot so two rules a column apart never overprint each other.
 * Shared with LineChart (which passes point positions instead of bands).
 */
export function Rules({
  rules,
  keys,
  layout,
  W,
  xAt,
}: {
  rules: CategoryRule[]
  /** Each category's key, in order; a rule's `at` names one of these. */
  keys: string[]
  layout: RuleLayout
  W: number
  /** Position of category i; defaults to the band's left edge. */
  xAt?: (i: number) => number
}) {
  return (
    <g pointerEvents="none">
      {rules.map((r, j) => {
        const i = keys.indexOf(r.at)
        if (i < 0) return null
        const rx = xAt ? xAt(i) : layout.plotL + layout.band * i
        const ly = 6 + j * 14 + 7
        const tw = textWidth(r.label, FONT.small)
        const fitsRight = rx + 4 + tw <= W - 2
        return (
          <g key={`${r.at}-${j}`}>
            <line
              x1={rx}
              x2={rx}
              y1={ly + 5}
              y2={layout.plotBottom}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              style={{ stroke: r.color ?? 'var(--chart-axis)' }}
            />
            <FitText
              text={r.label}
              maxWidth={fitsRight ? W - rx - 6 : Math.max(0, rx - 6)}
              fontSize={FONT.small}
              x={fitsRight ? rx + 4 : rx - 4}
              y={ly}
              anchor={fitsRight ? 'start' : 'end'}
              className="fill-muted-foreground"
              // A label flipped to the left of its rule can cross an earlier
              // rule's line; the halo masks the line behind the words.
              halo
            />
          </g>
        )
      })}
    </g>
  )
}

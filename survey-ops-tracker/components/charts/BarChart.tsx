'use client'

/**
 * Horizontal bars, one row per group — optionally DIVERGING around zero.
 *
 * Built for:
 *   - Finance Results (C2): kept dollars by account / route / month, teal to
 *     the right, red to the left, labelled "kept % · n", with groups too
 *     small to judge muted and tagged.
 *   - Insights: surveys delivered by captain.
 *
 * Every bar carries its value at the tip, so there are no axis ticks to read
 * across — only the zero line, which is emphasised on diverging charts
 * because which side of it a bar falls on IS the message.
 *
 * At phone width the group label moves above its bar instead of beside it:
 * a 390px screen cannot spare 40% of its width for names and still draw a
 * bar long enough to compare.
 */

import { useMemo } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import type { DatumLabel } from './ColumnChart'
import type { LegendItem } from './Legend'
import { fmtCount, MISSING, type Formatter } from './format'
import { linear, niceDomain, roundedBar, textWidth } from './scale'
import {
  ChartSvg,
  ChartTooltip,
  FitText,
  FONT,
  HALO,
  Mark,
  TaggedText,
  anyDrill,
  isNum,
  printsAsZero,
  taggedWidth,
  useTooltip,
  type TipRow,
} from './primitives'
import type { ChartCommon, ReferenceLine } from './types'
import { useChartWidth } from './useChartWidth'

export interface BarChartProps<D> extends ChartCommon<D> {
  data: D[]
  /** The group name, e.g. an account. */
  label: (d: D) => string
  /** Table header for the group column (default "Group"). */
  labelHeader?: string
  value: (d: D) => number | null | undefined
  /** What the value is, for the tooltip and table header (default "Value"). */
  valueName?: string
  valueFormat?: Formatter
  /** Text at the bar end (default: the formatted value), e.g. "43% · 8". */
  valueLabel?: DatumLabel<D>
  /** Colour by sign around an emphasised zero line. */
  diverging?: boolean
  /** Legend names for the two sides of a diverging chart. */
  positiveLabel?: string
  negativeLabel?: string
  /** Bar colour (default: teal price on diverging charts, categorical slot 1 otherwise). */
  color?: string | ((d: D) => string)
  /** Colour for bars below zero (default: the loss red). */
  negativeColor?: string
  /** Rows to draw quietly, e.g. fewer than 3 surveys. */
  muted?: (d: D) => boolean
  /** The tag a muted row carries (default "too few to judge"). */
  mutedNote?: string
  note?: (d: D) => string | null | undefined
  referenceLines?: ReferenceLine[]
  xDomain?: [number, number]
  /** Row pitch in px (default 28 beside labels, 40 with labels above). */
  rowHeight?: number
}

/** How far a muted row's bar fades (the legend swatch uses the same figure). */
const MUTED_OPACITY = 0.35

export function BarChart<D>({
  data,
  label,
  labelHeader = 'Group',
  value,
  valueName = 'Value',
  valueFormat = fmtCount,
  valueLabel,
  diverging = false,
  positiveLabel = 'Above zero',
  negativeLabel = 'Below zero',
  color,
  negativeColor,
  muted,
  mutedNote = 'too few to judge',
  note,
  referenceLines = [],
  xDomain,
  rowHeight,
  ariaLabel,
  title,
  info,
  width: fixedWidth,
  emptyMessage,
  onSelect,
  href,
  table: showTableToggle = true,
  tableOpen,
  className,
}: BarChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const interactive = anyDrill(data, onSelect, href)
  const empty = data.length === 0 || data.every((d) => !isNum(value(d)))
  // The value the bar is DRAWN at: one that prints as zero ("$0.00" from a
  // float leftover like −1e-11) is drawn as zero — no sliver, no loss colour.
  const drawnValue = (d: D): number | null => {
    const v = value(d)
    if (!isNum(v)) return null
    return printsAsZero(valueFormat(v)) ? 0 : v
  }

  const posColor = (d: D) =>
    typeof color === 'function' ? color(d) : color ?? (diverging ? 'var(--chart-price)' : 'var(--chart-cat-1)')
  const negColor = (d: D) => negativeColor ?? (diverging ? 'var(--chart-loss)' : posColor(d))
  const tagOf = (d: D) => (muted?.(d) ? mutedNote : null)
  const endText = (d: D) => {
    const v = value(d)
    const custom = valueLabel?.text(d)
    return custom ?? (isNum(v) ? valueFormat(v) : MISSING)
  }

  // Plain computation, not useMemo: it is a pass over a handful of rows, and
  // accessor props are usually inline arrows that would bust any memo anyway.
  const layout = (() => {
    if (empty) return null
    const above = W < 480
    const font = above ? FONT.small : FONT.tick
    const rowH = rowHeight ?? (above ? 40 : 28)
    const refH = referenceLines.length ? 14 : 0
    const top = 4 + refH
    const H = top + data.length * rowH + 4

    let lo = 0
    let hi = 0
    for (const d of data) {
      const v = drawnValue(d)
      if (!isNum(v)) continue
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    for (const r of referenceLines) {
      lo = Math.min(lo, r.value)
      hi = Math.max(hi, r.value)
    }
    // Bars are labelled at their tips, so the domain only needs to hug the
    // data (nice-rounded so the zero line sits somewhere sensible).
    const dom = xDomain ? { min: xDomain[0], max: xDomain[1] } : niceDomain(lo, hi)

    // Label column (beside mode only), capped so the bars keep most of the
    // row. When a name is too long it is the NAME that gets cut, never the
    // "too few to judge" tag after it (TaggedText reserves the tag first).
    const labelW = above ? 0 : Math.min(Math.max(...data.map((d) => taggedWidth(label(d), tagOf(d), FONT.label))) + 10, W * 0.38)

    // Room for the tip labels on each side of zero.
    let posReserve = 0
    let negReserve = 0
    data.forEach((d) => {
      const v = drawnValue(d)
      const w = textWidth(endText(d), font) + 8
      if (isNum(v) && v < 0) negReserve = Math.max(negReserve, w)
      else posReserve = Math.max(posReserve, w)
    })
    const plotL = labelW
    const plotR = W - 2
    // Never let the reserves eat the whole plot: keep at least 30% for bars.
    const minBars = (plotR - plotL) * 0.3
    const spare = plotR - plotL - minBars
    const scaleRes = posReserve + negReserve > spare && spare > 0 ? spare / (posReserve + negReserve) : 1
    const x = linear([dom.min, dom.max], [plotL + negReserve * scaleRes, plotR - posReserve * scaleRes])
    const barH = Math.min(18, above ? 14 : rowH * 0.6)
    return { above, font, rowH, top, H, dom, labelW, plotL, plotR, x, barH }
  })()

  const summary = useMemo(() => {
    if (empty) return ''
    const vals = data.map((d) => ({ d, v: value(d) })).filter((p): p is { d: D; v: number } => isNum(p.v))
    let hiP = vals[0]
    let loP = vals[0]
    for (const p of vals) {
      if (p.v > hiP.v) hiP = p
      if (p.v < loP.v) loP = p
    }
    const n = data.length
    let s = `${n} ${n === 1 ? 'row' : 'rows'}. ${valueName}: highest ${valueFormat(hiP.v)} (${label(hiP.d)})`
    if (vals.length > 1) s += `, lowest ${valueFormat(loP.v)} (${label(loP.d)})`
    s += '.'
    if (diverging) {
      const neg = data.filter((d) => (drawnValue(d) ?? 0) < 0).length
      s += ` ${vals.length - neg} at or above zero, ${neg} below.`
    }
    const mutedCount = muted ? data.filter(muted).length : 0
    if (mutedCount) s += ` ${mutedCount} marked ${mutedNote}.`
    return s
    // drawnValue reads value and valueFormat, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty, data, value, label, valueName, valueFormat, diverging, muted, mutedNote])

  const baseColor = typeof color === 'string' ? color : diverging ? 'var(--chart-price)' : 'var(--chart-cat-1)'
  const legend: LegendItem[] = [
    // Each side is listed only when a bar is on it: a legend must not explain
    // a colour the reader cannot find.
    ...(diverging && data.some((d) => isNum(drawnValue(d)) && (drawnValue(d) as number) >= 0)
      ? [{ key: 'pos', label: positiveLabel, color: baseColor }]
      : []),
    ...(diverging && data.some((d) => (drawnValue(d) ?? 0) < 0)
      ? [{ key: 'neg', label: negativeLabel, color: negativeColor ?? 'var(--chart-loss)' }]
      : []),
    // The swatch is what a faded bar actually looks like (its own colour at
    // the fade), not a grey the reader cannot find on the chart.
    ...(muted && data.some(muted)
      ? [{ key: 'muted', label: `Faded: ${mutedNote}`, color: `color-mix(in oklab, ${baseColor} ${MUTED_OPACITY * 100}%, var(--chart-surface))` }]
      : []),
    ...referenceLines.map((r, i) => ({ key: `ref${i}`, label: r.label, color: r.color ?? 'var(--chart-goal)', shape: 'dash' as const })),
  ]

  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'label', label: labelHeader },
          { key: 'value', label: valueName, align: 'right' },
          ...(valueLabel ? [{ key: 'vl', label: valueLabel.name, align: 'right' as const, title: valueLabel.description }] : []),
          ...(muted || note ? [{ key: 'tag', label: 'Note', title: 'Caveats on this row: why it is faded, and the tooltip note' }] : []),
        ],
        rows: data.map((d, i) => {
          const v = value(d)
          return {
            key: `${i}`,
            muted: !!muted?.(d),
            cells: [
              label(d),
              isNum(v) ? valueFormat(v) : MISSING,
              ...(valueLabel ? [valueLabel.text(d) ?? MISSING] : []),
              ...(muted || note ? [[tagOf(d), note?.(d)].filter(Boolean).join(' · ')] : []),
            ],
            onSelect: onSelect ? () => onSelect(d) : undefined,
            href: href?.(d) ?? null,
          }
        }),
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
      height={layout?.H ?? 120}
      plotRef={ref}
      className={className}
    >
      {layout && (
        <>
          <ChartSvg width={W} height={layout.H} label={ariaLabel} summary={summary} interactive={interactive}>
            {data.map((d, i) => {
              const raw = value(d)
              const v = drawnValue(d)
              const rowY = layout.top + i * layout.rowH
              const isMuted = !!muted?.(d)
              const tag = tagOf(d)
              const barY = layout.above ? rowY + 17 : rowY + (layout.rowH - layout.barH) / 2
              const x0 = layout.x(0)
              const xv = isNum(v) ? layout.x(v) : x0
              const neg = isNum(v) && v < 0
              const text = endText(d)
              const fill = neg ? negColor(d) : posColor(d)
              const rows: TipRow[] = [{ key: 'v', label: valueName, value: isNum(raw) ? valueFormat(raw) : MISSING, color: fill }]
              if (valueLabel) rows.push({ key: 'vl', label: valueLabel.name, value: valueLabel.text(d) ?? MISSING })
              const noteText = [tag, note?.(d)].filter(Boolean).join(' · ')
              const aria = [label(d), `${valueName} ${rows[0].value}`, valueLabel ? `${valueLabel.name} ${rows[1].value}` : null, noteText || null]
                .filter(Boolean)
                .join(', ')
              return (
                <Mark
                  key={i}
                  dataKey={`r${i}`}
                  label={aria}
                  hit={{ x: 0, y: rowY, w: W, h: layout.rowH }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => show({ x: Math.max(xv, x0), y: barY, title: label(d), rows, note: noteText || undefined })}
                  onHide={hide}
                >
                  {/* group label: beside the bar, or above it at phone width */}
                  {layout.above ? (
                    <TaggedText
                      text={label(d)}
                      tag={tag}
                      maxWidth={W - 4}
                      fontSize={FONT.tick}
                      x={2}
                      y={rowY + 8}
                      className={isMuted ? 'fill-muted-foreground' : 'fill-foreground'}
                    />
                  ) : (
                    <TaggedText
                      text={label(d)}
                      tag={tag}
                      maxWidth={layout.labelW - 10}
                      fontSize={FONT.label}
                      x={layout.labelW - 10}
                      y={rowY + layout.rowH / 2}
                      anchor="end"
                      className={isMuted ? 'fill-muted-foreground' : 'fill-foreground'}
                    />
                  )}
                  {isNum(v) && v !== 0 && (
                    <path
                      data-mark="bar"
                      data-sign={neg ? 'neg' : 'pos'}
                      d={roundedBar(Math.min(x0, xv), barY, Math.abs(xv - x0), layout.barH, neg ? 'left' : 'right')}
                      opacity={isMuted ? MUTED_OPACITY : 1}
                      style={{ fill }}
                    />
                  )}
                  <text
                    x={neg ? xv - 5 : xv + 5}
                    y={barY + layout.barH / 2}
                    textAnchor={neg ? 'end' : 'start'}
                    dominantBaseline="central"
                    className={`tabular-nums ${isMuted ? 'fill-muted-foreground' : 'fill-foreground'}`}
                    style={{ fontSize: layout.font, ...HALO }}
                  >
                    {text}
                  </text>
                </Mark>
              )
            })}
            {/* zero line on top of the bars' square ends */}
            <line
              x1={layout.x(0)}
              x2={layout.x(0)}
              y1={layout.top - 2}
              y2={layout.H - 2}
              strokeWidth={diverging || layout.dom.min < 0 ? 1.5 : 1}
              pointerEvents="none"
              style={{ stroke: 'var(--chart-axis)' }}
            />
            {referenceLines.map((r, i) => {
              const rx = layout.x(r.value)
              // Label to the right of its line, or to the left when a line near
              // the right edge would leave no room (rather than cutting it to "…").
              const fitsRight = rx + 3 + textWidth(r.label, FONT.small) <= W - 2
              return (
                <g key={`ref${i}`} pointerEvents="none">
                  <line
                    x1={rx}
                    x2={rx}
                    y1={layout.top - 2}
                    y2={layout.H - 2}
                    strokeWidth={1.5}
                    strokeDasharray="5 4"
                    style={{ stroke: r.color ?? 'var(--chart-goal)' }}
                  />
                  <FitText
                    text={r.label}
                    maxWidth={fitsRight ? W - rx - 4 : Math.max(0, rx - 4)}
                    fontSize={FONT.small}
                    x={fitsRight ? rx + 3 : rx - 3}
                    y={9}
                    anchor={fitsRight ? 'start' : 'end'}
                    className="fill-muted-foreground"
                    halo
                  />
                </g>
              )
            })}
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

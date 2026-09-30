'use client'

/**
 * Two values per row joined by a line — built for Finance "Per respondent"
 * (C4): on ONE set of surveys per route,
 *
 *   left dot   pooled cost per complete bought (a ring)
 *   right dot  pooled cost per qualified respondent (filled)
 *   connector  labelled "QA removed x%" — on the same surveys, the gap
 *              between the two dots IS what QA scrubbed
 *   box        the typical survey: p25–p75 with the median ticked, drawn
 *              around the right dot
 *
 * Panel and blast respondents differ in cost about 60×, so rows can each get
 * their own axis (`independentScales`) instead of squashing the cheap route
 * into a dot at zero. Left unset, rows get their own axes automatically when
 * the biggest row runs more than 10× the smallest.
 */

import { useMemo } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import type { LegendItem } from './Legend'
import { fmtMoney, MISSING, type Formatter } from './format'
import { linear, niceDomain, textWidth } from './scale'
import { ChartSvg, ChartTooltip, FitText, FONT, HALO, Mark, anyDrill, isNum, useTooltip, type TipRow } from './primitives'
import type { ChartCommon } from './types'
import { useChartWidth } from './useChartWidth'

export interface DumbbellBox {
  low: number
  median: number
  high: number
}

/** Rows whose largest values differ by more than this get their own axes. */
const AUTO_INDEPENDENT_RATIO = 10
/** Space kept between the two value labels of a row. */
const LABEL_GAP = 4

export interface DumbbellChartProps<D> extends ChartCommon<D> {
  data: D[]
  label: (d: D) => string
  /** A NARROW form of the name for the drawn row label only. The tooltip,
   *  the accessible summary and the table always use `label`, and the drawn
   *  name carries the full form as its title=. */
  labelShort?: (d: D) => string
  /** Table header for the name column (default "Group"). */
  labelHeader?: string
  start: (d: D) => number | null | undefined
  end: (d: D) => number | null | undefined
  startLabel?: string
  endLabel?: string
  /** Text on the connecting line, e.g. "QA removed 24%". */
  connectorLabel?: (d: D) => string | null | undefined
  /** p25 / median / p75 drawn around the end dot. */
  box?: (d: D) => DumbbellBox | null | undefined
  boxLabel?: string
  valueFormat?: Formatter
  axisFormat?: Formatter
  /** Give every row its own axis (for routes whose costs differ by orders of
   *  magnitude). Unset: automatic, on when row maxima differ by more than 10×. */
  independentScales?: boolean
  /** A sentence under the row label, e.g. "44 surveys". */
  sublabel?: (d: D) => string | null | undefined
  note?: (d: D) => string | null | undefined
}

export function DumbbellChart<D>({
  data,
  label,
  labelShort,
  labelHeader = 'Group',
  start,
  end,
  startLabel = 'Per complete bought',
  endLabel = 'Per qualified respondent',
  connectorLabel,
  box,
  boxLabel = 'Typical study (middle half, median ticked)',
  valueFormat = fmtMoney,
  axisFormat,
  independentScales: independentProp,
  sublabel,
  note,
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
}: DumbbellChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const fmtAxis = axisFormat ?? valueFormat
  const interactive = anyDrill(data, onSelect, href)
  const empty = data.length === 0 || data.every((d) => !isNum(start(d)) && !isNum(end(d)))
  /** What the row PRINTS; `label` is what it says on hover and in the table. */
  const shortOf = (d: D) => labelShort?.(d) ?? label(d)

  const valuesOf = (d: D) => {
    const b = box?.(d)
    return [start(d), end(d), b?.low, b?.high].filter(isNum)
  }
  // On one shared axis a row whose values are 60× smaller is a dot at zero
  // with its two labels on top of each other; the reader learns nothing.
  const independentScales = (() => {
    if (independentProp !== undefined) return independentProp
    const maxima = data.map((d) => Math.max(0, ...valuesOf(d).map(Math.abs))).filter((m) => m > 0)
    return maxima.length > 1 && Math.max(...maxima) > AUTO_INDEPENDENT_RATIO * Math.min(...maxima)
  })()

  // Row: label line (+ sub-line), connector label line, dots, value labels,
  // and — per row, when scales are independent — its own tick line.
  const rowH = 20 + (sublabel ? 12 : 0) + 16 + 20 + 16 + (independentScales ? 16 : 0)
  const sharedAxisH = independentScales ? 0 : 18
  const H = data.length * rowH + sharedAxisH + 4

  const scales = (() => {
    const make = (vals: number[]) => {
      const dom = niceDomain(Math.min(0, ...vals), Math.max(0, ...vals), { count: W < 420 ? 3 : 4 })
      return { dom, x: linear([dom.min, dom.max], [8, W - 8]) }
    }
    if (independentScales) return data.map((d) => make(valuesOf(d)))
    const shared = make(data.flatMap(valuesOf))
    return data.map(() => shared)
  })()

  const summary = useMemo(() => {
    if (empty) return ''
    return data
      .map((d) => {
        const c = connectorLabel?.(d)
        return `${label(d)}: ${startLabel} ${fmtOr(start(d), valueFormat)}, ${endLabel} ${fmtOr(end(d), valueFormat)}${c ? ` (${c})` : ''}`
      })
      .join('; ') + '.'
  }, [empty, data, label, start, end, startLabel, endLabel, connectorLabel, valueFormat])

  const legend: LegendItem[] = [
    { key: 's', label: startLabel, color: 'var(--chart-cost)', shape: 'ring' },
    { key: 'e', label: endLabel, color: 'var(--chart-cost)', shape: 'dot' },
    ...(box ? [{ key: 'b', label: boxLabel, color: 'color-mix(in oklab, var(--chart-cost) 22%, transparent)' }] : []),
  ]

  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'l', label: labelHeader },
          { key: 's', label: startLabel, align: 'right', title: 'The ring on the chart' },
          { key: 'e', label: endLabel, align: 'right', title: 'The filled dot on the chart' },
          ...(connectorLabel ? [{ key: 'c', label: 'Between', align: 'right' as const, title: 'What the gap between the two dots means' }] : []),
          ...(box ? [{ key: 'b', label: 'Typical (p25–median–p75)', align: 'right' as const, title: 'The middle half of individual studies, with the median between' }] : []),
          ...(note ? [{ key: 'n', label: 'Note', title: 'Caveats on this row (the same note the tooltip shows)' }] : []),
        ],
        rows: data.map((d, i) => {
          const b = box?.(d)
          return {
            key: `${i}`,
            cells: [
              label(d),
              fmtOr(start(d), valueFormat),
              fmtOr(end(d), valueFormat),
              ...(connectorLabel ? [connectorLabel(d) ?? MISSING] : []),
              ...(box ? [b ? `${valueFormat(b.low)} – ${valueFormat(b.median)} – ${valueFormat(b.high)}` : MISSING] : []),
              ...(note ? [note(d) ?? ''] : []),
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
      height={H}
      plotRef={ref}
      className={className}
    >
      {!empty && (
        <>
          <ChartSvg width={W} height={H} label={ariaLabel} summary={summary} interactive={interactive}>
            {data.map((d, i) => {
              const top = i * rowH + 2
              const { x, dom } = scales[i]
              const s = start(d)
              const e = end(d)
              const b = box?.(d)
              const c = connectorLabel?.(d)
              const sub = sublabel?.(d)
              const labelY = top + 9
              const connY = top + 20 + (sublabel ? 12 : 0) + 8
              const dotY = connY + 16
              const valY = dotY + 18
              const tickY = valY + 16
              const xs = isNum(s) ? x(s) : null
              const xe = isNum(e) ? x(e) : null
              // Value labels grow AWAY from each other, so two close dots never
              // print on top of one another.
              const startLeft = xs != null && xe != null ? xs <= xe : true
              const rows: TipRow[] = [
                { key: 's', label: startLabel, value: fmtOr(s, valueFormat), color: 'var(--chart-cost)' },
                { key: 'e', label: endLabel, value: fmtOr(e, valueFormat), color: 'var(--chart-cost)' },
              ]
              if (b) rows.push({ key: 'b', label: 'Typical study', value: `${valueFormat(b.low)}–${valueFormat(b.high)} (median ${valueFormat(b.median)})` })
              // Hover carries everything the row shows, including the line
              // under the name — a reader should never have to read both.
              const noteText = [sub, c, note?.(d)].filter(Boolean).join(' · ') || undefined
              const aria = [label(d), ...rows.map((r) => `${r.label} ${r.value}`), noteText].filter(Boolean).join(', ')
              const sText = fmtOr(s, valueFormat)
              const eText = fmtOr(e, valueFormat)
              const lab = placeValueLabels({ xs, xe, sText, eText, startLeft, W })
              return (
                <Mark
                  key={i}
                  dataKey={`d${i}`}
                  label={aria}
                  hit={{ x: 0, y: top - 2, w: W, h: rowH }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => show({ x: xe ?? xs ?? W / 2, y: dotY - 10, title: label(d), rows, note: noteText })}
                  onHide={hide}
                >
                  <FitText text={shortOf(d)} full={label(d)} maxWidth={W - 12} fontSize={FONT.label} x={6} y={labelY} className="fill-foreground" weight={500} />
                  {sub && <FitText text={sub} maxWidth={W - 12} fontSize={FONT.small} x={6} y={labelY + 13} />}
                  {/* typical-survey box around the end dot */}
                  {b && (
                    <g data-mark="box">
                      <rect
                        x={x(b.low)}
                        y={dotY - 8}
                        width={Math.max(2, x(b.high) - x(b.low))}
                        height={16}
                        rx={3}
                        strokeWidth={1}
                        style={{ fill: 'color-mix(in oklab, var(--chart-cost) 14%, transparent)', stroke: 'color-mix(in oklab, var(--chart-cost) 45%, transparent)' }}
                      />
                      <line x1={x(b.median)} x2={x(b.median)} y1={dotY - 8} y2={dotY + 8} strokeWidth={2} style={{ stroke: 'var(--chart-cost)' }} />
                    </g>
                  )}
                  {xs != null && xe != null && (
                    <line x1={xs} x2={xe} y1={dotY} y2={dotY} strokeWidth={2} style={{ stroke: 'var(--chart-axis)' }} />
                  )}
                  {c && (
                    <FitText
                      text={c}
                      maxWidth={W - 8}
                      fontSize={FONT.small}
                      x={Math.min(Math.max(((xs ?? xe ?? 0) + (xe ?? xs ?? 0)) / 2, textWidth(c, FONT.small) / 2 + 2), W - textWidth(c, FONT.small) / 2 - 2)}
                      y={connY}
                      anchor="middle"
                      className="fill-muted-foreground"
                    />
                  )}
                  {xs != null && (
                    <circle data-mark="start" cx={xs} cy={dotY} r={5} strokeWidth={2.5} style={{ fill: 'var(--chart-surface)', stroke: 'var(--chart-cost)' }} />
                  )}
                  {xe != null && (
                    <circle data-mark="end" cx={xe} cy={dotY} r={5.5} strokeWidth={2} style={{ fill: 'var(--chart-cost)', stroke: 'var(--chart-surface)' }} />
                  )}
                  {xs != null && (
                    <text
                      data-label="start"
                      x={lab.sx}
                      y={valY}
                      textAnchor={startLeft ? 'end' : 'start'}
                      dominantBaseline="central"
                      className="fill-muted-foreground tabular-nums"
                      style={{ fontSize: FONT.tick, ...HALO }}
                    >
                      {sText}
                    </text>
                  )}
                  {xe != null && (
                    <text
                      data-label="end"
                      x={lab.ex}
                      y={valY}
                      textAnchor={startLeft ? 'start' : 'end'}
                      dominantBaseline="central"
                      className="fill-foreground tabular-nums"
                      style={{ fontSize: FONT.tick, fontWeight: 600, ...HALO }}
                    >
                      {eText}
                    </text>
                  )}
                  {independentScales && <TickRow dom={dom} x={x} y={tickY} fmt={fmtAxis} W={W} />}
                </Mark>
              )
            })}
            {!independentScales && data.length > 0 && (
              <TickRow dom={scales[0].dom} x={scales[0].x} y={data.length * rowH + 10} fmt={fmtAxis} W={W} />
            )}
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

/**
 * Where a row's two value labels go. They grow AWAY from each other (the
 * left dot's label ends at its dot, the right one's starts at its dot) and
 * are pulled back inside the chart edges. Pulling a label in can push it
 * onto its neighbour — two values near zero on a shared axis — so after the
 * clamp the pair is laid out left to right with a gap, shifting the pair
 * inward from whichever edge it hit.
 */
function placeValueLabels({
  xs,
  xe,
  sText,
  eText,
  startLeft,
  W,
}: {
  xs: number | null
  xe: number | null
  sText: string
  eText: string
  startLeft: boolean
  W: number
}): { sx: number; ex: number } {
  const ws = textWidth(sText, FONT.tick)
  const we = textWidth(eText, FONT.tick)
  // Left label is end-anchored (x = its right edge); right label is
  // start-anchored (x = its left edge).
  const leftX = startLeft ? xs : xe
  const rightX = startLeft ? xe : xs
  const lw = startLeft ? ws : we
  const rw = startLeft ? we : ws
  let lEdge = leftX == null ? null : Math.min(Math.max(leftX, lw + 2), W - 2)
  let rEdge = rightX == null ? null : Math.max(Math.min(rightX, W - rw - 2), 2)
  if (lEdge != null && rEdge != null && rEdge < lEdge + LABEL_GAP) {
    rEdge = lEdge + LABEL_GAP
    if (rEdge + rw > W - 2) {
      rEdge = W - 2 - rw
      lEdge = Math.max(lw + 2, rEdge - LABEL_GAP)
    }
  }
  const l = lEdge ?? 0
  const r = rEdge ?? 0
  return startLeft ? { sx: l, ex: r } : { sx: r, ex: l }
}

/** A hairline axis with nice ticks, thinned so labels never collide. */
function TickRow({
  dom,
  x,
  y,
  fmt,
  W,
}: {
  dom: { ticks: number[] }
  x: (v: number) => number
  y: number
  fmt: Formatter
  W: number
}) {
  const labels = dom.ticks.map(fmt)
  const widest = Math.max(...labels.map((l) => textWidth(l, FONT.small)))
  const slot = dom.ticks.length > 1 ? Math.abs(x(dom.ticks[1]) - x(dom.ticks[0])) : W
  const step = Math.max(1, Math.ceil((widest + 8) / slot))
  return (
    <g pointerEvents="none" aria-hidden>
      <line x1={8} x2={W - 8} y1={y - 8} y2={y - 8} strokeWidth={1} style={{ stroke: 'var(--chart-grid)' }} />
      {dom.ticks.map((t, i) =>
        i % step === 0 ? (
          <text
            key={i}
            x={Math.min(Math.max(x(t), textWidth(labels[i], FONT.small) / 2), W - textWidth(labels[i], FONT.small) / 2)}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground tabular-nums"
            style={{ fontSize: FONT.small }}
          >
            {labels[i]}
          </text>
        ) : null,
      )}
    </g>
  )
}

function fmtOr(v: number | null | undefined, f: Formatter): string {
  return isNum(v) ? f(v) : MISSING
}

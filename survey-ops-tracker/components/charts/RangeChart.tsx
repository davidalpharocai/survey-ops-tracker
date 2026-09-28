'use client'

/**
 * Floating range bars — built for Finance "Per respondent" (C5): each lever
 * ("Stop raising the bid mid-field") as a bar from its low to its high
 * estimate, with a confidence tag (Measured / Depends on others / Direction
 * only) in a slot on the label line.
 *
 * One chart per currency: cost savings and revenue opportunities are
 * different kinds of dollars and must never share an axis or be added up,
 * so the finance page draws two of these. There is no total row by design —
 * the levers overlap.
 *
 * A missing low end means "up to": the bar starts at zero and the label
 * says "up to $4,000". A lever with NEITHER end (below the survey count
 * that makes it callable) draws no bar at all and prints its reason in the
 * bar's place — a bar at $0 would be the missing figure drawn as zero.
 */

import { useMemo } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import type { LegendItem } from './Legend'
import { fmtMoney, MISSING, type Formatter } from './format'
import { linear, niceDomain, roundedBar, textWidth } from './scale'
import { ChartSvg, ChartTooltip, FONT, FitText, HALO, Mark, TaggedText, anyDrill, capFirst, isNum, useTooltip, type TipRow } from './primitives'
import type { ChartCommon } from './types'
import { useChartWidth } from './useChartWidth'

/** How far a muted row's bar fades (the legend swatch uses the same figure). */
const MUTED_OPACITY = 0.4

export interface RangeChartProps<D> extends ChartCommon<D> {
  data: D[]
  label: (d: D) => string
  /** A NARROW form of the name for the drawn row label only. The tooltip,
   *  the accessible summary and the table always use `label`, and the drawn
   *  name carries the full form as its title=. */
  labelShort?: (d: D) => string
  /** Table header for the name column (default "Lever"). */
  labelHeader?: string
  low: (d: D) => number | null | undefined
  high: (d: D) => number | null | undefined
  /** Tag on the label line, e.g. "Measured". */
  confidence?: (d: D) => string | null | undefined
  /** Second line, e.g. what the lever gives up. */
  sublabel?: (d: D) => string | null | undefined
  color?: string | ((d: D) => string)
  /** Fade a row, e.g. "Direction only" levers. The fade is always named:
   *  `mutedNote` is tagged on the row, in the legend and in the table. */
  muted?: (d: D) => boolean
  /** The words a faded row carries (default "less certain"). */
  mutedNote?: string
  /** Why a row with no low and no high figure has no bar, e.g. "too few
   *  surveys here to call" (default "No estimate"). */
  missingText?: (d: D) => string | null | undefined
  valueFormat?: Formatter
  axisFormat?: Formatter
  /** What the dollars are, e.g. "Could save". */
  valueName?: string
  note?: (d: D) => string | null | undefined
}

export function RangeChart<D>({
  data,
  label,
  labelShort,
  labelHeader = 'Lever',
  low,
  high,
  confidence,
  sublabel,
  color = 'var(--chart-keep)',
  muted,
  mutedNote = 'less certain',
  missingText,
  valueFormat = fmtMoney,
  axisFormat,
  valueName = 'Range',
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
}: RangeChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const fmtAxis = axisFormat ?? valueFormat
  const interactive = anyDrill(data, onSelect, href)
  const hasNone = (d: D) => !isNum(high(d)) && !isNum(low(d))
  const empty = data.length === 0 || data.every(hasNone)
  const colorOf = (d: D) => (typeof color === 'function' ? color(d) : color)
  const reasonOf = (d: D) => missingText?.(d) || 'No estimate'
  const tagOf = (d: D) => (muted?.(d) ? mutedNote : null)
  /** What the row PRINTS; `label` is what it says on hover and in the table. */
  const shortOf = (d: D) => labelShort?.(d) ?? label(d)

  const rangeText = (d: D) => {
    const lo = low(d)
    const hi = high(d)
    if (!isNum(hi) && !isNum(lo)) return reasonOf(d)
    if (!isNum(lo)) return `up to ${valueFormat(hi as number)}`
    if (!isNum(hi) || lo === hi) return valueFormat(lo)
    return `${valueFormat(lo)} – ${valueFormat(hi)}`
  }

  const rowH = 22 + (sublabel ? 12 : 0) + 22
  const axisH = 20
  const H = data.length * rowH + axisH + 4

  const scale = useMemo(() => {
    const vals = data.flatMap((d) => [low(d), high(d)]).filter(isNum)
    const dom = niceDomain(Math.min(0, ...vals), Math.max(0, ...vals), { count: W < 420 ? 3 : 5 })
    return { dom, x: linear([dom.min, dom.max], [8, W - 8]) }
  }, [data, low, high, W])

  const summary = (() => {
    if (empty) return ''
    return (
      data
        .map((d) => {
          const c = confidence?.(d)
          const t = tagOf(d)
          return `${label(d)}: ${rangeText(d)}${c ? ` (${c})` : ''}${t ? `, faded: ${t}` : ''}`
        })
        .join('; ') + '.'
    )
  })()

  const legend: LegendItem[] =
    muted && data.some(muted)
      ? [
          {
            key: 'muted',
            label: `Faded: ${mutedNote}`,
            color: `color-mix(in oklab, ${typeof color === 'string' ? color : 'var(--chart-keep)'} ${MUTED_OPACITY * 100}%, var(--chart-surface))`,
            shape: 'range',
          },
        ]
      : []

  const noteOf = (d: D) => [tagOf(d) ? `Faded: ${tagOf(d)}` : null, hasNone(d) ? capFirst(reasonOf(d)) : null, note?.(d)].filter(Boolean).join(' · ')
  const hasNotes = !!note || !!muted || data.some(hasNone)
  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'l', label: labelHeader },
          { key: 'lo', label: 'Low', align: 'right', title: `${valueName}: the low end of the estimate ($0 when only an "up to" figure exists)` },
          { key: 'hi', label: 'High', align: 'right', title: `${valueName}: the high end of the estimate` },
          ...(confidence ? [{ key: 'c', label: 'Confidence', title: 'How firm the estimate is' }] : []),
          ...(hasNotes ? [{ key: 'n', label: 'Note', title: 'Why a row is faded or has no figure, and any other caveat' }] : []),
        ],
        rows: data.map((d, i) => ({
          key: `${i}`,
          muted: !!muted?.(d),
          cells: [
            sublabel?.(d) ? `${label(d)} (${sublabel(d)})` : label(d),
            isNum(low(d)) ? valueFormat(low(d) as number) : isNum(high(d)) ? valueFormat(0) : MISSING,
            isNum(high(d)) ? valueFormat(high(d) as number) : MISSING,
            ...(confidence ? [confidence(d) ?? MISSING] : []),
            ...(hasNotes ? [noteOf(d)] : []),
          ],
          onSelect: onSelect ? () => onSelect(d) : undefined,
          href: href?.(d) ?? null,
        })),
      }
    : null

  const tickLabels = scale.dom.ticks.map(fmtAxis)
  const widest = Math.max(0, ...tickLabels.map((l) => textWidth(l, FONT.small)))
  const slot = scale.dom.ticks.length > 1 ? Math.abs(scale.x(scale.dom.ticks[1]) - scale.x(scale.dom.ticks[0])) : W
  const tickStep = Math.max(1, Math.ceil((widest + 8) / slot))

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
              const lo = low(d)
              const hi = high(d)
              const none = !isNum(lo) && !isNum(hi)
              const a = isNum(lo) ? lo : 0
              const b = isNum(hi) ? hi : a
              const xa = scale.x(Math.min(a, b))
              const xb = scale.x(Math.max(a, b))
              const c = confidence?.(d)
              const sub = sublabel?.(d)
              const isMuted = !!muted?.(d)
              const tag = tagOf(d)
              const fill = colorOf(d)
              const text = rangeText(d)
              const cW = c ? textWidth(c, FONT.small) + 14 : 0
              const barY = top + 22 + (sub ? 12 : 0) + 2
              const barH = 12
              const tw = textWidth(text, FONT.tick)
              // The range label sits after the bar; before it when the bar runs
              // to the right edge; inside it when the bar spans the whole axis
              // (a $0–max lever). It is never pushed off the chart.
              const barEnd = xa + Math.max(barH, xb - xa)
              const place: 'after' | 'before' | 'inside' =
                barEnd + 6 + tw <= W - 2 ? 'after' : xa - 6 - tw >= 0 ? 'before' : barEnd - xa >= tw + 12 ? 'inside' : 'after'
              const labelX = place === 'after' ? barEnd + 6 : place === 'before' ? xa - 6 : barEnd - 6
              const rows: TipRow[] = [{ key: 'r', label: valueName, value: text, color: none ? undefined : fill }]
              if (c) rows.push({ key: 'c', label: 'Confidence', value: c })
              // Hover carries everything the row shows, including the line
              // under the name — a reader should never have to read both.
              const noteText = [sub, tag ? `Faded: ${tag}` : null, note?.(d)].filter(Boolean).join(' · ') || undefined
              const aria = [label(d), `${valueName} ${text}`, c ? `confidence ${c}` : null, noteText].filter(Boolean).join(', ')
              return (
                <Mark
                  key={i}
                  dataKey={`g${i}`}
                  label={aria}
                  hit={{ x: 0, y: top - 2, w: W, h: rowH }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => show({ x: none ? W / 2 : xb, y: barY, title: label(d), rows, note: noteText })}
                  onHide={hide}
                >
                  <TaggedText
                    text={shortOf(d)}
                    full={label(d)}
                    tag={tag}
                    maxWidth={W - cW - 14}
                    fontSize={FONT.label}
                    x={6}
                    y={top + 9}
                    className={isMuted ? 'fill-muted-foreground' : 'fill-foreground'}
                    weight={500}
                  />
                  {c && (
                    <g data-mark="confidence">
                      <rect
                        x={W - cW}
                        y={top + 1}
                        width={cW - 2}
                        height={16}
                        rx={8}
                        strokeWidth={1}
                        style={{ fill: 'var(--chart-surface)', stroke: 'var(--border)' }}
                      />
                      <text x={W - cW / 2 - 1} y={top + 9} textAnchor="middle" dominantBaseline="central" className="fill-muted-foreground" style={{ fontSize: FONT.small }}>
                        {c}
                      </text>
                    </g>
                  )}
                  {sub && <FitText text={sub} maxWidth={W - 12} fontSize={FONT.small} x={6} y={top + 23} />}
                  {/* gridlines only through the bar strip, so they never cross the label text */}
                  {scale.dom.ticks.map((t, ti) => (
                    <line
                      key={`g${ti}`}
                      x1={scale.x(t)}
                      x2={scale.x(t)}
                      y1={barY - 4}
                      y2={barY + barH + 4}
                      strokeWidth={t === 0 ? 1.5 : 1}
                      style={{ stroke: t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)' }}
                    />
                  ))}
                  {none ? (
                    // No figure: an empty track and the reason, never a bar at $0.
                    <FitText
                      text={text}
                      maxWidth={W - 16}
                      fontSize={FONT.tick}
                      x={scale.x(Math.max(scale.dom.min, 0)) + 6}
                      y={barY + barH / 2}
                      className="fill-muted-foreground italic"
                      halo
                    />
                  ) : (
                    <>
                      <path
                        data-mark="range"
                        d={roundedBar(xa, barY, Math.max(barH, xb - xa), barH, 'both-h', 6)}
                        opacity={isMuted ? MUTED_OPACITY : 1}
                        style={{ fill }}
                      />
                      <text
                        x={Math.min(labelX, W - 2)}
                        y={barY + barH / 2}
                        textAnchor={place === 'after' ? 'start' : 'end'}
                        dominantBaseline="central"
                        className={`tabular-nums ${
                          place === 'inside' ? (isMuted ? 'fill-foreground' : '') : isMuted ? 'fill-muted-foreground' : 'fill-foreground'
                        }`}
                        style={
                          // Inside a solid bar the text flips to the on-fill colour; a
                          // faded bar is pale enough that ink reads better.
                          place === 'inside'
                            ? { fontSize: FONT.small, fontWeight: 600, fill: isMuted ? undefined : 'var(--chart-on-strong)' }
                            : { fontSize: FONT.tick, ...HALO }
                        }
                      >
                        {text}
                      </text>
                    </>
                  )}
                </Mark>
              )
            })}
            <g pointerEvents="none" aria-hidden>
              {scale.dom.ticks.map((t, i) =>
                i % tickStep === 0 ? (
                  <text
                    key={`t${i}`}
                    x={Math.min(Math.max(scale.x(t), textWidth(tickLabels[i], FONT.small) / 2), W - textWidth(tickLabels[i], FONT.small) / 2)}
                    y={data.length * rowH + 12}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-muted-foreground tabular-nums"
                    style={{ fontSize: FONT.small }}
                  >
                    {tickLabels[i]}
                  </text>
                ) : null,
              )}
            </g>
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

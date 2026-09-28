'use client'

/**
 * A grid of coloured cells — rows × columns, one value per cell.
 *
 * Built for Finance "Improve":
 *   - C6 coverage: rows = fields (cost, client price, post-QA N, …), columns
 *     = months + Undated, cell = % of delivered surveys carrying the field,
 *     with labelled vertical rules ("costs reliable from here"). Click a cell
 *     to list the surveys missing that field (a 100% cell has none, so `href`
 *     may return null for it and that one cell simply does not drill).
 *   - Supplier price drift: rows = panels, columns = launch months, colour =
 *     CPI, and a WEIGHT (completes) drawn as a short bar at the foot of the
 *     cell, so a price resting on few respondents is visible as such.
 *
 * WHY THE WEIGHT IS A BAR, NOT PALENESS: the colour scale already works by
 * mixing toward the surface, so fading a cell for "few completes" moves it
 * along the SAME lightness channel — the most expensive cell on 60 completes
 * drew as pale as a cheap one. Each channel now says one thing: lightness is
 * the value, the bar's length is the weight.
 *
 * Colour scales:
 *   sequential  one hue, light → strong (magnitude)
 *   diverging   two hues around a neutral grey midpoint (above/below a line)
 * A cell with no value is the grey hatch, never the lightest colour — "no
 * data" and "zero" must not look alike.
 *
 * Keyboard: when cells drill, the grid is ONE tab stop and the arrow keys
 * move between cells (Home/End to the row ends), instead of 60+ tab stops.
 */

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChartFrame, DRILL_CONTROL_CLASS, type ChartTable } from './ChartFrame'
import { Rules } from './ColumnChart'
import type { LegendItem } from './Legend'
import { fmtCount, MISSING, type Formatter } from './format'
import { clamp, fitAxisLabels, labelStep, textWidth } from './scale'
import { contrast, mixRgb, useResolvedColors } from './color'
import {
  CategoryTicks,
  ChartSvg,
  ChartTooltip,
  FitText,
  FONT,
  HatchDef,
  Mark,
  describeRules,
  isNum,
  printsAsZero,
  useSvgId,
  useTooltip,
  type TipRow,
} from './primitives'
import type { CategoryRule, ChartCommon } from './types'
import { useChartWidth } from './useChartWidth'

/** Opacity of columns outside `highlight`: visibly quieter, still readable. */
const DIM = 0.6
/** Narrowest cell drawn; below it the row-label column gives up room first. */
const MIN_CELL = 8
/** The row-label column never shrinks below this (labels are cut, with a <title>). */
const MIN_ROW_LABEL = 36
/** Space reserved at a cell's foot for the weight bar. */
const WEIGHT_BAR = 5

export interface HeatAxisItem {
  key: string
  label: string
  /** Used when the full label does not fit a column (e.g. "Und." for "Undated"). */
  shortLabel?: string
  description?: string
}

export interface HeatCell {
  row: string
  col: string
  value: number | null | undefined
  /** Optional second measure, e.g. completes: drawn as a bar at the cell's foot. */
  weight?: number | null
}

export interface HeatmapProps<C extends HeatCell> extends Omit<ChartCommon<C>, 'height'> {
  rows: HeatAxisItem[]
  columns: HeatAxisItem[]
  cells: C[]
  scale?: 'sequential' | 'diverging'
  /** Value range for the colour scale (default: the data's min..max). */
  domain?: [number, number]
  /** Diverging midpoint (default 0). */
  midpoint?: number
  /** Sequential hue / the high arm of a diverging scale (default teal). */
  color?: string
  /** The low arm of a diverging scale (default the loss red). */
  negativeColor?: string
  valueFormat?: Formatter
  /** Text inside the cell (default the formatted value). Printed in every
   *  cell or in none: when the widest does not fit, all cell text is hidden. */
  cellLabel?: (c: C) => string | null | undefined
  valueName?: string
  /** Name of the weight, e.g. "Completes". Turns on the weight bar. */
  weightName?: string
  weightFormat?: Formatter
  /** Vertical rules before a column key. */
  rules?: CategoryRule[]
  /** Column keys to emphasise (e.g. the months the date filter selects). */
  highlight?: string[]
  /** Table header for the row column (default "Row"). */
  rowHeader?: string
  note?: (c: C) => string | null | undefined
  /** Cell height in px (default 30, 26 on phones). */
  cellHeight?: number
}

export function Heatmap<C extends HeatCell>({
  rows,
  columns,
  cells,
  scale = 'sequential',
  domain,
  midpoint = 0,
  color = 'var(--chart-price)',
  negativeColor = 'var(--chart-loss)',
  valueFormat = fmtCount,
  cellLabel,
  valueName = 'Value',
  weightName,
  weightFormat = fmtCount,
  rules = [],
  highlight,
  rowHeader = 'Row',
  note,
  cellHeight,
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
}: HeatmapProps<C>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const hatchId = useSvgId('hatch')
  const [focusIdx, setFocusIdx] = useState(0)
  const cellEls = useRef(new Map<number, HTMLElement | SVGElement>())

  const byKey = useMemo(() => {
    const m = new Map<string, C>()
    for (const c of cells) m.set(`${c.row}\u0000${c.col}`, c)
    return m
  }, [cells])
  const cellAt = (r: string, c: string) => byKey.get(`${r}\u0000${c}`)

  const empty = rows.length === 0 || columns.length === 0 || !cells.some((c) => isNum(c.value))

  // Drillability is decided PER CELL, from what onSelect / href give that
  // cell — not from whether the props exist. A cell whose href is null (a
  // 100% coverage cell has no missing surveys to list) and with no onSelect
  // is a plain cell: no tab stop, no dead button in the table.
  const urlOf = (c: C | undefined) => (c && href ? href(c) || null : null)
  const canDrill = (c: C | undefined): c is C => !!c && (!!onSelect || !!urlOf(c))
  const flat = rows.flatMap((r) => columns.map((c) => ({ r, c, cell: cellAt(r.key, c.key) })))
  const drillable = flat.map(({ cell }) => canDrill(cell))
  const interactive = drillable.some(Boolean)

  const stats = useMemo(() => {
    const vals = cells.map((c) => c.value).filter(isNum)
    const ws = cells.map((c) => c.weight).filter(isNum)
    const lo = domain?.[0] ?? (vals.length ? Math.min(...vals) : 0)
    const hi = domain?.[1] ?? (vals.length ? Math.max(...vals) : 1)
    return { lo, hi, minW: ws.length ? Math.min(...ws) : null, maxW: ws.length ? Math.max(...ws) : null }
  }, [cells, domain])
  const weighted = !!weightName && !!stats.maxW && stats.maxW > 0

  /** 0..1 strength of a value and which arm colours it. */
  const strength = (v: number): { t: number; arm: 'hi' | 'lo' | 'mid' } => {
    const { lo, hi } = stats
    if (scale === 'diverging') {
      // A value that prints as zero sits on a zero midpoint: a −0.0001 float
      // leftover must not tint a "0%" cell red.
      if (v === midpoint || (midpoint === 0 && printsAsZero(valueFormat(v)))) return { t: 0, arm: 'mid' }
      if (v > midpoint) return { t: hi > midpoint ? clamp((v - midpoint) / (hi - midpoint), 0, 1) : 1, arm: 'hi' }
      return { t: lo < midpoint ? clamp((midpoint - v) / (midpoint - lo), 0, 1) : 1, arm: 'lo' }
    }
    // Every value the same (no domain given): there is no "stronger" cell, so
    // paint them all strong, except a grid of zeros, which must read as
    // empty (0% coverage painted full teal would say the opposite).
    if (!(hi > lo)) return { t: v === 0 ? 0 : 1, arm: 'hi' }
    return { t: clamp((v - lo) / (hi - lo), 0, 1), arm: 'hi' }
  }
  const fillOf = (v: number) => {
    const { t, arm } = strength(v)
    if (arm === 'mid') return 'var(--chart-neutral)'
    const hue = arm === 'hi' ? color : negativeColor
    // Mix toward the card surface, so the scale works in light AND dark mode
    // (pale on light, dim on dark) without a second palette.
    return `color-mix(in oklab, ${hue} ${Math.round(10 + t * 90)}%, var(--chart-surface))`
  }
  // Ink or on-fill text? Measured against the cell's real final colour
  // (token hue mixed toward the surface, then faded by the highlight
  // dimming), so it is right in both themes and for pale hues.
  const [rHi, rLo, rSurface, rInk, rOnFill, rMid] = useResolvedColors(ref, [
    color,
    negativeColor,
    'var(--chart-surface)',
    'var(--foreground)',
    'var(--chart-on-strong)',
    'var(--chart-neutral)',
  ])
  const textOnFill = (v: number, dim: boolean) => {
    const { t, arm } = strength(v)
    const hue = arm === 'hi' ? rHi : arm === 'lo' ? rLo : rMid
    if (hue && rSurface && rInk && rOnFill) {
      let fill = arm === 'mid' ? hue : mixRgb(hue, rSurface, (10 + t * 90) / 100)
      if (dim) fill = mixRgb(fill, rSurface, DIM)
      return contrast(rOnFill, fill) > contrast(rInk, fill)
    }
    // Colours not resolvable (server render, tests): the strength heuristic.
    return arm !== 'mid' && t * (dim ? DIM : 1) >= 0.55
  }

  const textOf = (cell: C | undefined) => (cell && isNum(cell.value) ? cellLabel?.(cell) ?? valueFormat(cell.value) : MISSING)

  // Plain computation, not useMemo: it reads the cell texts (accessor props,
  // usually inline arrows that would bust a memo anyway) and is cheap.
  const layout = (() => {
    const narrow = W < 480
    const font = narrow ? FONT.small : FONT.tick
    const nC = Math.max(1, columns.length)
    const maxRowLabel = Math.max(0, ...rows.map((r) => textWidth(r.label, FONT.label)))
    let rowLabelW = Math.max(56, Math.min(maxRowLabel + 12, W * (narrow ? 0.34 : 0.26)))
    const cellWFor = (labelW: number) => (W - labelW - 2) / nC

    // Cell text is shown in EVERY cell or in none. Deciding per cell blanked
    // exactly the strongest cells ("100%" is the widest label) while the
    // weak "45%" cells kept theirs. If the widest label does not fit, the
    // row labels (which are cut with a full-text <title>) give up room
    // first, down to a fifth of the width; past that, cell text is hidden.
    // textWidth over-estimates a little, so a 5px pad (2 of cell gap, 3 of
    // air) is enough: the cell width a label needs.
    const widestCell = Math.max(0, ...flat.map(({ cell }) => textWidth(textOf(cell), FONT.small)))
    const labelNeed = widestCell + 5
    if (cellWFor(rowLabelW) < labelNeed) {
      const squeezed = W - 2 - nC * labelNeed
      if (squeezed >= Math.max(48, W * 0.2)) rowLabelW = Math.min(rowLabelW, squeezed)
    }
    // Never let the grid run past the SVG (it clips): with many columns the
    // row labels shrink, and past their floor the cells go under MIN_CELL.
    if (cellWFor(rowLabelW) < MIN_CELL) rowLabelW = Math.max(MIN_ROW_LABEL, Math.min(rowLabelW, W - 2 - nC * MIN_CELL))
    const cellW = Math.max(1, cellWFor(rowLabelW))
    const showCellText = cellW + 1e-6 >= labelNeed // (float slack after the squeeze)

    const rulesH = rules.length * 14
    const headerH = 18
    const gridTop = 4 + rulesH + headerH
    const cellH = cellHeight ?? (narrow ? 26 : 30)
    const H = gridTop + rows.length * cellH + 4
    // Full column labels if they fit, else the short ones, else thin them —
    // and the thinning pins BOTH ENDS and shrinks a step before it drops
    // anything (fitAxisLabels), the same rule the column charts follow.
    // Walking `i % step` from the left used to leave the NEWEST month unnamed
    // whenever the column count was even, which on a grid that draws every
    // month with delivered work is most of the time.
    const full = columns.map((c) => c.label)
    const short = columns.map((c) => c.shortLabel ?? c.label)
    const useShort = labelStep(full, cellW, font) > 1
    const headLabels = useShort ? short : full
    const head = fitAxisLabels(headLabels, cellW, font, { minFontSize: FONT.small })
    const headKept = new Set(head.picks)
    return {
      narrow, font, rowLabelW, rulesH, gridTop, cellW, cellH, H, headLabels, showCellText,
      headFont: head.fontSize,
      headShows: (ci: number) => headKept.has(ci),
      headRoom: (ci: number) => head.rooms[ci] ?? cellW,
      plotBottom: gridTop + rows.length * cellH, plotL: rowLabelW, band: cellW, tickFont: font,
    }
  })()

  const summary = useMemo(() => {
    if (empty) return ''
    const present = cells.filter((c): c is C & { value: number } => isNum(c.value))
    let hiC = present[0]
    let loC = present[0]
    for (const c of present) {
      if (c.value > hiC.value) hiC = c
      if (c.value < loC.value) loC = c
    }
    const name = (c: C) => `${rows.find((r) => r.key === c.row)?.label ?? c.row} · ${columns.find((k) => k.key === c.col)?.label ?? c.col}`
    const missing = rows.length * columns.length - present.length
    let s = `${rows.length} rows by ${columns.length} columns. Highest ${valueFormat(hiC.value)} (${name(hiC)}), lowest ${valueFormat(loC.value)} (${name(loC)}). ${missing} ${missing === 1 ? 'cell has' : 'cells have'} no data.`
    if (weightName && stats.minW != null && stats.maxW != null) {
      s += ` ${weightName} from ${weightFormat(stats.minW)} to ${weightFormat(stats.maxW)} per cell.`
    }
    const ruleText = describeRules(rules, columns.map((c) => c.key), columns.map((c) => c.label))
    if (ruleText.length) s += ` Marked: ${ruleText.join('; ')}.`
    return s
  }, [empty, cells, rows, columns, valueFormat, weightName, weightFormat, stats, rules])

  const legendExtra = (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="tabular-nums">{valueFormat(stats.lo)}</span>
      <span
        aria-hidden
        className="inline-block h-2.5 w-20 rounded-[2px]"
        style={{
          background:
            scale === 'diverging'
              ? `linear-gradient(to right, ${negativeColor}, var(--chart-neutral), ${color})`
              : `linear-gradient(to right, color-mix(in oklab, ${color} 10%, var(--chart-surface)), ${color})`,
        }}
      />
      <span className="tabular-nums">{valueFormat(stats.hi)}</span>
      <span className="sr-only">{valueName} colour scale</span>
    </span>
  )
  const legend: LegendItem[] = [
    { key: 'none', label: 'No data', shape: 'hatch' },
    ...(weighted
      ? [
          {
            key: 'w',
            label: `Line under each cell: ${weightName!.toLowerCase()} (a full line = ${weightFormat(stats.maxW!)})`,
            color: 'var(--foreground)',
            shape: 'range' as const,
          },
        ]
      : []),
  ]

  const firstDrillable = drillable.indexOf(true)
  const tabStop = drillable[focusIdx] ? focusIdx : firstDrillable
  const moveFocus = (e: KeyboardEvent<Element>, idx: number) => {
    const nC = columns.length
    const nR = rows.length
    const row = Math.floor(idx / nC)
    const col = idx % nC
    // Walk in the key's direction to the next cell that can take focus.
    const walk = (dr: number, dc: number) => {
      let r = row + dr
      let c = col + dc
      while (r >= 0 && r < nR && c >= 0 && c < nC) {
        const i = r * nC + c
        if (drillable[i]) return i
        r += dr
        c += dc
      }
      return idx
    }
    let next: number
    if (e.key === 'ArrowRight') next = walk(0, 1)
    else if (e.key === 'ArrowLeft') next = walk(0, -1)
    else if (e.key === 'ArrowDown') next = walk(1, 0)
    else if (e.key === 'ArrowUp') next = walk(-1, 0)
    else if (e.key === 'Home') next = drillable.slice(row * nC, row * nC + nC).indexOf(true) + row * nC
    else if (e.key === 'End') next = row * nC + drillable.slice(row * nC, row * nC + nC).lastIndexOf(true)
    else return
    e.preventDefault()
    setFocusIdx(next)
    cellEls.current.get(next)?.focus()
  }

  const weightText = (cell: C | undefined) =>
    weightName && cell && isNum(cell.weight) ? `${weightFormat(cell.weight)} ${weightName.toLowerCase()}` : null

  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: '__row', label: rowHeader },
          ...columns.map((c) => ({
            key: c.key,
            label: c.label,
            align: 'right' as const,
            title: c.description ?? (weightName ? `${valueName}, then ${weightName.toLowerCase()} behind it` : valueName),
          })),
        ],
        rows: rows.map((r) => ({
          key: r.key,
          cells: [
            r.label,
            ...columns.map((c) => {
              const cell = cellAt(r.key, c.key)
              const has = !!cell && isNum(cell.value)
              const text = has ? valueFormat(cell!.value as number) : MISSING
              // The table lists every number the chart draws, weight and
              // caveat included — the tooltip must not be the only way to them.
              const w = weightText(cell)
              const noteText = cell ? note?.(cell) : null
              const extra: ReactNode = (
                <>
                  {w && <span className="text-muted-foreground"> · {w}</span>}
                  {noteText && <span className="block text-[11px] text-muted-foreground">{noteText}</span>}
                </>
              )
              if (!canDrill(cell)) {
                return (
                  <span key={c.key}>
                    {text}
                    {extra}
                  </span>
                )
              }
              const url = urlOf(cell)
              const name = `${r.label}, ${c.label}: ${has ? text : 'No data'}${w ? `, ${w}` : ''}`
              return (
                <span key={c.key}>
                  {url ? (
                    <a
                      href={url}
                      aria-label={name}
                      className={DRILL_CONTROL_CLASS}
                      onClick={(e) => {
                        if (onSelect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
                          e.preventDefault()
                          onSelect(cell)
                        }
                      }}
                    >
                      {text}
                    </a>
                  ) : (
                    <button type="button" aria-label={name} className={DRILL_CONTROL_CLASS} onClick={() => onSelect?.(cell)}>
                      {text}
                    </button>
                  )}
                  {extra}
                </span>
              )
            }),
          ],
        })),
      }
    : null

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      title={title}
      info={info}
      legend={legend}
      legendExtra={legendExtra}
      table={table}
      tableOpen={tableOpen}
      empty={empty}
      emptyMessage={emptyMessage}
      height={layout.H}
      plotRef={ref}
      className={className}
    >
      {!empty && (
        <>
          <ChartSvg width={W} height={layout.H} label={ariaLabel} summary={summary} interactive={interactive}>
            <HatchDef id={hatchId} />
            {/* column headers. `full` is the long month, so a header the
                grid had to shorten ("Oct 25") still hovers to "October 2025",
                the way every other shortened label now does. */}
            {columns.map((c, ci) =>
              layout.headShows(ci) ? (
                <FitText
                  key={c.key}
                  text={layout.headLabels[ci]}
                  full={c.label}
                  maxWidth={layout.headRoom(ci)}
                  fontSize={layout.headFont}
                  x={headX(layout.rowLabelW + layout.cellW * (ci + 0.5), textWidth(layout.headLabels[ci], layout.headFont), W)}
                  y={layout.gridTop - 9}
                  anchor="middle"
                  weight={highlight?.includes(c.key) ? 600 : undefined}
                  className={highlight?.includes(c.key) ? 'fill-foreground' : 'fill-muted-foreground'}
                />
              ) : null,
            )}
            {/* a tick per column, so a month whose name had to be thinned
                away still leaves a mark above its column of cells */}
            <CategoryTicks
              at={columns.map((_, ci) => layout.rowLabelW + layout.cellW * (ci + 0.5))}
              base={layout.gridTop}
              labelled={(ci) => layout.headShows(ci)}
              size={-3}
            />
            {/* row labels */}
            {rows.map((r, ri) => (
              <FitText
                key={r.key}
                text={r.label}
                maxWidth={layout.rowLabelW - 10}
                fontSize={layout.narrow ? FONT.tick : FONT.label}
                x={layout.rowLabelW - 8}
                y={layout.gridTop + layout.cellH * (ri + 0.5)}
                anchor="end"
                className="fill-foreground"
              />
            ))}
            {flat.map(({ r, c, cell }, idx) => {
              const v = cell?.value
              const has = isNum(v)
              const ci = idx % columns.length
              const ri = Math.floor(idx / columns.length)
              const cx = layout.rowLabelW + layout.cellW * ci
              const cy = layout.gridTop + layout.cellH * ri
              const dim = !!highlight && highlight.length > 0 && !highlight.includes(c.key)
              const text = textOf(cell)
              const strong = has ? textOnFill(v, dim) : false
              const barW = layout.cellW - 6
              // No weight bar on a no-data cell: the hatch must read as "nothing here".
              const wFrac = weighted && has && cell && isNum(cell.weight) && barW >= 6 ? clamp(cell.weight / stats.maxW!, 0, 1) : null
              const rowsTip: TipRow[] = [{ key: 'v', label: valueName, value: has ? valueFormat(v) : 'No data' }]
              if (weightName) rowsTip.push({ key: 'w', label: weightName, value: cell && isNum(cell.weight) ? weightFormat(cell.weight) : MISSING })
              const noteText = cell ? note?.(cell) ?? undefined : undefined
              const aria = [`${r.label}, ${c.label}`, ...rowsTip.map((t) => `${t.label} ${t.value}`), noteText].filter(Boolean).join(', ')
              const shape = (
                <g opacity={dim ? DIM : 1}>
                  <rect
                    data-mark="cell"
                    data-empty={has ? undefined : 'true'}
                    x={cx + 1}
                    y={cy + 1}
                    width={Math.max(0, layout.cellW - 2)}
                    height={Math.max(0, layout.cellH - 2)}
                    rx={3}
                    style={{ fill: has ? fillOf(v) : `url(#${hatchId})` }}
                  />
                  {wFrac != null && (
                    // A surface-coloured track with an ink bar in it, so the
                    // weight reads the same on a pale cell and a strong one.
                    <g data-mark="weight">
                      <rect x={cx + 3} y={cy + layout.cellH - WEIGHT_BAR - 1} width={barW} height={3} rx={1.5} style={{ fill: 'var(--chart-surface)' }} />
                      <rect
                        data-part="weight-bar"
                        x={cx + 3}
                        y={cy + layout.cellH - WEIGHT_BAR - 1}
                        width={Math.max(1, barW * wFrac)}
                        height={3}
                        rx={1.5}
                        opacity={0.75}
                        style={{ fill: 'var(--foreground)' }}
                      />
                    </g>
                  )}
                  {layout.showCellText && (
                    <text
                      x={cx + layout.cellW / 2}
                      y={cy + layout.cellH / 2 - (wFrac != null ? 2 : 0)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className={`tabular-nums ${strong ? '' : has ? 'fill-foreground' : 'fill-muted-foreground'}`}
                      style={{ fontSize: FONT.small, fill: strong ? 'var(--chart-on-strong)' : undefined }}
                    >
                      {text}
                    </text>
                  )}
                </g>
              )
              const drills = drillable[idx]
              return (
                <Mark
                  key={`${r.key}-${c.key}`}
                  dataKey={`${r.key}|${c.key}`}
                  label={aria}
                  hit={{ x: cx, y: cy, w: layout.cellW, h: layout.cellH }}
                  onSelect={drills && onSelect ? () => onSelect(cell!) : undefined}
                  href={drills ? urlOf(cell) : undefined}
                  tabIndex={drills ? (idx === tabStop ? 0 : -1) : undefined}
                  onKeyDown={drills ? (e) => moveFocus(e, idx) : undefined}
                  elRef={
                    drills
                      ? (el) => {
                          if (el) cellEls.current.set(idx, el)
                          else cellEls.current.delete(idx)
                        }
                      : undefined
                  }
                  onShow={() => {
                    if (drills) setFocusIdx(idx)
                    show({ x: cx + layout.cellW / 2, y: cy, title: `${r.label} · ${c.label}`, rows: rowsTip, note: noteText })
                  }}
                  onHide={hide}
                >
                  {shape}
                </Mark>
              )
            })}
            <Rules rules={rules} keys={columns.map((c) => c.key)} layout={layout} W={W} />
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

/**
 * Where a column header is actually drawn: its column's centre, pulled inside
 * the SVG when half the label would hang past an edge.
 *
 * The grid fills the full width, so the outermost headers are centred barely
 * half a cell from the edge and the viewBox would cut them. A header nudged a
 * few pixels still names its column (the tick row marks the true centre, and
 * the cell's own tooltip repeats it); a cut one is a guess.
 */
function headX(centre: number, labelWidth: number, width: number): number {
  const half = labelWidth / 2
  if (labelWidth >= width) return centre
  return Math.min(Math.max(centre, half), width - half)
}

'use client'

/**
 * One bullet bar per row — built for Finance "This week" (C3): each live
 * survey's spend against what it is worth.
 *
 *   track      $0 → contract value (price × target), tinted teal = "the price"
 *   end cap    a teal cap at the contract value
 *   bar        spend so far, navy = "our cost"; anything past the contract
 *              value turns red, because that part is money lost
 *   budget     an ink tick: the cost ceiling we set
 *   goal       an amber tick: the 50%-of-price guide (a starting goal, not a rule)
 *   progress   a thin second bar: N collected against the N target
 *
 * Each row has its OWN scale (a $5,000 survey and a $50,000 one are judged
 * against themselves, not against each other). A row with no contract value
 * (no price, or no target: `missingMax` says which) or a $0 price ("given
 * away") has its track drawn as the grey hatch and shows spend against
 * budget only. A $0 price is never divided by and never counted as an overrun.
 */

import { useMemo } from 'react'
import { ChartFrame, type ChartTable } from './ChartFrame'
import type { LegendItem } from './Legend'
import { fmtCount, fmtMoney, fmtPct, MISSING, type Formatter } from './format'
import { linear, roundedBar, textWidth } from './scale'
import { ChartSvg, ChartTooltip, FitText, FONT, HatchDef, Mark, anyDrill, capFirst, isNum, useSvgId, useTooltip, type TipRow } from './primitives'
import type { ChartCommon } from './types'
import { useChartWidth } from './useChartWidth'

export interface BulletProgress {
  value: number
  target: number
}

export interface BulletChartProps<D> extends ChartCommon<D> {
  data: D[]
  label: (d: D) => string
  /** Table header for the name column (default "Survey"). */
  labelHeader?: string
  /** Second line under the label, e.g. "BAM · Fielding". */
  sublabel?: (d: D) => string | null | undefined
  /** Spend so far. */
  value: (d: D) => number | null | undefined
  /** Contract value (price × target): the end of the scale. Null = no
   *  contract value (see `missingMax`); 0 = a $0 price, "given away". */
  max?: (d: D) => number | null | undefined
  /** Why a row has no contract value, in lower case (default "no price").
   *  The contract value is price × target, so a priced survey with no target
   *  should say "no target", not "no price". */
  missingMax?: (d: D) => string
  budget?: (d: D) => number | null | undefined
  /** The goal tick, e.g. 50% of the contract value. */
  goal?: (d: D) => number | null | undefined
  progress?: (d: D) => BulletProgress | null | undefined
  valueFormat?: Formatter
  progressFormat?: Formatter
  /** Legend / tooltip names. */
  names?: Partial<Record<'value' | 'max' | 'budget' | 'goal' | 'progress', string>>
  note?: (d: D) => string | null | undefined
}

const NO_PRICE = () => 'no price'
const GIVEN_AWAY = 'given away ($0 price)'

const DEFAULT_NAMES = {
  value: 'Spent so far',
  max: 'Contract value',
  budget: 'Budget',
  goal: 'Goal (50% of price)',
  progress: 'N collected',
}

export function BulletChart<D>({
  data,
  label,
  labelHeader = 'Survey',
  sublabel,
  value,
  max,
  missingMax = NO_PRICE,
  budget,
  goal,
  progress,
  valueFormat = fmtMoney,
  progressFormat = fmtCount,
  names: namesIn,
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
}: BulletChartProps<D>) {
  const [ref, W] = useChartWidth<HTMLDivElement>(undefined, fixedWidth)
  const { tip, show, hide } = useTooltip()
  const hatchId = useSvgId('hatch')
  const names = { ...DEFAULT_NAMES, ...namesIn }
  const interactive = anyDrill(data, onSelect, href)
  const empty = data.length === 0
  /** The words for a row that has no priced track, or null when it has one. */
  const unpricedWhy = (d: D): string | null => {
    const m = max?.(d)
    if (isPriced(m)) return null
    return isNum(m) ? GIVEN_AWAY : missingMax(d)
  }
  // Every distinct reason a track is hatched, in order of appearance: the
  // legend names them all, so the hatch never says "no price" on a row that
  // says "given away".
  const hatchReasons = max ? Array.from(new Set(data.map(unpricedWhy).filter((r): r is string => !!r))) : []

  // label line, optional sub-line, the bar, optional progress line
  const rowH = (sublabel ? 12 : 0) + (progress ? 52 : 40)
  const H = data.length * rowH + 4

  const summary = useMemo(() => {
    if (empty) return ''
    let over = 0
    let pastGoal = 0
    const reasons = new Map<string, number>()
    for (const d of data) {
      const v = value(d)
      const m = max?.(d)
      const g = goal?.(d)
      // `overran` requires a price above $0: spend on a given-away survey is
      // not "past the contract value".
      if (overran(v, m)) over++
      if (isNum(v) && isNum(g) && v > g) pastGoal++
      if (max && !isPriced(m)) {
        const why = isNum(m) ? GIVEN_AWAY : missingMax(d)
        reasons.set(why, (reasons.get(why) ?? 0) + 1)
      }
    }
    const parts = [`${data.length} ${data.length === 1 ? 'row' : 'rows'}`]
    if (goal) parts.push(`${pastGoal} past the goal`)
    if (max) parts.push(`${over} past the contract value`)
    for (const [why, n] of reasons) parts.push(`${n} ${why}`)
    return parts.join(', ') + '.'
  }, [empty, data, value, max, goal, missingMax])

  const legend: LegendItem[] = [
    { key: 'v', label: names.value, color: 'var(--chart-cost)' },
    ...(max ? [{ key: 'm', label: names.max, color: 'var(--chart-price)', shape: 'tick' as const }] : []),
    ...(budget ? [{ key: 'b', label: names.budget, color: 'var(--chart-budget)', shape: 'tick' as const }] : []),
    ...(goal ? [{ key: 'g', label: names.goal, color: 'var(--chart-goal)', shape: 'tick' as const }] : []),
    // Only list the marks that actually appear, so the legend never explains
    // something the reader cannot find.
    ...(max && data.some((d) => overran(value(d), max(d)))
      ? [{ key: 'over', label: 'Past the contract value', color: 'var(--chart-loss)' }]
      : []),
    ...(hatchReasons.length ? [{ key: 'np', label: capFirst(hatchReasons.join(', or ')), shape: 'hatch' as const }] : []),
    ...(progress ? [{ key: 'p', label: names.progress, color: 'var(--chart-cat-3)', shape: 'range' as const }] : []),
  ]

  const table: ChartTable | null = showTableToggle
    ? {
        columns: [
          { key: 'l', label: labelHeader },
          { key: 'v', label: names.value, align: 'right', title: 'Recorded field cost so far' },
          ...(max ? [{ key: 'm', label: names.max, align: 'right' as const, title: 'Price per N × the N target: what the survey is worth if it lands on target' }] : []),
          ...(max ? [{ key: 'pct', label: 'Spent ÷ contract', align: 'right' as const, title: 'Spend so far as a share of the contract value (blank when there is no price above $0)' }] : []),
          ...(budget ? [{ key: 'b', label: names.budget, align: 'right' as const, title: 'The most we planned to spend' }] : []),
          ...(goal ? [{ key: 'g', label: names.goal, align: 'right' as const, title: 'A starting goal for spend, not a rule' }] : []),
          ...(progress ? [{ key: 'p', label: names.progress, align: 'right' as const, title: 'Respondents collected against the N target' }] : []),
          ...(note ? [{ key: 'n', label: 'Note', title: 'Caveats on this row (the same note the tooltip shows)' }] : []),
        ],
        rows: data.map((d, i) => {
          const v = value(d)
          const m = max?.(d)
          const p = progress?.(d)
          return {
            key: `${i}`,
            cells: [
              sublabel?.(d) ? `${label(d)} (${sublabel(d)})` : label(d),
              fmtOr(v, valueFormat),
              ...(max ? [isPriced(m) ? valueFormat(m) : capFirst(unpricedWhy(d)!)] : []),
              ...(max ? [isNum(v) && isNum(m) && m > 0 ? fmtPct(v / m) : MISSING] : []),
              ...(budget ? [fmtOr(budget(d), valueFormat)] : []),
              ...(goal ? [fmtOr(goal(d), valueFormat)] : []),
              ...(progress ? [p ? `${progressFormat(p.value)} of ${progressFormat(p.target)}` : MISSING] : []),
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
            <HatchDef id={hatchId} />
            {data.map((d, i) => {
              const top = i * rowH + 2
              const v = value(d)
              const m = max?.(d)
              const b = budget?.(d)
              const g = goal?.(d)
              const p = progress?.(d)
              const priced = isNum(m) && m > 0

              // Per-row scale: to the contract value when priced, else to
              // whatever is largest of spend and budget. Stretch past the
              // contract value only when spend overran it.
              const ends = [priced ? m : 0, isNum(v) ? v : 0, isNum(b) ? b : 0, isNum(g) ? g : 0]
              const scaleMax = Math.max(...ends, 1) * (priced && (!isNum(v) || v <= m) ? 1 : 1.05)
              // A $0 price is "given away", not "no price" — and it is never
              // divided by, so it gets the budget-only layout with its own words.
              const givenAway = isNum(m) && m === 0
              const why = max ? (givenAway ? 'given away' : missingMax(d)) : null
              const valueText = priced
                ? `${fmtOr(v, valueFormat)} of ${valueFormat(m)}`
                : `${fmtOr(v, valueFormat)}${isNum(b) ? ` of ${valueFormat(b)} budget` : ''}${why && (givenAway || !isNum(b)) ? ` · ${why}` : ''}`
              const valueW = textWidth(valueText, FONT.tick) + 4
              const x0 = 2
              const x1 = W - 4
              const x = linear([0, scaleMax], [x0, x1])
              const labelY = top + 8
              const subY = top + 22
              const barY = top + (sublabel ? 32 : 20)
              const barH = 12
              const progY = barY + barH + 11

              const rows: TipRow[] = [{ key: 'v', label: names.value, value: fmtOr(v, valueFormat), color: 'var(--chart-cost)' }]
              if (max) rows.push({ key: 'm', label: names.max, value: priced ? valueFormat(m) : capFirst(unpricedWhy(d)!), color: 'var(--chart-price)' })
              if (budget) rows.push({ key: 'b', label: names.budget, value: fmtOr(b, valueFormat), color: 'var(--chart-budget)' })
              if (goal) rows.push({ key: 'g', label: names.goal, value: fmtOr(g, valueFormat), color: 'var(--chart-goal)' })
              if (p) rows.push({ key: 'p', label: names.progress, value: `${progressFormat(p.value)} of ${progressFormat(p.target)}`, color: 'var(--chart-cat-3)' })
              const noteText = note?.(d) ?? undefined
              const aria = [label(d), sublabel?.(d), ...rows.map((r) => `${r.label} ${r.value}`), noteText].filter(Boolean).join(', ')

              const spendEnd = isNum(v) ? x(Math.max(0, v)) : x0
              const inside = priced && isNum(v) ? x(Math.min(v, m)) : spendEnd
              return (
                <Mark
                  key={i}
                  dataKey={`b${i}`}
                  label={aria}
                  hit={{ x: 0, y: top - 2, w: W, h: rowH }}
                  onSelect={onSelect ? () => onSelect(d) : undefined}
                  href={href?.(d)}
                  onShow={() => show({ x: Math.min(spendEnd, W - 8), y: barY, title: label(d), rows, note: noteText })}
                  onHide={hide}
                >
                  <FitText text={label(d)} maxWidth={W - valueW - 12} fontSize={FONT.label} x={x0} y={labelY} className="fill-foreground" weight={500} />
                  <text x={x1} y={labelY} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground tabular-nums" style={{ fontSize: FONT.tick }}>
                    {valueText}
                  </text>
                  {sublabel && sublabel(d) && (
                    <FitText text={sublabel(d) as string} maxWidth={W - 8} fontSize={FONT.small} x={x0} y={subY} />
                  )}
                  {/* track: the price (teal tint) or, with no price, the hatch */}
                  <rect
                    data-mark="track"
                    x={x0}
                    y={barY}
                    width={Math.max(0, (priced ? x(m) : x1) - x0)}
                    height={barH}
                    rx={3}
                    style={{ fill: priced ? 'color-mix(in oklab, var(--chart-price) 22%, var(--chart-surface))' : `url(#${hatchId})` }}
                  />
                  {/* spend: navy inside the contract value, red past it */}
                  {isNum(v) && v > 0 && (
                    <path
                      data-mark="spend"
                      d={roundedBar(x0, barY + 3, Math.max(1, inside - x0), barH - 6, priced && v > m ? 'none' : 'right', 3)}
                      style={{ fill: 'var(--chart-cost)' }}
                    />
                  )}
                  {priced && isNum(v) && v > m && (
                    <path
                      data-mark="over"
                      d={roundedBar(inside, barY + 3, Math.max(1, spendEnd - inside), barH - 6, 'right', 3)}
                      style={{ fill: 'var(--chart-loss)' }}
                    />
                  )}
                  {/* end cap at the contract value */}
                  {priced && (
                    <rect data-mark="cap" x={x(m) - 1.5} y={barY - 3} width={3} height={barH + 6} rx={1} style={{ fill: 'var(--chart-price)' }} />
                  )}
                  {isNum(g) && g > 0 && (
                    <g data-mark="goal">
                      <line x1={x(g)} x2={x(g)} y1={barY - 4} y2={barY + barH + 4} strokeWidth={2} style={{ stroke: 'var(--chart-goal)' }} />
                      <path d={`M${x(g)},${barY + barH + 2}l4,4h-8Z`} style={{ fill: 'var(--chart-goal)' }} />
                    </g>
                  )}
                  {isNum(b) && b > 0 && (
                    <line data-mark="budget" x1={x(b)} x2={x(b)} y1={barY - 4} y2={barY + barH + 4} strokeWidth={2} style={{ stroke: 'var(--chart-budget)' }} />
                  )}
                  {p && (
                    <ProgressBar p={p} x0={x0} x1={x1} y={progY} text={`${progressFormat(p.value)} of ${progressFormat(p.target)} N`} />
                  )}
                </Mark>
              )
            })}
          </ChartSvg>
          <ChartTooltip tip={tip} width={W} />
        </>
      )}
    </ChartFrame>
  )
}

/** The thin collected ÷ target bar, with a tick at the target. */
function ProgressBar({ p, x0, x1, y, text }: { p: BulletProgress; x0: number; x1: number; y: number; text: string }) {
  const tw = textWidth(text, FONT.small) + 8
  const barR = Math.max(x0 + 30, x1 - tw)
  const end = Math.max(p.target, p.value, 1)
  const x = linear([0, end], [x0, barR])
  return (
    <g data-mark="progress">
      <rect x={x0} y={y - 2} width={Math.max(0, barR - x0)} height={4} rx={2} style={{ fill: 'var(--chart-grid)' }} />
      {p.value > 0 && <rect x={x0} y={y - 2} width={Math.max(1, x(p.value) - x0)} height={4} rx={2} style={{ fill: 'var(--chart-cat-3)' }} />}
      {p.target > 0 && <line x1={x(p.target)} x2={x(p.target)} y1={y - 5} y2={y + 5} strokeWidth={1.5} style={{ stroke: 'var(--chart-budget)' }} />}
      <text x={x1} y={y} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground tabular-nums" style={{ fontSize: FONT.small }}>
        {text}
      </text>
    </g>
  )
}

const isPriced = (m: number | null | undefined): m is number => isNum(m) && m > 0
const overran = (v: number | null | undefined, m: number | null | undefined) => isNum(v) && isPriced(m) && v > m

function fmtOr(v: number | null | undefined, f: Formatter): string {
  return isNum(v) ? f(v) : MISSING
}

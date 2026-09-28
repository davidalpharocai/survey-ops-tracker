'use client'

/**
 * Building blocks shared by the chart components: the SVG root with its
 * accessible name, the hover/focus tooltip, the interactive mark wrapper,
 * the "no data" hatch, and axis text that never collides.
 *
 * Internal to components/charts — pages use the chart components, not these.
 */

import { useCallback, useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { fitText, textWidth } from './scale'
import type { CategoryRule, ReferenceLine } from './types'

/** Axis and label font sizes. Thin labels at phone width, never smaller than 10px. */
export const FONT = { tick: 11, label: 12, small: 10 } as const

/** A React useId that is safe inside url(#…) references. */
export function useSvgId(prefix: string): string {
  const raw = useId()
  return `${prefix}-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`
}

// ─── SVG root ────────────────────────────────────────────────────────────────

/**
 * The SVG element. It is role="img" with a computed summary when nothing in
 * it can be clicked; when marks drill it becomes a labelled group, because
 * children of an img are hidden from assistive tech — an img full of buttons
 * would announce none of them. Pass `interactive` from `anyDrill`, so a chart
 * whose href returns null for every row stays an img.
 *
 * The name AND the summary ride in aria-label, and there is deliberately no
 * <title> or <desc> child: a <desc> becomes the accessible description, so the
 * summary would be read twice, and a root <title> pops up as the browser's
 * own tooltip on top of the chart's tooltip. The name is the one thing every
 * screen reader always reads, which is why the summary goes there.
 */
export function ChartSvg({
  width,
  height,
  label,
  summary,
  interactive,
  children,
}: {
  width: number
  height: number
  label: string
  summary: string
  interactive: boolean
  children: ReactNode
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={interactive ? 'group' : 'img'}
      aria-label={summary ? `${label}. ${summary}` : label}
      className="block h-auto w-full max-w-full select-none overflow-hidden"
      style={{ fontSize: FONT.tick }}
    >
      {children}
    </svg>
  )
}

/**
 * Can any row drill? True when there is an onSelect, or when href returns a
 * real URL for at least one row. Deciding from whether the href PROP exists
 * would make a chart whose href is null everywhere a "group" with nothing to
 * click in it.
 */
export function anyDrill<D>(
  data: readonly D[],
  onSelect?: (d: D) => void,
  href?: (d: D) => string | null | undefined,
): boolean {
  return !!onSelect || (!!href && data.some((d) => !!href(d)))
}

/**
 * Does this formatted value read as zero (no digit 1–9 in it)? A value that
 * PRINTS as zero is drawn as zero: a floating-point leftover such as
 * 1234.56 − 1234.5600000001 must not paint a red loss bar beside "$0.00".
 */
export function printsAsZero(text: string): boolean {
  return !/[1-9]/.test(text)
}

// ─── hatch ───────────────────────────────────────────────────────────────────

/** The grey 45° hatch that means "no data / no price" on every chart. */
export function HatchDef({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" style={{ fill: 'var(--chart-muted-bg)' }} />
        <line x1="0" y1="0" x2="0" y2="5" strokeWidth="1.6" style={{ stroke: 'var(--chart-muted)' }} />
      </pattern>
    </defs>
  )
}

// ─── tooltip ─────────────────────────────────────────────────────────────────

export interface TipRow {
  key: string
  label: string
  value: string
  color?: string
  /** Key stroke style; tooltips key rows with a short line, not a box. */
  hatch?: boolean
}

export interface TipState {
  /** Anchor point in plot pixels. */
  x: number
  y: number
  title: string
  rows: TipRow[]
  note?: string
}

export function useTooltip() {
  const [tip, setTip] = useState<TipState | null>(null)
  const hide = useCallback(() => setTip(null), [])
  return { tip, show: setTip, hide }
}

/**
 * The tooltip card. Values lead (bold, ink) and the series name follows,
 * because on hover the reader already knows the series and wants the number.
 * It flips to whichever side has room, so it never pushes the page sideways
 * on a phone. aria-hidden: the focused mark's own aria-label already says
 * everything the card shows.
 */
export function ChartTooltip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null
  const right = tip.x > width / 2
  const below = tip.y < 72
  // Cap the card at the room on its side of the anchor. An absolutely
  // positioned card wider than that pokes past the chart's edge, and on a
  // phone that is a horizontal page scroll.
  const room = Math.max(120, (right ? tip.x : width - tip.x) - 10)
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
      style={{
        left: right ? undefined : Math.max(0, tip.x + 10),
        right: right ? Math.max(0, width - tip.x + 10) : undefined,
        top: tip.y,
        maxWidth: Math.min(240, room),
        transform: below ? 'translateY(14px)' : 'translateY(calc(-100% - 10px))',
      }}
    >
      <div className="mb-0.5 font-medium text-foreground">{tip.title}</div>
      {tip.rows.map((r) => (
        <div key={r.key} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          {r.color || r.hatch ? (
            <span
              className="inline-block h-[3px] w-3 shrink-0 rounded-full"
              style={{
                background: r.hatch
                  ? 'repeating-linear-gradient(90deg, var(--chart-muted) 0 2px, transparent 2px 4px)'
                  : r.color,
              }}
            />
          ) : null}
          <span className="shrink-0 font-semibold tabular-nums text-foreground">{r.value}</span>
          <span className="min-w-0 truncate text-muted-foreground">{r.label}</span>
        </div>
      ))}
      {tip.note && <div className="mt-0.5 text-muted-foreground">{tip.note}</div>}
    </div>
  )
}

// ─── interactive mark ────────────────────────────────────────────────────────

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Wraps one datum's marks. The hit box is the band around the mark (bigger
 * than the painted pixels — nobody hits a 3px sliver), it washes on hover,
 * and it shows the tooltip on hover AND keyboard focus.
 *
 * Clickable (onSelect or href): focusable, Enter/Space activate, a focus
 * ring draws around the hit box, pointer cursor. With href it is a real SVG
 * <a href>, so right-click and middle-click behave like any link while a
 * plain click still runs the in-page drill.
 * Not clickable: out of the tab order — the table twin carries the values.
 */
export function Mark({
  label,
  hit,
  onSelect,
  href,
  onShow,
  onHide,
  children,
  tabIndex,
  onKeyDown,
  elRef,
  dataKey,
}: {
  label: string
  hit: Box
  onSelect?: () => void
  href?: string | null
  onShow: () => void
  onHide: () => void
  children: ReactNode
  /** Override for roving focus (heatmap): 0 or -1. */
  tabIndex?: number
  onKeyDown?: (e: KeyboardEvent<Element>) => void
  /** Receives the focusable element (roving focus). */
  elRef?: (el: HTMLElement | SVGElement | null) => void
  dataKey?: string
}) {
  const interactive = !!onSelect || !!href
  const shapes = (
    <>
      <rect
        x={hit.x}
        y={hit.y}
        width={Math.max(0, hit.w)}
        height={Math.max(0, hit.h)}
        rx={4}
        className="opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
        style={{ fill: 'var(--chart-hover)' }}
      />
      {children}
      {interactive && (
        <rect
          x={hit.x + 1}
          y={hit.y + 1}
          width={Math.max(0, hit.w - 2)}
          height={Math.max(0, hit.h - 2)}
          rx={4}
          fill="none"
          strokeWidth={2}
          className="opacity-0 group-focus-visible:opacity-100"
          style={{ stroke: 'var(--ring)' }}
        />
      )}
    </>
  )
  const common = {
    onMouseEnter: onShow,
    onMouseLeave: onHide,
    onFocus: onShow,
    onBlur: onHide,
    'data-key': dataKey,
  }
  const keyHandler = (e: KeyboardEvent<Element>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (onSelect && (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) {
      // Enter on a link would also fire click (and so onSelect) natively;
      // handle it here once and stop the duplicate.
      e.preventDefault()
      onSelect()
    }
    if (e.key === 'Escape') onHide()
  }
  if (href) {
    return (
      <a
        href={href}
        aria-label={label}
        className="group cursor-pointer outline-none"
        ref={elRef}
        tabIndex={tabIndex}
        onClick={(e) => {
          if (onSelect && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
            e.preventDefault()
            onSelect()
          }
        }}
        onKeyDown={keyHandler}
        {...common}
      >
        {shapes}
      </a>
    )
  }
  if (onSelect) {
    return (
      <g
        role="button"
        tabIndex={tabIndex ?? 0}
        aria-label={label}
        className="group cursor-pointer outline-none"
        ref={elRef}
        onClick={onSelect}
        onKeyDown={keyHandler}
        {...common}
      >
        {shapes}
      </g>
    )
  }
  return (
    <g className="group" onMouseEnter={onShow} onMouseLeave={onHide} data-key={dataKey}>
      <rect
        x={hit.x}
        y={hit.y}
        width={Math.max(0, hit.w)}
        height={Math.max(0, hit.h)}
        rx={4}
        className="opacity-0 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
        style={{ fill: 'var(--chart-hover)' }}
      />
      {children}
    </g>
  )
}

// ─── text ────────────────────────────────────────────────────────────────────

/**
 * A label that fits `maxWidth` or is cut with an ellipsis — and when it is
 * cut, the full text rides along as a <title> so it is never lost.
 */
export function FitText({
  text,
  maxWidth,
  fontSize = FONT.tick,
  x,
  y,
  anchor = 'start',
  className = 'fill-muted-foreground',
  weight,
  baseline = 'central',
  halo = false,
}: {
  text: string
  maxWidth: number
  fontSize?: number
  x: number
  y: number
  anchor?: 'start' | 'middle' | 'end'
  className?: string
  weight?: number
  baseline?: 'central' | 'auto' | 'hanging'
  /** Surface-coloured outline, for a label that may sit over a mark or line. */
  halo?: boolean
}) {
  const fit = fitText(text, maxWidth, fontSize)
  if (!fit.text) return null
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      dominantBaseline={baseline}
      className={className}
      style={{ fontSize, fontWeight: weight, ...(halo ? HALO : null) }}
    >
      {fit.truncated && <title>{text}</title>}
      {fit.text}
    </text>
  )
}

/**
 * A name followed by a quieter tag ("Account F · too few to judge"). The tag
 * is the caveat, so it is never the part that gets cut: its width is
 * reserved first and only the name is shortened. Both parts are tspans of
 * one <text>, so the browser lays them end to end whatever the anchor.
 */
export function TaggedText({
  text,
  tag,
  maxWidth,
  fontSize = FONT.tick,
  tagFontSize = FONT.small,
  x,
  y,
  anchor = 'start',
  className = 'fill-foreground',
  weight,
}: {
  text: string
  tag?: string | null
  maxWidth: number
  fontSize?: number
  tagFontSize?: number
  x: number
  y: number
  anchor?: 'start' | 'end'
  className?: string
  weight?: number
}) {
  const tagText = tag ? ` · ${tag}` : ''
  const tagFit = tag ? fitText(tagText, maxWidth, tagFontSize) : { text: '', truncated: false }
  const nameFit = fitText(text, Math.max(0, maxWidth - textWidth(tagFit.text, tagFontSize)), fontSize)
  if (!nameFit.text && !tagFit.text) return null
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="central" className={className} style={{ fontSize, fontWeight: weight }}>
      {(nameFit.truncated || tagFit.truncated) && <title>{text + tagText}</title>}
      <tspan>{nameFit.text}</tspan>
      {tagFit.text && (
        <tspan data-part="tag" className="fill-muted-foreground" style={{ fontSize: tagFontSize, fontWeight: 400 }}>
          {tagFit.text}
        </tspan>
      )}
    </text>
  )
}

/** Width TaggedText needs to print both parts in full. */
export function taggedWidth(text: string, tag: string | null | undefined, fontSize: number = FONT.tick, tagFontSize: number = FONT.small): number {
  return textWidth(text, fontSize) + (tag ? textWidth(` · ${tag}`, tagFontSize) : 0)
}

/** Text with a surface-coloured halo, for labels that sit over marks or lines. */
export const HALO: CSSProperties = {
  paintOrder: 'stroke',
  stroke: 'var(--chart-surface)',
  strokeWidth: 3,
  strokeLinejoin: 'round',
}

// ─── summaries ───────────────────────────────────────────────────────────────

/**
 * One sentence per series for the accessible name: its range and where the
 * extremes fall. Built from the data, so it can never go stale.
 */
export function describeSeries(
  name: string,
  points: { label: string; value: number | null | undefined }[],
  fmt: (v: number) => string,
): string {
  const vals = points.filter((p): p is { label: string; value: number } => p.value != null && !Number.isNaN(p.value))
  if (vals.length === 0) return `${name}: no values`
  if (vals.length === 1) return `${name}: ${fmt(vals[0].value)} (${vals[0].label})`
  let hi = vals[0]
  let lo = vals[0]
  for (const p of vals) {
    if (p.value > hi.value) hi = p
    if (p.value < lo.value) lo = p
  }
  if (hi.value === lo.value) return `${name}: ${fmt(hi.value)} throughout`
  return `${name}: highest ${fmt(hi.value)} (${hi.label}), lowest ${fmt(lo.value)} (${lo.label})`
}

/** Reference lines as summary phrases. The value is added only when the
 *  label does not already print it ("Goal 90%", not "Goal 90% at 90%"). */
export function describeRefs(refs: ReferenceLine[], fmt: (v: number) => string): string[] {
  return refs.map((r) => {
    const v = fmt(r.value)
    return r.label.includes(v) ? r.label : `${r.label} at ${v}`
  })
}

/** Labelled vertical rules as summary phrases: "costs reliable from here (from Jun)". */
export function describeRules(rules: CategoryRule[], keys: string[], labels: string[]): string[] {
  return rules.flatMap((r) => {
    const i = keys.indexOf(r.at)
    return i < 0 ? [] : [`${r.label} (from ${labels[i]})`]
  })
}

/** "no price" → "No price": the same words in a sentence and in a table cell. */
export const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Is this a usable number (not null, undefined or NaN)? */
export const isNum = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && !Number.isNaN(v)

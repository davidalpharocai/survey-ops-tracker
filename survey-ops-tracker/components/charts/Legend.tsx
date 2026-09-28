'use client'

/**
 * The legend: always present for two or more series, so identity is never
 * colour alone (a colour-blind reader, or a grey printout, still has the
 * words). The swatch mirrors the mark — a block for bars, a stroke for
 * lines, a tick for a tick — and the text stays in ink, never in the series
 * colour (a light hue as text is unreadable on the card).
 */

export type SwatchShape = 'rect' | 'line' | 'dash' | 'dot' | 'ring' | 'tick' | 'hatch' | 'range'

export interface LegendItem {
  key: string
  label: string
  color?: string
  shape?: SwatchShape
  /** Explainer shown as the item's title= tooltip. */
  description?: string
}

/** The grey "no data / no price" hatch as a CSS background, for HTML swatches. */
export const HATCH_CSS =
  'repeating-linear-gradient(45deg, var(--chart-muted) 0 1.25px, var(--chart-muted-bg) 1.25px 4px)'

export function Swatch({ shape = 'rect', color = 'var(--chart-cat-1)' }: { shape?: SwatchShape; color?: string }) {
  const base = 'inline-block shrink-0 align-middle'
  switch (shape) {
    case 'line':
      return <span aria-hidden className={`${base} h-[2px] w-4 rounded-full`} style={{ background: color }} />
    case 'dash':
      return <span aria-hidden className={`${base} w-4 border-t-2 border-dashed`} style={{ borderColor: color }} />
    case 'dot':
      return <span aria-hidden className={`${base} h-2.5 w-2.5 rounded-full`} style={{ background: color }} />
    case 'ring':
      return (
        <span
          aria-hidden
          className={`${base} h-2.5 w-2.5 rounded-full border-2`}
          style={{ borderColor: color, background: 'var(--chart-surface)' }}
        />
      )
    case 'tick':
      return <span aria-hidden className={`${base} h-3 w-[2px]`} style={{ background: color }} />
    case 'hatch':
      return <span aria-hidden className={`${base} h-2.5 w-3 rounded-[2px]`} style={{ background: HATCH_CSS }} />
    case 'range':
      return <span aria-hidden className={`${base} h-2 w-5 rounded-full`} style={{ background: color }} />
    default:
      return <span aria-hidden className={`${base} h-2.5 w-3 rounded-[2px]`} style={{ background: color }} />
  }
}

export function Legend({ items, className = '' }: { items: LegendItem[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground ${className}`}>
      {items.map((it) => (
        <li key={it.key} className="inline-flex min-w-0 items-center gap-1.5" title={it.description}>
          <Swatch shape={it.shape} color={it.color} />
          <span className="truncate">{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

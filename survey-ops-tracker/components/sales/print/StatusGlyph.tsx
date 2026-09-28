import type { Glyph } from '@/lib/sales/statement'

/**
 * The status marks: filled = delivered, half = in field or in quality review,
 * open = not yet in field, bars = on hold, slash = cancelled or closed.
 *
 * Inline SVG in the navy ink, not an icon font or a coloured badge: the marks
 * have to survive a greyscale printer and every PDF viewer identically, and a
 * shape carries its meaning where a colour would not.
 */
const INK = '#010B40'

export function StatusGlyph({ kind }: { kind: Glyph }) {
  const ring = (fill: string) => <circle cx="5" cy="5" r="4.2" fill={fill} stroke={INK} strokeWidth="1.3" />
  return (
    <svg className="st-dot" viewBox="0 0 10 10" aria-hidden="true">
      {kind === 'full' && ring(INK)}
      {kind === 'half' && <>{ring('#fff')}<path d="M5 .8 A4.2 4.2 0 0 0 5 9.2 Z" fill={INK} /></>}
      {kind === 'open' && ring('#fff')}
      {kind === 'hold' && <>{ring('#fff')}<path d="M3.7 3v4M6.3 3v4" stroke={INK} strokeWidth="1.2" /></>}
      {kind === 'cancel' && <>{ring('#fff')}<path d="M2.2 7.8 7.8 2.2" stroke={INK} strokeWidth="1.2" /></>}
    </svg>
  )
}

/** ▼ — a final count below target. Drawn, not typed, so it cannot fall back to
 *  a missing glyph in whatever font the viewer substitutes. */
export function BelowMark({ inline = false }: { inline?: boolean }) {
  return (
    <svg className={inline ? 'st-below st-below-i' : 'st-below'} viewBox="0 0 8 6" role="img" aria-label="below target">
      <path d="M0 0h8L4 6z" fill={INK} />
    </svg>
  )
}

/** A footnote mark: ¹ ² †. */
export function Fn({ n }: { n: number | string }) {
  return <span className="st-fn">{n}</span>
}

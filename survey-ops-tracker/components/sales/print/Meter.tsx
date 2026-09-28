import type { Meter as MeterGeometry } from '@/lib/sales/statement'

/**
 * Credits drawn and term elapsed, on ONE scale that shares the 100% line — so a
 * reader sees pace ("109% of the credits with 49% of the term gone") without
 * doing arithmetic.
 *
 * PLAIN SVG ONLY. The overage is hatched with explicit <line>s clipped by a
 * nested <svg>, not a <pattern>, a gradient or a mask: PDF viewers disagree
 * about all three, and the Windows engine draws a masked group as a solid
 * block. The hatch runs 300 lines wide so any overage is covered whatever the
 * printed width. Values sit in their own grid column so labels cannot collide
 * with the bar.
 */
const INK = '#010B40'
const TRACK = '#E7EBF1'
const TEAL = '#0076AF'
const HATCH = Array.from({ length: 303 }, (_, i) => -8 + i * 3)
const pc = (v: number) => `${v.toFixed(2)}%`

export function Meter({ geometry, drawnLabel, termLabel, ariaLabel }: {
  geometry: MeterGeometry
  /** "≥ 109%" */
  drawnLabel: string
  /** "49%", or null when the term has no length to be through. */
  termLabel: string | null
  ariaLabel: string
}) {
  const { allowPos, usedPos, termPos } = geometry
  const over = usedPos > allowPos
  return (
    <div className="st-meter" role="img" aria-label={ariaLabel}>
      <span className="st-m-l">Credits drawn</span>
      <svg className="st-m-bar" aria-hidden="true">
        <rect x="0" y="1.5" width="100%" height="6" fill={TRACK} />
        <rect x="0" y="1.5" width={pc(Math.min(usedPos, allowPos))} height="6" fill={INK} />
        {over && (
          <>
            <svg x={pc(allowPos)} y="1.5" width={pc(usedPos - allowPos)} height="6">
              <rect width="100%" height="100%" fill="#fff" />
              <g stroke={INK} strokeWidth="1">
                {HATCH.map(x => <line key={x} x1={x} y1="6" x2={x + 6} y2="0" />)}
              </g>
            </svg>
            <rect x={pc(allowPos)} y="1.9" width={pc(usedPos - allowPos)} height="5.2" fill="none" stroke={INK} strokeWidth=".8" />
          </>
        )}
        <line x1={pc(allowPos)} x2={pc(allowPos)} y1="-1.5" y2="10.5" stroke={INK} strokeWidth="1.3" />
      </svg>
      <span className="st-m-v">{drawnLabel}</span>

      {termPos != null && termLabel != null && (
        <>
          <span className="st-m-l">Term elapsed</span>
          <svg className="st-m-bar st-m-term" aria-hidden="true">
            <rect x="0" y="1.5" width={pc(allowPos)} height="4" fill={TRACK} />
            <rect x="0" y="1.5" width={pc(termPos)} height="4" fill={TEAL} />
            <line x1={pc(allowPos)} x2={pc(allowPos)} y1="-1.5" y2="7" stroke={INK} strokeWidth="1.3" />
          </svg>
          <span className="st-m-v">{termLabel}</span>
        </>
      )}

      <span />
      <span className="st-m-axis">
        <span style={{ left: 0 }}>0</span>
        <span className="st-m-cap" style={{ left: pc(allowPos) }}>100%</span>
      </span>
      <span />
    </div>
  )
}

/**
 * The small amount of geometry every chart shares: nice ticks, a linear
 * scale, rounded-end bar paths and a text-width estimate for label fitting.
 *
 * No chart library is installed (and none may be added), so this is the
 * whole "d3-scale" the charts need. It stays pure — no React — so it can be
 * unit-tested on its own.
 */

export interface Domain {
  min: number
  max: number
}

/** The step a human would pick: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || !(count > 0)) return 1
  const raw = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const pick = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return pick * mag
}

/**
 * Widen [min, max] to round numbers and return the ticks between them.
 *
 * Degenerate inputs are the ones real data produces most (one survey, a
 * month of zeros, a column of losses), so each has a defined answer:
 *   - all zero, or no data      → 0..1, so the baseline still draws;
 *   - a single positive value   → 0..v (bars must start at zero anyway);
 *   - negative only             → v..0, bars grow down from the baseline.
 * `includeZero` is on by default because a bar or column that does not start
 * at zero misstates its length. Lines may switch it off.
 */
export function niceDomain(
  lo: number,
  hi: number,
  opts: { count?: number; includeZero?: boolean } = {},
): { min: number; max: number; ticks: number[] } {
  const count = opts.count ?? 5
  let min = Number.isFinite(lo) ? lo : 0
  let max = Number.isFinite(hi) ? hi : 0
  if (opts.includeZero !== false) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  if (min === max) {
    // All zero: just the baseline and one step, never "0.2, 0.4, …" of a count.
    if (min === 0) return { min: 0, max: 1, ticks: [0, 1] }
    if (min > 0) {
      min = opts.includeZero === false ? min * 0.9 : 0
      max = max * 1.1
    } else {
      max = opts.includeZero === false ? max * 0.9 : 0
      min = min * 1.1
    }
  }
  const step = niceStep(max - min, count)
  // `+ 0` turns -0 into 0: Math.ceil(-0.4) is -0, which would print "−0".
  const nMin = Math.floor(min / step + 1e-9) * step + 0
  const nMax = Math.ceil(max / step - 1e-9) * step + 0
  const ticks: number[] = []
  // Integer stepping avoids 0.30000000000000004 creeping into tick labels.
  const first = Math.round(nMin / step)
  const last = Math.round(nMax / step)
  for (let i = first; i <= last; i++) ticks.push(roundTo(i * step, step))
  return { min: nMin, max: nMax, ticks }
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1)
  const r = Number(v.toFixed(Math.min(10, decimals)))
  return r === 0 ? 0 : r // no "-0"
}

/** A linear map from a domain onto a pixel range. */
export function linear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  return (v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))
}

/** Clamp v into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * A bar with a rounded data end and a square baseline end (the house bar
 * shape). `end` names the side that carries the value: a positive column
 * rounds its top, a negative one its bottom, a bar to the right its right.
 * The radius shrinks for a mark too small to hold it, so a $3 bar next to a
 * $30,000 one is still a sliver rather than a blob.
 */
export function roundedBar(
  x: number,
  y: number,
  w: number,
  h: number,
  end: 'top' | 'bottom' | 'left' | 'right' | 'both-h' | 'none',
  radius = 4,
): string {
  const W = Math.max(0, w)
  const H = Math.max(0, h)
  if (W === 0 || H === 0) return `M${x},${y}h${W}v${H}h${-W}Z`
  if (end === 'none') return `M${x},${y}h${W}v${H}h${-W}Z`
  if (end === 'top' || end === 'bottom') {
    const r = Math.min(radius, W / 2, H)
    if (end === 'top') {
      return `M${x},${y + H}V${y + r}Q${x},${y} ${x + r},${y}H${x + W - r}Q${x + W},${y} ${x + W},${y + r}V${y + H}Z`
    }
    return `M${x},${y}H${x + W}V${y + H - r}Q${x + W},${y + H} ${x + W - r},${y + H}H${x + r}Q${x},${y + H} ${x},${y + H - r}Z`
  }
  const r = Math.min(radius, H / 2, W)
  if (end === 'right') {
    return `M${x},${y}H${x + W - r}Q${x + W},${y} ${x + W},${y + r}V${y + H - r}Q${x + W},${y + H} ${x + W - r},${y + H}H${x}Z`
  }
  if (end === 'left') {
    return `M${x + W},${y}V${y + H}H${x + r}Q${x},${y + H} ${x},${y + H - r}V${y + r}Q${x},${y} ${x + r},${y}Z`
  }
  // both-h: a floating range, rounded at both ends.
  const rr = Math.min(radius, H / 2, W / 2)
  return `M${x + rr},${y}H${x + W - rr}Q${x + W},${y} ${x + W},${y + rr}V${y + H - rr}Q${x + W},${y + H} ${x + W - rr},${y + H}H${x + rr}Q${x},${y + H} ${x},${y + H - rr}V${y + rr}Q${x},${y} ${x + rr},${y}Z`
}

/**
 * Estimated rendered width of a label. The app font is a proportional sans,
 * so this is an average (digits and lowercase run ~0.56em, capitals wider);
 * it only has to be good enough to decide "does it fit" with some slack.
 */
export function textWidth(s: string, fontSize: number): number {
  let w = 0
  for (const ch of s) {
    if (ch === ' ') w += 0.3
    else if (/[A-Z$%@#&MW]/.test(ch)) w += 0.68
    else if (/[il.,:;'|!]/.test(ch)) w += 0.3
    else w += 0.56
  }
  return w * fontSize
}

/**
 * Shorten a label to fit `maxWidth`, ending in an ellipsis. Returns the text
 * and whether it was cut, so the caller can attach the full label as a
 * <title> (a truncated label must always be recoverable).
 */
export function fitText(s: string, maxWidth: number, fontSize: number): { text: string; truncated: boolean } {
  if (textWidth(s, fontSize) <= maxWidth) return { text: s, truncated: false }
  if (maxWidth < fontSize) return { text: '', truncated: true }
  const chars = Array.from(s)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(chars.slice(0, mid).join('') + '…', fontSize) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return { text: lo > 0 ? chars.slice(0, lo).join('').trimEnd() + '…' : '', truncated: true }
}

/**
 * How many labels to skip so neighbours never collide: 1 = show every label,
 * 2 = every other one, and so on. Skipped labels stay in the tooltip and the
 * table view.
 */
export function labelStep(labels: string[], slotWidth: number, fontSize: number, gap = 6): number {
  if (labels.length === 0 || !(slotWidth > 0)) return 1
  const widest = Math.max(...labels.map((l) => textWidth(l, fontSize)))
  return Math.max(1, Math.ceil((widest + gap) / slotWidth))
}

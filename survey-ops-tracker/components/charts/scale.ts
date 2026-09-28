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
 *
 * Prefer `labelIndices` for a CATEGORY axis: this walks from the left, so
 * the last category is labelled only by luck. It remains for label rows that
 * have no ends worth naming (the overlay strip's own value labels).
 */
export function labelStep(labels: string[], slotWidth: number, fontSize: number, gap = 6): number {
  if (labels.length === 0 || !(slotWidth > 0)) return 1
  const widest = Math.max(...labels.map((l) => textWidth(l, fontSize)))
  return Math.max(1, Math.ceil((widest + gap) / slotWidth))
}

/**
 * WHICH categories get a label, as indices into `labels`.
 *
 * Three rules a reader depends on and a plain "every nth from the left"
 * cannot give:
 *   - THE ENDS ARE ALWAYS NAMED. A window the reader chose ("last 12 months")
 *     is unreadable if its newest period is unlabelled, and walking i % step
 *     from the left labels the last one only when (n-1) happens to divide.
 *   - THE RHYTHM IS CONSTANT. The step comes from the WIDEST label, so the
 *     labelled periods are evenly spaced and a reader can count ticks between
 *     two names ("every third month") instead of re-learning the interval per
 *     chart. Measuring each label on its own looked tighter and produced
 *     intervals of 2, 2, 2, 2, 1, 2 on one axis — and a DIFFERENT set of
 *     months on the chart beside it, over the same twelve months.
 *   - THE NEWEST END ANCHORS IT. The step is walked right to left from the
 *     last category, so the densest, most-read end of a trend keeps its
 *     rhythm and only the oldest interval is ever short.
 *
 * Categories are evenly spaced, so two labels collide exactly when the slots
 * between them are narrower than their two half-widths plus `gap`. Whatever
 * is thinned away still gets a tick (see CategoryTicks), and still carries
 * its full label in the tooltip and the table.
 */
export function labelIndices(labels: string[], slotWidth: number, fontSize: number, gap = 6): number[] {
  const n = labels.length
  if (n <= 1) return n === 1 ? [0] : []
  // No width to measure against (a collapsed tab): name the ends only.
  if (!(slotWidth > 0)) return [0, n - 1]
  const w = labels.map((l) => textWidth(l, fontSize))
  const widest = Math.max(...w)
  const step = Math.max(1, Math.ceil((widest + gap) / slotWidth))
  if (step === 1) return labels.map((_, i) => i)
  // Right to left, so the recent end of a trend anchors the rhythm.
  const keep: number[] = []
  for (let i = n - 1; i >= 0; i -= step) keep.unshift(i)
  // The first category is not negotiable: drop whatever it would run into.
  // `> 1` keeps the last category through even the narrowest chart — both
  // ends are named even if they have to touch.
  if (keep[0] !== 0) {
    if (keep.length > 1 && keep[0] * slotWidth < (w[0] + w[keep[0]]) / 2 + gap) keep.shift()
    keep.unshift(0)
  }
  return keep
}

/**
 * How much width each kept label may use — the room its thinned-away
 * neighbours left it. Thinning the axis WIDENS the survivors, which is what
 * lets "September 2026" print in full once "August 2026" beside it is gone.
 *
 * This is the exact inverse of the collision test in `labelIndices`: a label
 * is centred, so it may spread half its width toward each neighbour, and the
 * room is twice the nearer of those two gaps. That equality matters — a
 * looser figure would ellipsise a label the axis had just decided fits.
 * Indices with no label keep a single slot; nothing is drawn at them anyway.
 *
 * THE TWO ENDS ARE FLOORED AT THEIR OWN WIDTH. `labelIndices` promises to
 * name them whatever happens, and on a collapsed or near-zero-width container
 * the inward gap arithmetic can reach 0 — which would hand FitText a maxWidth
 * of 0 and draw NOTHING, quietly undoing the one invariant the axis has. An
 * end label is allowed to overhang instead of vanishing.
 */
export function labelRooms(picks: number[], labels: string[], slotWidth: number, fontSize: number, gap = 6): number[] {
  const room = new Array<number>(labels.length).fill(slotWidth)
  if (picks.length === 0) return room
  const w = labels.map((l) => textWidth(l, fontSize))
  if (picks.length === 1) {
    room[picks[0]] = Math.max(slotWidth, labels.length * slotWidth, w[picks[0]])
    return room
  }
  for (let k = 0; k < picks.length; k++) {
    const i = picks[k]
    // No neighbour on the outside of the first and last labels, so only the
    // inward gap binds them.
    const left = k > 0 ? (i - picks[k - 1]) * slotWidth - w[picks[k - 1]] / 2 - gap : Infinity
    const right = k < picks.length - 1 ? (picks[k + 1] - i) * slotWidth - w[picks[k + 1]] / 2 - gap : Infinity
    const fair = Math.max(0, 2 * Math.min(left, right))
    const isEnd = k === 0 || k === picks.length - 1
    room[i] = isEnd ? Math.max(fair, w[i]) : fair
  }
  return room
}

/**
 * The font and the labels a CATEGORY AXIS draws: shrink one step before
 * thinning anything away.
 *
 * David, on the Insights trend charts (2026-09-28): "it needs to show the
 * month-year in the chart. how else would i follow it". Twelve months of
 * "Oct 25" measure 425px of ink, and the two trend charts sit in half of a
 * capped grid — 534px of card, about 470px of plot — so at the 11px axis size
 * the labels collide by a hair and five or six months lose their name at
 * EVERY desktop width. One step down to the house 10px floor fits all twelve
 * with room to spare.
 *
 * So the rule is: try the normal size; if every category is named, keep it.
 * Otherwise try `minFontSize`, and take it ONLY if it names every category —
 * a smaller font that still thins is two costs for one benefit, and a chart
 * that shrinks its axis for one extra label looks arbitrary beside its
 * neighbour. Past that the axis thins, at the normal size, and every thinned
 * period still gets a tick, a tooltip and a table row.
 */
/**
 * Cap a CENTRED label's width so the SVG edge can never cut it.
 *
 * A category label is anchored at its band's centre, so it needs half its own
 * width on each side; the outermost bands sit less than that from the edge on
 * a tight chart, and ChartSvg's viewBox is the pixel box — nothing scales a
 * clipped glyph back in. Capped here, an unavoidable case ellipsises instead,
 * and FitText keeps the full text as its title.
 *
 * The 1px of slack is deliberate: `textWidth` is an estimate, and a chart that
 * reserves exactly this much room lands on the cap to the last float, which
 * would ellipsise the very label the reserve was for.
 */
export function edgeRoom(room: number, cx: number, width: number): number {
  return Math.max(0, Math.min(room, 2 * cx + 1, 2 * (width - cx) + 1))
}

export function fitAxisLabels(
  labels: string[],
  slotWidth: number,
  fontSize: number,
  opts: { minFontSize?: number; gap?: number } = {},
): { fontSize: number; picks: number[]; rooms: number[] } {
  const gap = opts.gap ?? 6
  const at = (f: number) => {
    const picks = labelIndices(labels, slotWidth, f, gap)
    return { fontSize: f, picks, rooms: labelRooms(picks, labels, slotWidth, f, gap) }
  }
  const first = at(fontSize)
  if (first.picks.length >= labels.length) return first
  const min = opts.minFontSize ?? fontSize
  if (min >= fontSize) return first
  const smaller = at(min)
  return smaller.picks.length >= labels.length ? smaller : first
}

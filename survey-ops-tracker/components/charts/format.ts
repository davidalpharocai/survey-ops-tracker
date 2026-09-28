/**
 * Number formatting for charts.
 *
 * Axis ticks, bar-end labels, tooltips and the "View as table" twin all go
 * through these, so a figure reads the same wherever it appears on a chart.
 * The house rules they encode:
 *   - a negative prints with a real minus sign (U+2212): −$1,234, never "$-1,234"
 *     (the old finance helpers printed exactly that, and a hyphen next to a
 *     dollar sign reads as a dash, not a sign);
 *   - money under $10 keeps its cents: a panel complete at "$1" loses the
 *     decision that "$1.21" carries;
 *   - counts use fmtNum (thousands separators), like every other quantity.
 *
 * Every helper takes `null | undefined` and prints "—" rather than "$0",
 * because a missing figure is not zero (the recurring finance-page bug).
 */

import { fmtNum } from '@/lib/utils/number'
import { money } from '@/lib/finance/format'

export type Formatter = (value: number) => string

/** The typographic minus sign. */
export const MINUS = '−'

/** Printed for a value that is missing (never "$0" or "0%"). */
export const MISSING = '—'

// Infinity counts as missing too: it is what a division by zero leaves, not a figure.
const isMissing = (n: number | null | undefined): n is null | undefined =>
  n === null || n === undefined || !Number.isFinite(n)

/** Put a real minus sign on a formatted magnitude. */
const signed = (n: number, body: string) => (n < 0 ? MINUS + body : body)

/** Swap a leading hyphen-minus (from toLocaleString) for the real minus sign. */
export function withMinus(s: string): string {
  return s.startsWith('-') ? MINUS + s.slice(1) : s
}

/**
 * Money at the precision the number deserves: cents under $10, whole dollars
 * from $10. `fmtMoney(-1234)` → "−$1,234", `fmtMoney(1.214)` → "$1.21".
 *
 * This is the finance section's own `money` (lib/finance/format.ts, "the ONE
 * copy") behind a null guard, NOT a second implementation: a chart label and
 * the finance table beside it must print the same figure to the cent. Two
 * copies had already drifted ($9.995 printed "$10.00" here and "$9.99"
 * there, and a −1e-11 float leftover printed "−$0.00"). `money` also drops
 * the sign of anything that rounds to zero.
 */
export function fmtMoney(n: number | null | undefined): string {
  if (isMissing(n)) return MISSING
  return money(n)
}

/**
 * Compact money for axes and tight labels: $950, $12.3k, $120k, $1.2M.
 * Under $10 it keeps cents like fmtMoney, because a per-respondent axis
 * ($0.50 to $3.00) is unreadable as "$1, $1, $2, $3".
 */
export function fmtMoneyCompact(n: number | null | undefined): string {
  if (isMissing(n)) return MISSING
  const a = Math.abs(n)
  if (a === 0) return '$0'
  // The same "under $10" test as `money`, so the compact and full forms agree
  // on which amounts keep their cents.
  if (a < 10) return fmtMoney(n)
  if (Math.round(a) < 1000) return signed(n, '$' + Math.round(a).toLocaleString('en-US'))
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ]
  for (let i = 0; i < units.length; i++) {
    const [size, suffix] = units[i]
    // Compare the ROUNDED amount: $999.60 is "$1k", not "$1000".
    if (Math.round(a) < size) continue
    const scaled = a / size
    // One decimal below 100 of a unit ($12.3k), none from 100 ($120k).
    let body = scaled < 100 ? (Math.round(scaled * 10) / 10).toString() : Math.round(scaled).toString()
    // $999,960 rounds to "1000k": promote it to the next unit instead.
    if (Number(body) >= 1000 && i > 0) {
      const [bigger, biggerSuffix] = units[i - 1]
      body = (Math.round((a / bigger) * 10) / 10).toString()
      return signed(n, '$' + body + biggerSuffix)
    }
    return signed(n, '$' + body + suffix)
  }
  return signed(n, '$' + Math.round(a).toString())
}

/**
 * A fraction as a percentage: `fmtPct(0.429)` → "43%", `fmtPct(-0.97)` → "−97%".
 * `digits` adds decimal places for small differences that matter.
 */
export function fmtPct(fraction: number | null | undefined, digits = 0): string {
  if (isMissing(fraction)) return MISSING
  const v = fraction * 100
  const rounded = Number(Math.abs(v).toFixed(digits))
  // A value that rounds to zero prints unsigned: "−0%" is noise.
  if (rounded === 0) return (0).toFixed(digits) + '%'
  return signed(v, rounded.toFixed(digits) + '%')
}

/** A count with thousands separators (fmtNum) and a real minus sign. A
 *  value that rounds to zero prints unsigned ("0", never "−0"). */
export function fmtCount(n: number | null | undefined): string {
  if (isMissing(n)) return MISSING
  const s = fmtNum(n)
  return /[1-9]/.test(s) ? withMinus(s) : s.replace(/^-/, '')
}

/** Compact count for axes: 950, 1.2k, 12k, 1.4M. */
export function fmtCountCompact(n: number | null | undefined): string {
  if (isMissing(n)) return MISSING
  const a = Math.abs(n)
  if (a < 1000) return fmtCount(n)
  const k = a >= 1e6 ? [1e6, 'M'] as const : [1e3, 'k'] as const
  const scaled = a / k[0]
  const body = scaled < 10 ? (Math.round(scaled * 10) / 10).toString() : Math.round(scaled).toString()
  return signed(n, body + k[1])
}

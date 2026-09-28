/**
 * Money and ratio formatting for the finance section — the ONE copy.
 *
 * It lives in lib, not in components, because the library writes sentences too:
 * the worklist headlines, the lever rules and the drill population lines are all
 * built here, and a sentence that formats a number differently from the tile
 * beside it is the "$23 against a median of $1 — 19.0×" problem again (the
 * arithmetic was right; whole-dollar rounding made it read wrong).
 *
 * Three house rules (build brief, 2026-09-24):
 *   · negatives print as −$3,586 — a real minus sign in front of the dollar
 *     sign, never "$-3,586", which is what the old helper produced;
 *   · amounts under $10 keep their cents, because a $1.21 panel respondent
 *     rounded to "$1" throws the decision away;
 *   · a value that is missing prints as "—", never as $0.
 */

const MINUS = '−'

const sign = (n: number, rounded: number) => (n < 0 && rounded !== 0 ? MINUS : '')

/** Always two decimals: −$1.21 / $70.29. */
export function money2(n: number): string {
  const r = Math.round(Math.abs(n) * 100) / 100
  return sign(n, r) + '$' + r.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Whole dollars — −$3,586 / $274,038 — except that an amount under $10 keeps
 *  its cents ($1.21, not "$1"), per the house rule. Exactly zero stays "$0":
 *  there are no cents to lose. */
export function money(n: number): string {
  if (n !== 0 && Math.abs(n) < 10) return money2(n)
  const r = Math.round(Math.abs(n))
  return sign(n, r) + '$' + r.toLocaleString('en-US')
}

/** Cents under $10, whole dollars above — the precision the number deserves.
 *  The same as `money` now that `money` keeps small amounts' cents; kept as
 *  its own name for the callers that ask for it explicitly. */
export function moneyAuto(n: number): string {
  return money(n)
}

/** A nullable amount: "—" when there is nothing to print. */
export function moneyOrDash(n: number | null | undefined, f: (x: number) => string = moneyAuto): string {
  return n == null || !Number.isFinite(n) ? '—' : f(n)
}

/** A fraction as a whole percentage ("43%"), or "—" when it cannot be computed.
 *  Negative fractions keep the real minus sign. */
export function pctText(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const r = Math.round(Math.abs(x) * 100)
  return (x < 0 && r !== 0 ? MINUS : '') + r + '%'
}

/** Cents per dollar of client price: 0.67 → "67¢". */
export function centsText(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return Math.round(x * 100) + '¢'
}

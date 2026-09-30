/**
 * What an account's delivered work is worth, for the sales tier.
 *
 * David, 2026-09-30: "on the account's record page: it can have $ the client
 * has paid us and then date range options."
 *
 * ── IT IS NOT WHAT THEY PAID ───────────────────────────────────────────────
 * SOCC has no invoice and no payment table. Nothing here records cash
 * received, and no amount of arithmetic over what SOCC does hold can produce
 * one. What it can say is what the delivered work was WORTH at the price the
 * client agreed — so that is what this is called, on screen and in the code.
 * Calling a delivered-value figure "paid" would be the kind of label that gets
 * read to a client.
 *
 * ── THE FIGURE IS revenue.ts's, NOT A NEW ONE ──────────────────────────────
 * lib/finance/revenue.ts is "THE ONE DEFINITION", written after five copies of
 * "what we charged" disagreed by $96,480 on the delivered book. This module
 * adds no arithmetic of its own: the server half calls `revenueOf` and hands
 * the dollars over, and everything here counts and phrases them. In particular
 * it does NOT re-derive billed N — that is min(n_actual, n_target_max ??
 * n_target), n_collected is never a fallback, and getting that subtly wrong in
 * a second place is exactly the failure revenue.ts exists to prevent.
 *
 * ── WHY price_per_n IS NOT ON A SALES VIEW ─────────────────────────────────
 * The rate is finance-only (082, `my_role() = 'analyst'`). David asked for the
 * DOLLARS on the account page, so the dollars are computed server-side and the
 * rate never leaves the server. That is also the only shape that keeps one
 * definition: a SQL view would have to restate the billing rule in a second
 * language, where no test can see it drift.
 *
 * ── A BLANK IS NOT A ZERO ──────────────────────────────────────────────────
 * Measured 2026-09-30: of 405 delivered studies, 58 have both a price and a
 * billable N. Of 63 owned accounts with delivered work, 3 would show a
 * complete figure, 8 would understate, and 52 would show nothing at all. A
 * bare "$0" on 52 accounts would read as "this client has paid us nothing".
 * So this never returns a lone number — `describeValue` always says how much
 * of the account it actually covers, and says "not priced yet" rather than $0.
 */
import { money } from '@/lib/finance/format'
import { fmtNum } from '@/lib/utils/number'

/** The fields a row needs to be counted. The dollars themselves arrive
 *  separately, already computed by revenue.ts on the server. */
export interface ValueRow {
  id: string
  /** Delivered rows are the only ones that can be worth anything. Supplied by
   *  the caller, which already knows its own bucket rule (lib/sales/buckets). */
  delivered: boolean
  /** The post-QA count. Needed only to tell "no price" from "no count yet",
   *  which need different fixes and so are counted apart. */
  n_actual: number | null
  segmentsCounted?: boolean
}

export interface ValueSummary {
  /** Dollars across the rows that produced a figure. */
  total: number
  /** Rows that produced a figure. */
  priced: number
  /** Delivered rows with a billable N and no client price. The actionable gap. */
  unpriced: number
  /** Delivered rows with a price but no post-QA count yet. */
  noN: number
  /** A source read failed. Never presented as 0 — see the module note. */
  blocked: boolean
}

export const EMPTY_VALUE: ValueSummary = { total: 0, priced: 0, unpriced: 0, noN: 0, blocked: false }

/**
 * Roll up the rows on screen. `byId` holds the dollars revenue.ts computed;
 * a row absent from it, or mapped to null, has no figure — and WHY it has none
 * is read off the row, so "not priced yet" and "no final count yet" never get
 * merged into one number nobody can act on.
 */
export function summariseValue(
  rows: ValueRow[],
  byId: Map<string, number | null>,
  blocked = false,
): ValueSummary {
  if (blocked) return { ...EMPTY_VALUE, blocked: true }
  let total = 0, priced = 0, unpriced = 0, noN = 0
  for (const r of rows) {
    if (!r.delivered) continue
    const v = byId.get(r.id)
    if (v != null) { total += v; priced++; continue }
    // No figure. A count it does not have yet is a different problem from a
    // price nobody has set, and only one of them is sales's to chase.
    const hasN = r.n_actual != null || r.segmentsCounted === true
    if (hasN) unpriced++
    else noN++
  }
  return { total, priced, unpriced, noN, blocked: false }
}

const studies = (n: number) => `${fmtNum(n)} ${n === 1 ? 'study' : 'studies'}`

/**
 * The sentence under the figure. Every branch states its own coverage, on the
 * same rule as describeConsumption: a number whose reach is unstated is a
 * number a reader will over-trust.
 */
export function describeValue(s: ValueSummary): string {
  if (s.blocked) {
    return 'The client price did not load, so the value of delivered work cannot be shown. This is not $0.'
  }
  const considered = s.priced + s.unpriced + s.noN
  if (considered === 0) return 'No delivered work in this range.'

  if (s.priced === 0) {
    const why = s.unpriced > 0 && s.noN > 0
      ? `${studies(s.unpriced)} ${s.unpriced === 1 ? 'is' : 'are'} not priced yet and ${studies(s.noN)} ${s.noN === 1 ? 'has' : 'have'} no final count yet`
      : s.unpriced > 0
        ? `${studies(s.unpriced)} ${s.unpriced === 1 ? 'is' : 'are'} not priced yet`
        : `${studies(s.noN)} ${s.noN === 1 ? 'has' : 'have'} no final count yet`
    return `Not known yet — ${why}. That is not the same as $0.`
  }

  const gaps: string[] = []
  if (s.unpriced > 0) gaps.push(`${fmtNum(s.unpriced)} not priced yet`)
  if (s.noN > 0) gaps.push(`${fmtNum(s.noN)} with no final count yet`)

  const head = `${money(s.total)} across ${studies(s.priced)}`
  if (!gaps.length) {
    return `${head} — every delivered study in this range.`
  }
  // "Understates" is stated outright. A reader comparing this with a number
  // from elsewhere needs to know which direction the gap runs.
  return `${head} of ${fmtNum(considered)} delivered — ${gaps.join(' and ')}, so this understates the account.`
}

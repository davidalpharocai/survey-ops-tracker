/**
 * Client revenue — THE ONE DEFINITION.
 *
 * Before this file there were five, and they disagreed: the hub counted a $0
 * price as $0 of revenue, the per-survey P&L, the month table, the backlog, the
 * foregone figure and the unpriced worklist counted it as "unpriced", and the
 * project page capped billed N at the top of the sold range and fell back to
 * the raw collected count when the post-QA count was missing. On the delivered
 * book that put the project page $96,480 away from the hub, and the margin drill
 * could not reconcile to its own headline. A test suite that checks each copy in
 * isolation stays green while the page disagrees with itself, so every consumer
 * now calls this file and nothing else.
 *
 * ── THE RULE (David, 2026-09-24, and 2026-09-27 for segments) ───────────────
 *
 *     revenue  = the survey's price per N × billed N
 *     billed N = min(the survey's n_actual, the survey's n_target_max ?? n_target)
 *
 *   · "Generally it's only the N actual that can be billed." n_actual is the
 *     post-QA count the client received. n_collected is the raw pre-QA count and
 *     is NEVER a fallback: a survey with no delivered N has no revenue yet.
 *   · The cap is the TOP of the sold range. Over-delivery is a courtesy — new
 *     clients are over-delivered on purpose the first time — and it is never
 *     billed or chased afterwards, so N above the cap earns nothing.
 *   · The bill is the SURVEY's, not its segments'. David, 2026-09-27: "when we
 *     bill its just the n actual. we dont break it out usually on the invoice by
 *     segment." One rate (project_financials.price_per_n), one delivered N, one
 *     cap. A segment never splits, caps or blocks the bill.
 *
 * ── SEGMENTS ARE DATA NOTES, NEVER A REASON TO CHANGE THE BILL ──────────────
 * This file used to price and cap each segment on its own, which billed a
 * survey that delivered 200 of the 200 it sold (Buyers 120 of 100, Sellers 80 of
 * 100) for 180, and called 20 of it over-delivered and 20 of it short. On the
 * 1 Jun–24 Sep book that rule put $5,335 less client price on 7 segmented
 * surveys than the invoice would. It also refused to bill a survey at all while
 * one segment was missing its count (PR00231), although the survey's own N
 * actual is what gets invoiced. Both are gone. What the segments can still tell
 * us is surfaced as a note for the Improve tab, never as a different figure:
 *
 *   · segmentsDisagree — the segments' N actuals do not add up to the survey's
 *     (a segment missing its count, or a sum that differs). "ideally the
 *     segments roll up but sometimes its not easy to reconcile."
 *   · segmentPriceDiffers — a segment carries its own price (082) that is not
 *     the survey's rate. The invoice uses one rate, so the override changes
 *     nothing here; it is shown so someone can make the two agree.
 *
 * The one place segments feed a figure is a survey whose own n_actual is BLANK
 * while EVERY segment has one: the bill then uses their sum, and the result is
 * marked `nSource: 'segments'` so no reader mistakes it for the survey's figure.
 * One segment short of a count and there is no delivered N at all — the rule
 * never guesses. (The 078 trigger keeps n_actual equal to the segments' sum on
 * every segment edit, and the project page also lets the survey's N actual be
 * typed directly; a typed value stands until the next segment edit rolls it up
 * again. Either way the survey's field is the one the invoice reads.)
 *
 * ── THE BILL AND A PER-RESPONDENT RATE PART COMPANY IN ONE CASE ─────────────
 * The 078 trigger sums the segment counts it HAS. While one segment is still
 * uncounted, the survey's N actual is therefore the other segments' total and
 * nothing more (PR00231: one segment counted, the other bought thousands of N
 * and has no count). The bill still reads it — it is the survey's figure — but
 * the survey's COST covers every segment, so cost ÷ that N, and bought − that N,
 * describe a scrub and a price per respondent that did not happen.
 * `perRespondentNOf` is the N a per-respondent measure may divide by: the
 * delivered N, except null in exactly that case (`segmentCheck().partialRollUp`).
 * A survey N actual that was TYPED — it differs from the partial sum — stays
 * in: somebody stated the whole survey's figure, and it carries the
 * segmentsDisagree note instead.
 *
 * ── BILLED, OVER AND SHORT ARE ONE RULE, IN THREE FUNCTIONS ─────────────────
 * The same survey is described three ways, and the three must follow the same
 * rule or the page disagrees with itself:
 *
 *     billedNOf         min(delivered, cap)
 *     overDeliveredOf   max(0, delivered − cap)
 *     shortfallOf       max(0, N sold − delivered)
 *
 * all on the survey as a whole, so billed + over-delivered = delivered exactly
 * and an export row adds up. Nothing else computes any of them.
 *
 * ── NULL, $0 AND RATIOS ─────────────────────────────────────────────────────
 *   · Revenue is NULL — never 0 — when the price, the delivered N or the cap is
 *     missing. Null means "we do not know yet"; 0 would be a claim.
 *   · A price of exactly $0 is a real price (internal work, free trials). It is
 *     $0 of revenue in every dollar total, and it is EXCLUDED from every
 *     per-survey ratio (spend ÷ price, budget ÷ price, kept %), because $0 must
 *     never divide. `ratioEligible` is the one switch every ratio reads.
 *
 * ── THE INVOICE SEAM ────────────────────────────────────────────────────────
 * Every figure here is what the contract IMPLIES — price × count. There is no
 * invoice table yet. David will load the actual bill later so the two can be
 * reconciled; when he does, the invoiced amount goes into `invoicedAmountOf`
 * below and supersedes the computed figure everywhere at once, because every
 * consumer reads `revenueDetail`. Nothing else has to change, and nothing else
 * may compute revenue on its own.
 *
 * This file is pure and imports nothing at runtime, so the project page, the
 * finance hub, the export and the tests all load the same code.
 */

/** One segment of a segmented survey (039 / 078 / 082 columns). Read for the
 *  data notes and for the one roll-up case above — never to split the bill. */
export interface RevenueSegment {
  n_target: number | null
  n_target_max?: number | null
  n_actual: number | null
  /** 082: this segment's own price per N. NULL = inherit the project rate.
   *  The invoice uses one rate, so an override is a note, not a price. */
  price_per_n?: number | null
}

/** The fields revenue needs from a survey. `segments` is attached by the loader
 *  (lib/finance/load.ts) and by the project page. */
export interface RevenueSubject {
  n_target: number | null
  n_target_max?: number | null
  n_actual: number | null
  segments?: RevenueSegment[] | null
}

/** The survey as the invoice sees it: one rate, one delivered N, one cap. */
export interface RevenueLine {
  /** The survey's price per N. null = nobody has priced it. */
  rate: number | null
  /** n_target — the N sold (the bottom of the range). */
  nMin: number | null
  /** n_target_max — the top of the sold range. Falls back to nMin. */
  nMax: number | null
  /** The delivered N after QA (`deliveredNOf`). The only N that can be billed. */
  nActual: number | null
}

/** Why a survey has no revenue figure. 'ok' when it has one. A segment is
 *  never a reason: see segmentsDisagree / segmentPriceDiffers for the notes. */
export type RevenueBlock =
  | 'ok'
  | 'no-price'          // the survey carries no price per N
  | 'no-n-actual'       // nothing delivered after QA yet
  | 'no-cap'            // no N target to cap the bill against

/** Where the delivered N came from. 'segments' only when the survey's own
 *  n_actual is blank and every segment has one. */
export type NSource = 'survey' | 'segments'

export interface Revenue {
  /** What the client pays, in dollars. null when it cannot be known yet. */
  revenue: number | null
  /** min(delivered, top of the sold range) on the survey. null when the
   *  delivered N or the cap is missing. Independent of the price. */
  billedN: number | null
  /** The survey's price per N — the one rate the invoice uses. null when not
   *  priced. */
  rate: number | null
  /** The survey carries a price (a real $0 counts as a price). */
  priced: boolean
  /** Priced at exactly $0 — work given away on purpose. */
  free: boolean
  /** revenue > 0. The ONLY gate a per-survey ratio may use. */
  ratioEligible: boolean
  reason: RevenueBlock
  /** Where the figure came from: computed from price × count, or (once the
   *  seam is filled) the invoice. null when there is no figure. */
  source: 'computed' | 'invoiced' | null
  /** Where the delivered N came from: the survey's own N actual, or — only when
   *  that is blank and every segment has one — the segments' sum ("rolled up
   *  from segments"). null when there is no delivered N. */
  nSource: NSource | null
}

/** Coerce a PostgREST value. numeric columns can arrive as strings. */
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A usable price: recorded and not negative. The database refuses negatives
 *  (082 CHECK), so a negative here is corruption, and corruption is not a price. */
const priceOf = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n >= 0 ? n : null
}

/** Two prices the same to well under a cent. Numeric columns can round-trip
 *  through a float, and a note that fires on 1e-12 would be noise. */
const samePrice = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** The cap for one line: the top of the sold range, else the N sold. */
export const capOf = (l: Pick<RevenueLine, 'nMin' | 'nMax'>): number | null =>
  l.nMax ?? l.nMin

/**
 * The survey's delivered N, and where it came from.
 *
 * The survey's own n_actual whenever it is recorded — that is the number the
 * invoice uses, whatever the segments say. Only when it is blank AND every
 * segment carries an N actual does the segments' sum stand in, marked
 * 'segments'. A blank survey with any segment still uncounted has no delivered
 * N: a partial sum is not a count.
 */
export function deliveredNOf(p: RevenueSubject): { n: number | null; source: NSource | null } {
  const own = num(p.n_actual)
  if (own != null) return { n: own, source: 'survey' }
  const segs = p.segments ?? []
  if (segs.length > 0 && segs.every(s => num(s.n_actual) != null)) {
    return { n: segs.reduce((t, s) => t + (num(s.n_actual) as number), 0), source: 'segments' }
  }
  return { n: null, source: null }
}

/** The survey as one priced line — the only shape the bill has. */
export function surveyLineOf(p: RevenueSubject, projectRate: number | null | undefined): RevenueLine {
  return {
    rate: priceOf(projectRate),
    nMin: num(p.n_target),
    nMax: num(p.n_target_max),
    nActual: deliveredNOf(p).n,
  }
}

/**
 * Revenue for one line. This is the arithmetic every consumer shares — the
 * hub and the project page both reach it through `revenueDetail`.
 */
export function billedRevenue(l: RevenueLine): Omit<Revenue, 'source' | 'nSource'> {
  const cap = capOf(l)
  const billedN = l.nActual != null && cap != null ? Math.min(l.nActual, cap) : null
  if (l.rate == null) {
    return { revenue: null, billedN, rate: null, priced: false, free: false, ratioEligible: false, reason: 'no-price' }
  }
  const free = l.rate === 0
  const reason: RevenueBlock = l.nActual == null ? 'no-n-actual' : cap == null ? 'no-cap' : 'ok'
  if (reason !== 'ok' || billedN == null) {
    return { revenue: null, billedN, rate: l.rate, priced: true, free, ratioEligible: false, reason }
  }
  const revenue = l.rate * billedN
  return { revenue, billedN, rate: l.rate, priced: true, free, ratioEligible: revenue > 0, reason: 'ok' }
}

/**
 * THE INVOICE SEAM. Returns the amount actually invoiced for this survey, or
 * null when no invoice is on file — which is every survey today, because SOCC
 * has no invoice table (finance spec, blocked item B5).
 *
 * When David loads the actual bills, read the invoiced amount here (it will
 * arrive on the survey the loader hands in) and return it. `revenueDetail`
 * already prefers it over price × count, so every tile, drill, export and the
 * project page switch over in one place. Keep the computed figure available
 * beside it for the reconciliation — that comparison is the point of loading
 * the bill.
 */
export function invoicedAmountOf(_p: RevenueSubject): number | null {
  return null
}

/**
 * Revenue for one survey, with the reason when there is none. Every consumer
 * in the finance hub, the export, the connector and the project page reads
 * THIS.
 */
export function revenueDetail(p: RevenueSubject, projectRate: number | null | undefined): Revenue {
  const invoiced = invoicedAmountOf(p)
  const computed = billedRevenue(surveyLineOf(p, projectRate))
  const nSource = deliveredNOf(p).source
  if (invoiced != null) {
    return {
      ...computed,
      revenue: invoiced,
      priced: true,
      free: invoiced === 0,
      ratioEligible: invoiced > 0,
      reason: 'ok',
      source: 'invoiced',
      nSource,
    }
  }
  return { ...computed, source: computed.revenue == null ? null : 'computed', nSource }
}

/** Revenue in dollars, or null. The short form of `revenueDetail`. */
export function revenueOf(p: RevenueSubject, projectRate: number | null | undefined): number | null {
  return revenueDetail(p, projectRate).revenue
}

/** Billed N — min(delivered, top of the sold range), on the survey — or null.
 *  Price-free, so a credit-priced or unpriced survey can still say how many it
 *  could bill. */
export function billedNOf(p: RevenueSubject): number | null {
  return billedRevenue(surveyLineOf(p, 0)).billedN
}

/** True when the survey carries a price, $0 included. What "client price
 *  coverage" counts. A segment's own price does not price the survey: the
 *  invoice uses one rate (segmentPriceDiffers says when they differ). */
export function hasPrice(_p: RevenueSubject, projectRate: number | null | undefined): boolean {
  return priceOf(projectRate) != null
}

/**
 * N delivered above the top of the sold range on ONE line, or null when the
 * line has no delivered N or no cap. Over-delivery is a courtesy and is never
 * billed (David, 2026-09-24), so this is exactly the part of the delivered N
 * that `billedRevenue` leaves out: min(A, cap) + max(0, A − cap) = A.
 *
 * A cap of 0 is a cap: a survey sold at 0 bills nothing, so everything it
 * delivered is over-delivery, and billed + over still equals delivered.
 */
export function overOfLine(l: Pick<RevenueLine, 'nMin' | 'nMax' | 'nActual'>): number | null {
  const cap = capOf(l)
  if (l.nActual == null || cap == null) return null
  return Math.max(0, l.nActual - cap)
}

/**
 * N delivered above the survey's sold range — the same rule as the bill, on
 * the survey as a whole. A segment that delivered past its own target while
 * another fell short is NOT over-delivery when the survey is inside its range:
 * the invoice never saw the segments. null when there is no delivered N. A
 * survey with no cap reads 0: without a target there is nothing to be above.
 *
 * Price-free. The hub prices these N at our own cost per complete (money we
 * spent on interviews nobody pays for); the project page prices them at the
 * client rate (what they would have been worth).
 */
export function overDeliveredOf(p: RevenueSubject): number | null {
  const l = surveyLineOf(p, 0)
  if (l.nActual == null) return null
  return overOfLine(l) ?? 0
}

/**
 * The value of the N a survey was short of, at the survey's own price — what
 * "revenue foregone" means. Measured on the survey as a whole against
 * n_target, the N SOLD: delivering inside a sold range is not a shortfall, and
 * a segment's shortfall is not one while the survey delivered what it sold.
 * null when the survey has no delivered N; dollars null when it has no price.
 */
export function shortfallOf(
  p: RevenueSubject, projectRate: number | null | undefined,
): { n: number; dollars: number | null } | null {
  const l = surveyLineOf(p, projectRate)
  if (l.nActual == null) return null
  if (l.nMin == null || !(l.nMin > 0)) return { n: 0, dollars: 0 }
  const n = Math.max(0, l.nMin - l.nActual)
  return { n, dollars: l.rate == null ? null : n * l.rate }
}

/** What the segments say about the survey's N, for the words beside a note. */
export interface SegmentCheck {
  /** How many segments the survey has. 0 = not segmented. */
  segments: number
  /** Segments with no N actual. */
  missing: number
  /** Σ segment N actuals over the segments that have one. null when none do. */
  segmentSum: number | null
  /** The survey's own n_actual — the figure the bill uses. */
  surveyN: number | null
  /** segmentsDisagree(p). */
  disagree: boolean
  /** The survey's N actual is EXACTLY the sum of the segments that have a count
   *  while at least one segment has none — the 078 trigger's roll-up of a
   *  partial set, so it counts only part of the survey. The bill still reads it;
   *  a per-respondent measure must not divide by it (perRespondentNOf). Always
   *  also `disagree`. */
  partialRollUp: boolean
}

export function segmentCheck(p: RevenueSubject): SegmentCheck {
  const segs = p.segments ?? []
  const known = segs.map(s => num(s.n_actual)).filter((n): n is number => n != null)
  const surveyN = num(p.n_actual)
  const segmentSum = known.length ? known.reduce((t, n) => t + n, 0) : null
  const missing = segs.length - known.length
  let disagree = false
  if (segs.length > 0) {
    // The survey's own figure is blank: a full set of segment counts is the
    // roll-up case (marked on the revenue, not a disagreement); a partial set
    // is a count nobody can bill from.
    if (surveyN == null) disagree = known.length > 0 && missing > 0
    // A segment with no count cannot add up to anything; nor can a sum that
    // differs. The next segment edit would ALSO overwrite the survey's typed
    // figure with the partial sum (078), which is why it is worth fixing.
    else disagree = missing > 0 || segmentSum !== surveyN
  }
  // Equal to the counted segments' sum to the unit, with one uncounted: the
  // trigger's arithmetic, not somebody's statement about the whole survey. A
  // typed figure that differs from the sum is the whole survey's N as far as
  // anyone has said, and stays usable.
  const partialRollUp = missing > 0 && surveyN != null && segmentSum != null && surveyN === segmentSum
  return { segments: segs.length, missing, segmentSum, surveyN, disagree, partialRollUp }
}

/**
 * The delivered N a PER-RESPONDENT measure may divide by — cost per qualified
 * respondent, QA scrub (bought − delivered), over-delivery priced at cost, cost
 * per delivered N. `deliveredNOf`, except NULL when the survey's N actual is a
 * partial segment roll-up (`segmentCheck().partialRollUp`).
 *
 * The bill never reads this. Revenue, billed N, shortfall and the project page
 * stay on the survey's N actual whatever it holds, because that is what the
 * invoice reads (David, 2026-09-27). Only the ratios that set the WHOLE
 * survey's cost against its N need the N to cover the whole survey, and a
 * partial roll-up does not: it turns an uncounted segment into "scrubbed". A
 * caller that gets null leaves the survey out of the rate and lists it, never
 * divides by something else.
 */
export function perRespondentNOf(p: RevenueSubject): number | null {
  return segmentCheck(p).partialRollUp ? null : deliveredNOf(p).n
}

/** segmentCheck(p).partialRollUp, for callers that want only the yes/no. */
export function nActualIsPartialRollUp(p: RevenueSubject): boolean {
  return segmentCheck(p).partialRollUp
}

/**
 * The segments' N actuals do not add up to the survey's N actual — a segment
 * is missing its count, or the counts sum to something else. A DATA NOTE for
 * the Improve tab: the bill uses the survey's N actual either way, and nothing
 * here withholds or changes revenue because of it. False for a survey without
 * segments, and for one whose own figure is blank while every segment has one
 * (that is the roll-up, marked `nSource: 'segments'` on its revenue).
 */
export function segmentsDisagree(p: RevenueSubject): boolean {
  return segmentCheck(p).disagree
}

/**
 * A segment carries its own price per N (082) that is not the survey's rate —
 * or the survey has no rate at all while a segment does. A DATA NOTE: the
 * invoice uses one rate, so the override changes no figure; it is shown so the
 * two can be made to agree.
 */
export function segmentPriceDiffers(p: RevenueSubject, projectRate: number | null | undefined): boolean {
  const rate = priceOf(projectRate)
  return (p.segments ?? []).some(s => {
    const own = priceOf(s.price_per_n)
    return own != null && (rate == null || !samePrice(own, rate))
  })
}

/**
 * The share of the client price we aim to keep. A GUIDE and a starting goal,
 * not a rule (David, 2026-09-24): "if we can have 50% profit margins we'll be
 * in a great place." Drawn as a goal line and coloured against; never enforced
 * at intake, never turns intake amber.
 */
export const KEEP_GOAL = 0.5

/** Kept % = (price − cost) ÷ price, only where the price is above $0. */
export function keptPct(revenue: number | null | undefined, cost: number): number | null {
  return revenue != null && revenue > 0 ? (revenue - cost) / revenue : null
}

/** Anything ÷ price ("cents per $1"), only where the price is above $0. */
export function perDollarOfPrice(x: number | null | undefined, revenue: number | null | undefined): number | null {
  return x != null && revenue != null && revenue > 0 ? x / revenue : null
}

/** The budget "Set a budget" may SUGGEST: KEEP_GOAL of price × N sold. A
 *  suggestion only — see KEEP_GOAL. null without a price above $0 or a target. */
export function suggestedBudget(rate: number | null | undefined, nTarget: number | null | undefined): number | null {
  const r = priceOf(rate), t = num(nTarget)
  return r != null && r > 0 && t != null && t > 0 ? (1 - KEEP_GOAL) * r * t : null
}

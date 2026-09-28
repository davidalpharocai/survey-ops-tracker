import { describe, it, expect } from 'vitest'
import {
  revenueOf, revenueDetail, billedNOf, billedRevenue, hasPrice, surveyLineOf, deliveredNOf,
  shortfallOf, keptPct, perDollarOfPrice, suggestedBudget, KEEP_GOAL, invoicedAmountOf,
  overDeliveredOf, overOfLine, segmentsDisagree, segmentPriceDiffers, segmentCheck,
  perRespondentNOf, nActualIsPartialRollUp,
} from './revenue'
import {
  marginOf, foregone, moneyLost,
  accountOf, accountOptions, contactOptions, applyFilters, spendByClient, isCancelled,
  NO_CONTACT,
  type FinProject, type FinBlast, type FinSupplier, type FinContact, type FinSegment,
} from './hub'

/**
 * Guards THE revenue function (lib/finance/revenue.ts) and the hub figures
 * built on it.
 *
 * The rule, from David on 2026-09-24: revenue = price × min(n_actual,
 * n_target_max ?? n_target). Only the post-QA N is billed; over-delivery is a
 * courtesy and never billed; the collected (pre-QA) count is never a fallback;
 * revenue is null — not 0 — when the price, the delivered N or the cap is
 * missing; and a price of exactly $0 is a real price that is $0 in every dollar
 * total and excluded from every per-survey ratio. And from 2026-09-27: all of it
 * on the SURVEY — its one rate, its N actual, its cap. Segments never split,
 * cap or block the bill; when they disagree with the survey it is a note.
 *
 * The mistakes these tests exist to stop were all made against real numbers:
 * five copies of the formula that disagreed on $0 and on the cap (the project
 * page was $96,480 away from the hub), a margin lifted by surveys carrying
 * revenue and no cost, a margin drill that could not reconcile to its own
 * headline, and an account split nine ways by a stale label.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'BAM', client_id: 'acc1',
  project_type: 'PS', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, requested_by_contact_id: null, ...o,
})
const SEG = (o: Partial<FinSegment> = {}): FinSegment => ({
  id: 's1', project_id: 'p1', n_target: null, n_target_max: null, n_actual: null, price_per_n: null, ...o,
})
const CT = (o: Partial<FinContact> = {}): FinContact => ({
  id: 'c1', client_id: 'acc1', first_name: 'James', last_name: 'Cook', email: null, ...o,
})
const blast = (project_id: string, bid: number, completes: number): FinBlast =>
  ({ project_id, bid, completes, people: 0, cost_per_send: 0, channel: 'sms' })

describe('revenueOf: price × min(n_actual, top of the sold range)', () => {
  it('bills the N sold when we over-delivered — over-delivery is never billed', () => {
    // 1,300 delivered against a 1,000 target at $50 bills 1,000. The extra 300
    // earns nothing at all: it is a courtesy, and nobody chases it afterwards.
    expect(revenueOf(P({ n_target: 1000, n_actual: 1300 }), 50)).toBe(50_000)
  })

  it('caps at the TOP of a sold range, so delivery inside the range bills', () => {
    const p = P({ n_target: 1000, n_target_max: 1200, n_actual: 1150 })
    expect(revenueOf(p, 10)).toBe(11_500)
    expect(revenueOf(P({ n_target: 1000, n_target_max: 1200, n_actual: 1400 }), 10)).toBe(12_000)
  })

  it('bills what we delivered when we came up short', () => {
    expect(revenueOf(P({ n_target: 1000, n_actual: 800 }), 50)).toBe(40_000)
  })

  it('NEVER falls back to the collected (pre-QA) count', () => {
    // PR00151's shape: a price and 481 collected, no delivered N yet. The old
    // project page booked ~$96k off the collected count. There is no revenue
    // until the post-QA figure exists.
    const r = revenueDetail(P({ n_target: 500, n_collected: 481, n_actual: null }), 3)
    expect(r.revenue).toBeNull()
    expect(r.reason).toBe('no-n-actual')
    expect(r.priced).toBe(true)
  })

  it('returns null — not 0 — when there is no price', () => {
    // 0 would be a claim that the survey earned nothing. null is the truth:
    // nobody wrote down what it earns.
    expect(revenueOf(P({ n_target: 100, n_actual: 100 }), null)).toBeNull()
    expect(revenueOf(P({ n_target: 100, n_actual: 100 }), undefined)).toBeNull()
    expect(revenueDetail(P({ n_target: 100, n_actual: 100 }), null).reason).toBe('no-price')
  })

  it('returns null when there is no cap to bill against', () => {
    const r = revenueDetail(P({ n_target: null, n_actual: 500 }), 50)
    expect(r.revenue).toBeNull()
    expect(r.reason).toBe('no-cap')
    expect(r.billedN).toBeNull()
  })

  it('treats a price of exactly $0 as a REAL price: $0 of revenue, never a ratio', () => {
    // David confirmed the $0 surveys on file are deliberate (internal work,
    // free trials). Zero is the price, so the survey books $0 of revenue
    // against its real cost — and $0 must never divide.
    const r = revenueDetail(P({ n_target: 1000, n_actual: 1000 }), 0)
    expect(r).toMatchObject({ revenue: 0, priced: true, free: true, ratioEligible: false, reason: 'ok' })
    expect(keptPct(r.revenue, 500)).toBeNull()
    expect(perDollarOfPrice(500, r.revenue)).toBeNull()
  })

  it('a priced survey that delivered 0 bills $0 but is not "given away"', () => {
    const r = revenueDetail(P({ n_target: 100, n_actual: 0 }), 50)
    expect(r).toMatchObject({ revenue: 0, free: false, ratioEligible: false })
  })

  it('refuses a negative price rather than flipping the sign of the book', () => {
    expect(revenueOf(P({ n_target: 10, n_actual: 10 }), -5)).toBeNull()
  })

  it('reads numeric strings, which is how PostgREST can return numeric columns', () => {
    const p = P({ n_target: '100' as unknown as number, n_actual: '90' as unknown as number })
    expect(revenueOf(p, '12.5' as unknown as number)).toBe(1125)
  })
})

describe('segments never split the bill (David, 2026-09-27)', () => {
  // "when we bill its just the n actual. we dont break it out usually on the
  // invoice by segment." One rate, the survey's N actual, the survey's cap.

  it('bills a survey that delivered what it sold in full, however its segments split', () => {
    // Buyers 120 of 100, Sellers 80 of 100, survey 200 of 200. Billed segment
    // by segment this read 180 billed, 20 over and 20 short — none of which is
    // on the invoice.
    const p = P({
      n_target: 200, n_actual: 200,
      segments: [
        SEG({ id: 'buy', n_target: 100, n_actual: 120 }),
        SEG({ id: 'sell', n_target: 100, n_actual: 80 }),
      ],
    })
    expect(revenueDetail(p, 20)).toMatchObject({ revenue: 4000, billedN: 200, reason: 'ok', nSource: 'survey' })
    expect(billedNOf(p)).toBe(200)
    expect(overDeliveredOf(p)).toBe(0)
    expect(shortfallOf(p, 20)).toEqual({ n: 0, dollars: 0 })
    // They add up, so there is nothing to note either.
    expect(segmentsDisagree(p)).toBe(false)
  })

  it('bills at the survey rate — a segment override changes nothing but raises a note', () => {
    const p = P({
      n_target: 300, n_actual: 300,
      segments: [
        SEG({ id: 'a', n_target: 100, n_actual: 100, price_per_n: 8 }),
        SEG({ id: 'b', n_target: 200, n_actual: 200, price_per_n: null }),
      ],
    })
    // 300 × $5, not 100 × $8 + 200 × $5.
    expect(revenueOf(p, 5)).toBe(1500)
    expect(revenueDetail(p, 5).rate).toBe(5)
    expect(segmentPriceDiffers(p, 5)).toBe(true)
    // An override equal to the survey rate is no difference at all.
    expect(segmentPriceDiffers(P({ segments: [SEG({ price_per_n: 5 })] }), 5)).toBe(false)
    expect(segmentPriceDiffers(P({ segments: [SEG({ price_per_n: '5.00' as unknown as number })] }), 5)).toBe(false)
  })

  it('a $0 segment override does not zero the bill, and a segment price never prices the survey', () => {
    const free = P({ n_target: 100, n_actual: 100, segments: [SEG({ n_target: 100, n_actual: 100, price_per_n: 0 })] })
    expect(revenueOf(free, 5)).toBe(500)
    expect(segmentPriceDiffers(free, 5)).toBe(true)
    // No survey rate: unpriced, whatever the segments carry — and the note
    // says a segment has a price the survey lacks.
    const segOnly = P({ n_target: 20, n_actual: 20, segments: [SEG({ id: 'a', n_target: 10, n_actual: 10, price_per_n: 5 }), SEG({ id: 'b', n_target: 10, n_actual: 10, price_per_n: 5 })] })
    expect(hasPrice(segOnly, null)).toBe(false)
    expect(revenueDetail(segOnly, null)).toMatchObject({ revenue: null, reason: 'no-price', billedN: 20 })
    expect(segmentPriceDiffers(segOnly, null)).toBe(true)
  })

  it('bills the survey N actual when a segment is still missing its count (PR00231), and notes it', () => {
    // The 078 roll-up made the survey read 342; one segment has no count. The
    // survey's N actual is what the invoice uses, so it bills 342 — it used to
    // be blocked outright.
    const p = P({
      n_target: 5000, n_collected: 9086, n_actual: 342,
      segments: [
        SEG({ id: 'a', n_target: 400, n_actual: 342 }),
        SEG({ id: 'b', n_target: 4600, n_actual: null }),
      ],
    })
    expect(revenueDetail(p, 5)).toMatchObject({ revenue: 1710, billedN: 342, reason: 'ok', nSource: 'survey' })
    expect(shortfallOf(p, 5)).toEqual({ n: 5000 - 342, dollars: (5000 - 342) * 5 })
    expect(overDeliveredOf(p)).toBe(0)
    expect(segmentsDisagree(p)).toBe(true)
    expect(segmentCheck(p)).toMatchObject({
      segments: 2, missing: 1, segmentSum: 342, surveyN: 342, disagree: true, partialRollUp: true,
    })
  })

  it('gives a per-respondent measure NO N when the survey N actual is only the partial roll-up (PR00231)', () => {
    // 342 is the one counted segment and nothing more; the cost covers both. The
    // bill above still reads 342. A rate must not: 9,086 bought over 342 reads
    // as 96% scrubbed, when most of it is a segment nobody has counted.
    const p = P({
      n_target: 5000, n_collected: 9086, n_actual: 342,
      segments: [SEG({ id: 'a', n_target: 400, n_actual: 342 }), SEG({ id: 'b', n_target: 4600, n_actual: null })],
    })
    expect(nActualIsPartialRollUp(p)).toBe(true)
    expect(perRespondentNOf(p)).toBeNull()
    expect(deliveredNOf(p).n).toBe(342)
    expect(revenueDetail(p, 5).billedN).toBe(342)
  })

  it('keeps a TYPED survey N actual for per-respondent measures, even with a segment uncounted', () => {
    // PR00257 / PR00288 / PR00230 shape: somebody stated the whole survey's N,
    // and it is not the counted segments' sum. It is the survey's figure; the
    // segments are a note.
    const typed = P({
      n_target: 500, n_actual: 400,
      segments: [SEG({ id: 'a', n_target: 250, n_actual: 342 }), SEG({ id: 'b', n_target: 250, n_actual: null })],
    })
    expect(segmentCheck(typed)).toMatchObject({ disagree: true, partialRollUp: false, segmentSum: 342, surveyN: 400 })
    expect(perRespondentNOf(typed)).toBe(400)
    // Typed with no segment counted at all: nothing to be a roll-up of.
    const none = P({ n_actual: 100, segments: [SEG({ id: 'a', n_actual: null })] })
    expect(perRespondentNOf(none)).toBe(100)
    // Every segment counted is never partial, whatever the survey says.
    const full = P({ n_actual: 190, segments: [SEG({ id: 'a', n_actual: 90 }), SEG({ id: 'b', n_actual: 90 })] })
    expect(nActualIsPartialRollUp(full)).toBe(false)
    expect(perRespondentNOf(full)).toBe(190)
    // Not segmented, or blank everywhere: exactly the delivered N.
    expect(perRespondentNOf(P({ n_actual: 55 }))).toBe(55)
    expect(perRespondentNOf(P({ n_actual: null, segments: [SEG({ id: 'a' }), SEG({ id: 'b' })] }))).toBeNull()
    expect(nActualIsPartialRollUp(P({ n_actual: null, segments: [SEG({ id: 'a' }), SEG({ id: 'b' })] }))).toBe(false)
  })

  it('notes segments that add up to a different number, and still bills the survey', () => {
    // Someone typed the survey's N actual directly (the project page allows it).
    const p = P({
      n_target: 200, n_actual: 190,
      segments: [SEG({ id: 'a', n_target: 100, n_actual: 90 }), SEG({ id: 'b', n_target: 100, n_actual: 90 })],
    })
    expect(revenueOf(p, 10)).toBe(1900)
    expect(segmentsDisagree(p)).toBe(true)
    expect(segmentCheck(p)).toMatchObject({ segmentSum: 180, surveyN: 190, missing: 0, partialRollUp: false })
  })

  it('rolls up a BLANK survey N actual only when every segment has one, and says so', () => {
    const full = P({
      n_target: 200, n_actual: null,
      segments: [SEG({ id: 'a', n_target: 100, n_actual: 120 }), SEG({ id: 'b', n_target: 100, n_actual: 80 })],
    })
    expect(deliveredNOf(full)).toEqual({ n: 200, source: 'segments' })
    expect(revenueDetail(full, 20)).toMatchObject({ revenue: 4000, billedN: 200, nSource: 'segments', reason: 'ok' })
    // The roll-up is marked on the revenue, not raised as a disagreement.
    expect(segmentsDisagree(full)).toBe(false)
    // One segment short of a count: no delivered N at all, never a partial sum.
    const half = P({
      n_target: 200, n_actual: null,
      segments: [SEG({ id: 'a', n_target: 100, n_actual: 120 }), SEG({ id: 'b', n_target: 100, n_actual: null })],
    })
    expect(deliveredNOf(half)).toEqual({ n: null, source: null })
    expect(revenueDetail(half, 20)).toMatchObject({ revenue: null, reason: 'no-n-actual', nSource: null })
    expect(segmentsDisagree(half)).toBe(true)
    // A survey with no segments and no N actual has nothing to roll up.
    expect(revenueDetail(P({ n_target: 10 }), 20).nSource).toBeNull()
  })

  it('flags a typed survey N actual whose segments have no counts — the next segment edit would blank it', () => {
    const p = P({ n_target: 100, n_actual: 100, segments: [SEG({ id: 'a', n_target: 100, n_actual: null })] })
    expect(revenueOf(p, 3)).toBe(300)
    expect(segmentsDisagree(p)).toBe(true)
    // No segments, or none counted and none on the survey: nothing to disagree.
    expect(segmentsDisagree(P({ n_actual: 10 }))).toBe(false)
    expect(segmentsDisagree(P({ segments: [SEG({ id: 'a' }), SEG({ id: 'b' })] }))).toBe(false)
  })

  it('measures over-delivery on the survey, so billed + over = delivered', () => {
    // PR00251's shape: 132 delivered against 130 sold. Segment by segment 32 N
    // went above what each segment sold, and the old rule refused to bill them;
    // on the invoice it is 130 billed and 2 over.
    const p = P({
      n_target: 130, n_actual: 132,
      segments: [
        SEG({ id: 'fam', n_target: 30, n_actual: 19 }),
        SEG({ id: 'spo', n_target: 30, n_actual: 32 }),
        SEG({ id: 'lif', n_target: 30, n_actual: 11 }),
        SEG({ id: 'dep', n_target: 20, n_actual: 30 }),
        SEG({ id: 'off', n_target: 20, n_actual: 34 }),
        SEG({ id: 'oth', n_target: 0, n_actual: 6 }),
      ],
    })
    expect(overDeliveredOf(p)).toBe(2)
    expect(billedNOf(p)).toBe(130)
    expect((billedNOf(p) ?? 0) + (overDeliveredOf(p) ?? 0)).toBe(132)
    expect(revenueOf(p, 125)).toBe(130 * 125)
    // Not short: the survey delivered more than it sold.
    expect(shortfallOf(p, 125)).toEqual({ n: 0, dollars: 0 })
  })

  it('has no over-delivery figure when the delivered N cannot be read', () => {
    expect(overDeliveredOf(P({ n_target: 100, n_actual: null }))).toBeNull()
    expect(overDeliveredOf(P({ n_target: 20, n_actual: null, segments: [SEG({ id: 'a', n_target: 10, n_actual: 12 }), SEG({ id: 'b', n_target: 10, n_actual: null })] }))).toBeNull()
    // A line with no cap has nothing to be above.
    expect(overOfLine({ nMin: null, nMax: null, nActual: 50 })).toBeNull()
    expect(overDeliveredOf(P({ n_target: null, n_actual: 50 }))).toBe(0)
    expect(overDeliveredOf(P({ n_target: 100, n_target_max: 120, n_actual: 130 }))).toBe(10)
  })

  it('the survey is one line, whatever its segments', () => {
    expect(surveyLineOf(P({ n_target: 10, n_target_max: 12, n_actual: 11 }), 3)).toEqual(
      { rate: 3, nMin: 10, nMax: 12, nActual: 11 },
    )
    expect(surveyLineOf(P({ n_target: 10, n_actual: 11, segments: [SEG({ n_target: 4, n_actual: 99, price_per_n: 7 })] }), 3)).toEqual(
      { rate: 3, nMin: 10, nMax: null, nActual: 11 },
    )
  })
})

describe('billedRevenue: the shared arithmetic', () => {
  it('is what the project page and the hub both call', () => {
    const r = billedRevenue({ rate: 100, nMin: 50, nMax: 70, nActual: 65 })
    expect(r).toMatchObject({ revenue: 6500, billedN: 65, reason: 'ok' })
  })
})

describe('the invoice seam', () => {
  it('returns nothing today — there is no invoice table yet', () => {
    expect(invoicedAmountOf(P())).toBeNull()
    expect(revenueDetail(P({ n_target: 10, n_actual: 10 }), 5).source).toBe('computed')
  })
})

describe('shortfallOf: revenue foregone, on the survey', () => {
  it('is measured against the N SOLD, not the top of the range', () => {
    // Delivering inside a sold range is not a shortfall.
    expect(shortfallOf(P({ n_target: 100, n_target_max: 150, n_actual: 120 }), 10)).toEqual({ n: 0, dollars: 0 })
    expect(shortfallOf(P({ n_target: 100, n_target_max: 150, n_actual: 80 }), 10)).toEqual({ n: 20, dollars: 200 })
  })

  it('prices a shortfall with no price as unknown dollars, not $0', () => {
    expect(shortfallOf(P({ n_target: 100, n_actual: 80 }), null)).toEqual({ n: 20, dollars: null })
  })
})

describe('the 50% goal is a guide', () => {
  it('suggests a budget at the goal share of price × N sold, and only suggests', () => {
    expect(KEEP_GOAL).toBe(0.5)
    expect(suggestedBudget(10, 1000)).toBe(5000)
    expect(suggestedBudget(0, 1000)).toBeNull()
    expect(suggestedBudget(10, null)).toBeNull()
  })
})

describe('marginOf: the flattering number that must never print', () => {
  it('EXCLUDES priced surveys with no recorded cost, and says how many', () => {
    // Survey B has revenue and no cost; counting it reports 100% margin on B and
    // lifts the blended figure. The exclusion is the point.
    const rows = [
      P({ id: 'a', n_target: 100, n_actual: 100 }),
      P({ id: 'b', n_target: 100, n_actual: 100 }),
    ]
    const rates = new Map([['a', 50], ['b', 50]])
    const m = marginOf(rows, rates, [blast('a', 10, 100)], [], [])
    expect(m).toMatchObject({ revenue: 5000, cost: 1000, margin: 4000, surveys: 1, ids: ['a'] })
    expect(m.pct).toBeCloseTo(0.8)
    expect(m).toMatchObject({ pricedNoCost: 1, pricedNoCostRevenue: 5000, pricedNoCostIds: ['b'] })
  })

  it('counts the unpriced delivered surveys it cannot see, and their spend', () => {
    const rows = [P({ id: 'a', n_target: 10, n_actual: 10 }), P({ id: 'b' }), P({ id: 'c' })]
    const m = marginOf(rows, new Map([['a', 5]]), [blast('a', 1, 10), blast('b', 2, 10)], [], [])
    expect(m).toMatchObject({ delivered: 3, unpriced: 2, surveys: 1, spendNoPrice: 20, surveysNoPrice: 1 })
  })

  it('separates "carries a price" from "yields a revenue figure" from "has no price"', () => {
    // b has a price but no N: it is one field from the margin set, listed as
    // pricedBlocked — never lost among the unpriced. c is priced at a real $0
    // and DOES yield a figure: $0.
    const rows = [
      P({ id: 'a', n_target: 10, n_actual: 10 }),
      P({ id: 'b', n_target: null, n_actual: null }),
      P({ id: 'c', n_target: 10, n_actual: 10 }),
      P({ id: 'd' }),
    ]
    const m = marginOf(rows, new Map([['a', 5], ['b', 5], ['c', 0]]),
      [blast('a', 1, 10), blast('c', 1, 10)], [], [])
    expect(m).toMatchObject({ delivered: 4, rated: 3, unpriced: 1, pricedBlocked: 1, surveys: 2 })
    expect(m.pricedBlockedIds).toEqual(['b'])
    // The free survey contributes its cost and no revenue, which is the point.
    expect(m.revenue).toBe(50)
    expect(m.cost).toBe(20)
  })

  it('reports the book both ways: with the $0 surveys, and on paid work only', () => {
    const rows = [
      P({ id: 'paid', n_target: 100, n_actual: 100 }),
      P({ id: 'free', n_target: 100, n_actual: 100 }),
    ]
    const m = marginOf(rows, new Map([['paid', 10], ['free', 0]]),
      [blast('paid', 4, 100), blast('free', 2, 100)], [], [])
    // Book: $1,000 price, $600 cost, 40% kept. Paid work: $1,000 against $400.
    expect(m.pct).toBeCloseTo(0.4)
    expect(m.paid).toMatchObject({ surveys: 1, revenue: 1000, cost: 400 })
    expect(m.paid.pct).toBeCloseTo(0.6)
    expect(m.free).toMatchObject({ surveys: 1, cost: 200, ids: ['free'] })
  })

  it('ignores work that is not delivered', () => {
    const rows = [P({ id: 'a', board_column: 'Fielding', n_target: 10, n_actual: 10 })]
    expect(marginOf(rows, new Map([['a', 5]]), [blast('a', 1, 10)], [], []).delivered).toBe(0)
  })

  it('reports pct as null — not 0, not NaN — when nothing is priced', () => {
    expect(marginOf([P()], new Map(), [], [], []).pct).toBeNull()
  })

  it('skips an empty rerun placeholder entirely', () => {
    const rows = [P({ id: 'shell', is_placeholder: true })]
    expect(marginOf(rows, new Map([['shell', 5]]), [], [], []).delivered).toBe(0)
  })
})

describe('foregone: revenue we never billed', () => {
  it('prices short delivery at the CLIENT price', () => {
    // Sold 1,000, handed over 800, at $50 = $10,000 of revenue not earned.
    const rows = [P({ id: 'a', n_target: 1000, n_actual: 800 })]
    expect(foregone(rows, new Map([['a', 50]]))).toMatchObject(
      { surveys: 1, n: 200, dollars: 10_000, ids: ['a'] },
    )
  })

  it('never counts over-delivery as foregone revenue', () => {
    const rows = [P({ id: 'a', n_target: 1000, n_actual: 1300 })]
    expect(foregone(rows, new Map([['a', 50]])).n).toBe(0)
  })

  it('reports short surveys it cannot price SEPARATELY, never as zero', () => {
    const rows = [
      P({ id: 'a', n_target: 100, n_actual: 60 }),
      P({ id: 'b', n_target: 100, n_actual: 10 }),
    ]
    const f = foregone(rows, new Map([['a', 10]]))
    expect(f).toMatchObject({ surveys: 1, n: 40, dollars: 400, unpricedSurveys: 1, unpricedN: 90 })
  })

  it('counts a short $0 trial as priced at $0, not as unpriced', () => {
    const f = foregone([P({ id: 'a', n_target: 100, n_actual: 60 })], new Map([['a', 0]]))
    expect(f).toMatchObject({ surveys: 1, n: 40, dollars: 0, unpricedSurveys: 0 })
  })

  it('measures a segmented survey on its own N actual, never segment by segment', () => {
    // A segment missing its count no longer holds the survey apart: the
    // survey's N actual is what the invoice uses, so 150 of 200 short at $10.
    const p = P({ id: 'a', n_target: 200, n_actual: 50, segments: [
      SEG({ id: 'x', project_id: 'a', n_target: 100, n_actual: 50 }),
      SEG({ id: 'y', project_id: 'a', n_target: 100, n_actual: null }),
    ] })
    expect(foregone([p], new Map([['a', 10]]))).toMatchObject({ surveys: 1, n: 150, dollars: 1500, ids: ['a'] })
    // Buyers 80 of 100 and Sellers 120 of 100 is 200 of 200: nothing foregone.
    const even = P({ id: 'b', n_target: 200, n_actual: 200, segments: [
      SEG({ id: 'x', project_id: 'b', n_target: 100, n_actual: 80 }),
      SEG({ id: 'y', project_id: 'b', n_target: 100, n_actual: 120 }),
    ] })
    expect(foregone([even], new Map([['b', 10]]))).toMatchObject({ surveys: 0, n: 0, dollars: 0 })
  })
})

describe('moneyLost: cash that left for N we cannot bill', () => {
  it('splits over-target from scrub and prices BOTH at this survey own cost', () => {
    // 1,000 target, 1,300 collected, 1,100 survived QA, $2 a complete:
    //   over-target = 1100 - 1000 = 100 -> $200
    //   scrub       = 1300 - 1100 = 200 -> $400
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    const m = moneyLost(rows, [], s, [])
    expect(m.overTarget).toMatchObject({ surveys: 1, n: 100 })
    expect(m.overTarget.dollars).toBeCloseTo(200)
    expect(m.scrub).toMatchObject({ surveys: 1, n: 200 })
    expect(m.scrub.dollars).toBeCloseTo(400)
  })

  it('measures over-delivery against the TOP of the sold range', () => {
    const rows = [P({ id: 'x', n_target: 1000, n_target_max: 1100, n_collected: 1300, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    expect(moneyLost(rows, [], s, []).overTarget.n).toBe(0)
  })

  it('counts scrub that cost cash but cost NO revenue', () => {
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    expect(moneyLost(rows, [], s, []).scrubStillHitTarget).toBe(1)
  })

  it('does not count scrub as billing-safe when it dragged us under target', () => {
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 900 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    expect(moneyLost(rows, [], s, []).scrubStillHitTarget).toBe(0)
  })

  it('keeps the N of an uncosted survey rather than dropping it silently', () => {
    const rows = [P({ id: 'x', n_target: 100, n_collected: 300, n_actual: 250 })]
    const m = moneyLost(rows, [], [], [])
    expect(m).toMatchObject({ uncostedSurveys: 1, uncostedN: 200 })
    expect(m.scrub.dollars).toBe(0)
  })

  it('says nothing about a survey with no n_actual', () => {
    const rows = [P({ id: 'x', n_target: 100, n_collected: 300, n_actual: null })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 1, n_collected: 300 }]
    expect(moneyLost(rows, [], s, []).scrub.surveys).toBe(0)
  })

  it('leaves a partial segment roll-up out of scrub and over-delivery, and lists it (PR00231)', () => {
    // Its survey N actual (342) is the one counted segment. Bought − 342 would
    // call the uncounted segment's interviews "lost in QA" — on live data that
    // was most of a survey's cost booked as scrub. The bill is untouched; the
    // scrub is unknown, so it is listed with its money instead of measured.
    const rows = [P({ id: 'x', n_target: 5000, n_collected: 9086, n_actual: 342, segments: [
      SEG({ id: 'a', project_id: 'x', n_target: 400, n_actual: 342 }),
      SEG({ id: 'b', project_id: 'x', n_target: 4600, n_actual: null }),
    ] })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 1, n_collected: 9086 }]
    const m = moneyLost(rows, [], s, [])
    expect(m.scrub).toMatchObject({ surveys: 0, n: 0, dollars: 0, ids: [] })
    expect(m.overTarget).toMatchObject({ surveys: 0, ids: [] })
    expect(m.partialRollUp).toEqual({ surveys: 1, spend: 9086, collected: 9086, ids: ['x'] })
    // Not an "uncosted" survey either: its cost is recorded.
    expect(m.uncostedSurveys).toBe(0)
  })

  it('still reads scrub off a TYPED survey N actual whose segments do not add up', () => {
    // The survey's N actual (500) is not the counted segment's 342: somebody
    // stated the whole survey. It stays in, at that N.
    const rows = [P({ id: 'x', n_target: 500, n_collected: 700, n_actual: 500, segments: [
      SEG({ id: 'a', project_id: 'x', n_target: 250, n_actual: 342 }),
      SEG({ id: 'b', project_id: 'x', n_target: 250, n_actual: null }),
    ] })]
    const m = moneyLost(rows, [], [{ project_id: 'x', cpi: 1, n_collected: 700 }], [])
    expect(m.scrub).toMatchObject({ surveys: 1, n: 200, ids: ['x'] })
    expect(m.partialRollUp.surveys).toBe(0)
  })

  it('measures a segmented survey on the survey, as its bill is capped', () => {
    // 90 delivered of 90 sold: nothing over, although segment A delivered 60
    // against its own 50 — the invoice never saw the segments.
    const rows = [P({ id: 'x', n_target: 90, n_collected: 110, n_actual: 90, segments: [
      SEG({ id: 'a', project_id: 'x', n_target: 50, n_target_max: 50, n_actual: 60 }),
      SEG({ id: 'b', project_id: 'x', n_target: 40, n_actual: 30 }),
    ] })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 110 }]
    const m = moneyLost(rows, [], s, [])
    expect(m.overTarget).toMatchObject({ surveys: 0, n: 0, ids: [] })
    expect(m.scrub).toMatchObject({ surveys: 1, n: 20 })
    // Over the survey's own cap is over, segments or not.
    const over = [P({ id: 'y', n_target: 90, n_collected: 110, n_actual: 100, segments: [
      SEG({ id: 'a', project_id: 'y', n_target: 50, n_actual: 50 }),
      SEG({ id: 'b', project_id: 'y', n_target: 40, n_actual: 50 }),
    ] })]
    const m2 = moneyLost(over, [], [{ project_id: 'y', cpi: 2, n_collected: 110 }], [])
    expect(m2.overTarget).toMatchObject({ surveys: 1, n: 10, ids: ['y'] })
    expect(m2.overTarget.dollars).toBeCloseTo(20)
  })

  it('ignores a survey with no target rather than treating target as 0', () => {
    // target 0 would make every complete "over target".
    const rows = [P({ id: 'x', n_target: null, n_collected: 300, n_actual: 300 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 1, n_collected: 300 }]
    expect(moneyLost(rows, [], s, []).overTarget.n).toBe(0)
  })
})

describe('the two halves are not addable', () => {
  it('reports foregone in client dollars and lost in cost dollars', () => {
    const short = [P({ id: 'a', n_target: 1000, n_actual: 900 })]
    const over = [P({ id: 'b', n_target: 1000, n_collected: 1100, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'b', cpi: 1, n_collected: 1100 }]
    expect(foregone(short, new Map([['a', 50]])).dollars).toBe(5000)
    expect(moneyLost(over, [], s, []).overTarget.dollars).toBeCloseTo(100)
  })
})

describe('the account is the key, never the label', () => {
  const acc = new Map([['acc1', 'BAM']])

  it('resolves nine stale labels to one account', () => {
    // These are real production labels. Grouped by string they are nine
    // accounts; grouped by key they are one, and it is the largest we have.
    const labels = ['BAM', 'BAM - James Cook', 'BAM - Grey Jones', 'BAM - Elliot']
    const names = labels.map(l => accountOf(P({ client: l, client_id: 'acc1' }), acc))
    expect(new Set(names)).toEqual(new Set(['BAM']))
  })

  it('falls back to the label when there is no key, rather than dropping the row', () => {
    expect(accountOf(P({ client: 'Tiger', client_id: null }), acc)).toBe('Tiger')
    expect(accountOf(P({ client: null, client_id: null }), acc)).toBe('(no account)')
  })

  it('rolls spend up to the account, not the label', () => {
    const rows = [
      P({ id: 'a', client: 'BAM - James Cook', client_id: 'acc1' }),
      P({ id: 'b', client: 'BAM', client_id: 'acc1' }),
    ]
    const r = spendByClient(rows, [blast('a', 10, 5), blast('b', 10, 5)], [], [], acc)
    expect(r.clients).toHaveLength(1)
    expect(r.clients[0]).toMatchObject({ client: 'BAM', total: 100, surveys: 2, costed: 2 })
  })

  it('offers only accounts that have a survey in view', () => {
    const rows = [P({ id: 'a', client_id: 'acc1' }), P({ id: 'b', client_id: 'acc1' }), P({ id: 'c', client_id: 'acc2' })]
    const opts = accountOptions(rows, [
      { id: 'acc1', name: 'BAM' }, { id: 'acc2', name: 'Coatue' }, { id: 'acc3', name: 'Never used' },
    ])
    expect(opts.map(o => o.name)).toEqual(['BAM', 'Coatue'])
    expect(opts[0].surveys).toBe(2)
  })

  it('sorts accounts alphabetically, not by size', () => {
    const rows = [
      P({ id: 'a', client_id: 'z' }), P({ id: 'b', client_id: 'z' }), P({ id: 'c', client_id: 'z' }),
      P({ id: 'd', client_id: 'm' }), P({ id: 'e', client_id: 'a' }),
    ]
    const opts = accountOptions(rows, [
      { id: 'z', name: 'Zulu' }, { id: 'm', name: 'Mike' }, { id: 'a', name: 'Alpha' },
    ])
    expect(opts.map(o => o.name)).toEqual(['Alpha', 'Mike', 'Zulu'])
  })
})

describe('the contact dropdown', () => {
  const rows = [
    P({ id: 'a', client_id: 'acc1', requested_by_contact_id: 'c1' }),
    P({ id: 'b', client_id: 'acc1', requested_by_contact_id: 'c1' }),
    P({ id: 'c', client_id: 'acc1', requested_by_contact_id: 'c2' }),
    P({ id: 'd', client_id: 'acc1', requested_by_contact_id: null }),
    P({ id: 'e', client_id: 'acc2', requested_by_contact_id: 'c3' }),
  ]
  const contacts = [
    CT({ id: 'c1', first_name: 'James', last_name: 'Cook' }),
    CT({ id: 'c2', first_name: 'Grey', last_name: 'Jones' }),
    CT({ id: 'c3', client_id: 'acc2', first_name: 'Other', last_name: 'Account' }),
    CT({ id: 'c9', first_name: 'Never', last_name: 'Asked' }),
  ]

  it('lists only contacts who actually requested a survey at this account', () => {
    const o = contactOptions(rows, contacts, 'acc1')
    expect(o.map(x => x.name)).toEqual(['Grey Jones', 'James Cook', 'No contact recorded'])
    expect(o.find(x => x.name === 'James Cook')!.surveys).toBe(2)
  })

  it('sorts contacts alphabetically but keeps the no-contact bucket last', () => {
    const o = contactOptions(rows, contacts, 'acc1')
    expect(o.at(-1)!.id).toBe(NO_CONTACT)
    const people = o.filter(x => x.id !== NO_CONTACT).map(x => x.name)
    expect(people).toEqual([...people].sort((a, b) => a.localeCompare(b)))
  })

  it('keeps the no-contact surveys reachable', () => {
    const o = contactOptions(rows, contacts, 'acc1')
    expect(o.find(x => x.id === NO_CONTACT)).toMatchObject({ surveys: 1 })
  })

  it('offers nothing until an account is chosen', () => {
    expect(contactOptions(rows, contacts, null)).toEqual([])
  })

  it('filters to the chosen contact, and to the no-contact bucket', () => {
    const route = () => 'none' as const
    expect(applyFilters(rows, { accountId: 'acc1', contactId: 'c1' }, route).map(r => r.id))
      .toEqual(['a', 'b'])
    expect(applyFilters(rows, { accountId: 'acc1', contactId: NO_CONTACT }, route).map(r => r.id))
      .toEqual(['d'])
  })

  it('filters by account through the key, so the stale label cannot split it', () => {
    const mixed = [
      P({ id: 'a', client: 'BAM - James Cook', client_id: 'acc1' }),
      P({ id: 'b', client: 'BAM', client_id: 'acc1' }),
      P({ id: 'c', client: 'Coatue', client_id: 'acc2' }),
    ]
    expect(applyFilters(mixed, { accountId: 'acc1' }, () => 'none').map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('cancelled work counts — David, 2026-09-15', () => {
  const CANC = (o: Partial<FinProject> = {}) =>
    P({ board_column: 'Submitted', status: 'Cancelled', cancelled_at: '2026-09-01', ...o })

  it('books the WHOLE spend of a cancelled survey as lost, not a slice', () => {
    const rows = [CANC({ id: 'x', n_collected: 4 })]
    const m = moneyLost(rows, [blast('x', 100, 7)], [], [])
    expect(m.cancelled).toMatchObject({ surveys: 1, n: 4, dollars: 700 })
    expect(m.scrub.dollars).toBe(0)
    expect(m.overTarget.dollars).toBe(0)
  })

  it('recognises a cancellation recorded on EITHER field', () => {
    expect(isCancelled(P({ status: 'Cancelled', cancelled_at: null }))).toBe(true)
    expect(isCancelled(P({ status: 'Closed', cancelled_at: '2026-01-01' }))).toBe(true)
    expect(isCancelled(P({ status: 'Closed', cancelled_at: null }))).toBe(false)
  })

  it('carries live spend separately, and never as a loss', () => {
    const rows = [P({ id: 'y', board_column: 'Fielding', status: 'Open', n_collected: 50 })]
    const m = moneyLost(rows, [blast('y', 10, 30)], [], [])
    expect(m.inFlight).toMatchObject({ surveys: 1, n: 50, dollars: 300 })
    expect(m.cancelled.dollars).toBe(0)
    expect(m.scrub.dollars + m.overTarget.dollars).toBe(0)
  })

  it('keeps a held survey in its own bucket, never in the live figure', () => {
    const rows = [P({ id: 'h', board_column: 'Fielding', status: 'Hold', n_collected: 5 })]
    const m = moneyLost(rows, [blast('h', 10, 5)], [], [])
    expect(m.hold).toMatchObject({ surveys: 1, dollars: 50 })
    expect(m.inFlight.dollars).toBe(0)
  })

  it('counts a delivered survey once, as delivered, even with a cancellation stamp', () => {
    // The classifier's order: Delivered beats everything (as the sales buckets
    // do). A study handed to the client is finished work.
    const rows = [CANC({ id: 'x', board_column: 'Delivery', n_target: 10, n_collected: 30, n_actual: 20 })]
    const m = moneyLost(rows, [blast('x', 1, 30)], [], [])
    expect(m.cancelled.surveys).toBe(0)
    expect(m.scrub.surveys).toBe(1)
  })

  it('charges cancelled cost against margin, but reports it apart', () => {
    const rows = [
      P({ id: 'a', n_target: 100, n_actual: 100 }),
      CANC({ id: 'c' }),
    ]
    const m = marginOf(rows, new Map([['a', 50]]), [blast('a', 10, 100), blast('c', 10, 20)], [], [])
    expect(m).toMatchObject({ revenue: 5000, cost: 1000, cancelledCost: 200, cancelledSurveys: 1 })
    expect(m.margin).toBe(4000)
    expect(m.marginAfterCancelled).toBe(3800)
    expect(m.pctAfterCancelled).toBeCloseTo(0.76)
  })
})

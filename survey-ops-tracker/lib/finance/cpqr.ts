/**
 * CPQR — Cost Per Qualified Respondent.
 *
 * David asked for this by name, for PS and B2B separately, 2026-09-15.
 *
 * ── WHY IT IS NOT THE SAME AS COST PER COMPLETE ─────────────────────────────
 * The finance hub already shows cost per complete: spend ÷ the completes we
 * PAID for. CPQR divides by the completes that survived data QA into the
 * deliverable — `n_actual`, what the client actually received. The gap between
 * the two is the scrub. It is not a rounding difference: both routes lose a
 * meaningful share of what they buy to QA, and a usable B2B respondent costs
 * tens of times a usable panel one. The figures themselves are computed on
 * every load and printed by the page, never quoted here, because they move
 * every time a recovery or a delivered N is booked.
 *
 * `perComplete` (spend ÷ completes bought) and `blended` (spend ÷ qualified)
 * are computed on EXACTLY the same surveys, so the gap between them IS the
 * scrub — that one population is what the per-respondent dumbbell draws. The
 * route cost-per-complete card in hub.ts (`routeCosts`) is a different
 * population and a different statistic, and the two must never be subtracted.
 *
 * ── THE RECONCILIATION GUARD IS NOT OPTIONAL ────────────────────────────────
 * The first version of this file had no guard and reported blast CPQR at
 * $37.31 blended against a $71.78 median — a portfolio figure HALF its own
 * median, and an implied QA yield of 116.5%. Both are impossible, and both were
 * rendered on the page.
 *
 * The cause: 17 delivered surveys record an n_actual LARGER than the completes
 * their own blast and supplier rows account for (PR00288 delivered 101 against
 * 52 recorded, PR00388 50 against 23). Their completes are under-logged, so
 * dividing spend by n_actual divides by a denominator the cost records do not
 * cover, and the cost per respondent comes out roughly half what it should be.
 *
 * So a survey only contributes if its recorded completes cover both the N it
 * collected and the N that survived QA. That drops roughly a third of costed
 * surveys, which is a lot, and the UI has to say so — but a rate computed on
 * records that do not reconcile is not a cheaper rate, it is a wrong one.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CLAIM ───────────────────────────────────
 * The finance page used to assert that "most of that gap is incidence, not
 * inefficiency". That cannot be shown from this database. Blast incidence is
 * measurable — `blastIncidence` below computes it on every load — but
 * PureSpectrum reach is never recorded (project_suppliers has no people-reached
 * column), so the panel side of the comparison does not exist. An unprovable
 * explanation in the same sentence as a measured ratio lends the ratio its
 * authority; the claim has been removed rather than softened.
 */

import { buildIndex, emptyPartialRollUp, isDelivered, spendOf, routeOf, legsOf, type FinBlast, type FinCost, type FinIndex, type FinProject, type FinSupplier, type Leg, type LegBlock, type PartialRollUpNote, type Route } from './hub'
// revenue.ts imports nothing, so this cannot cycle.
import { segmentsDisagree } from './revenue'

export interface Cpqr {
  route: 'blast' | 'panel'
  /** Total recorded spend ÷ total qualified N. The portfolio figure: it weights
   *  by survey size, which is what a cost-of-goods number should do. */
  blended: number
  /** The typical survey, which is a different question and usually a larger
   *  number — the portfolio figure is dragged down by a few big cheap studies. */
  median: number
  p25: number
  p75: number
  /** Surveys behind the median/quartiles. */
  n: number
  spend: number
  qualified: number
  /** Completes we paid for, so a caller can show CPQR beside cost-per-complete
   *  and let the scrub between them be visible rather than asserted. */
  paid: number
  /**
   * POOLED scrub: 1 − Σqualified/Σpaid. The share of every complete we bought
   * that never reached a client — the right number for costing the portfolio.
   *
   * It is NOT what happens on a typical survey, and the difference can be
   * large: one catastrophic survey moves the pooled figure a long way and the
   * median hardly at all. A card that prints the pooled ratio beside a median
   * CPQR invites a reader planning their next study to take a portfolio ratio
   * as the typical case, so both ship together. (A survey whose N actual is
   * only the roll-up of the segments that have a count — PR00231 — is left out
   * and counted in `partialHeldOut`: it would read an uncounted segment as
   * scrub. One whose typed N actual merely disagrees with its segments counts
   * at that N and is listed in `segmentNotes`.)
   */
  scrubRate: number
  /** MEDIAN per-survey scrub — what to expect on the NEXT survey. The routes
   *  tend to sit close together here and differ mostly in the tail, which is
   *  what the pooled figure is measuring. */
  scrubRateMedian: number
  /** p25/p75 of per-survey KEEP (qualified ÷ paid). The spread is the finding.
   *  Anyone planning a buy-multiple needs this, not a point estimate — a rule
   *  calibrated on the median under-buys on roughly half of all surveys, and
   *  1 ÷ keepP25 is the multiple that covers three surveys in four. */
  keepP25: number
  keepP75: number
  /** Costed delivered surveys on this route that the guard excluded, so the UI
   *  can print the coverage rather than implying the rate covers everything. */
  excluded: number
  /** Costed delivered surveys on this route left out because the survey's N
   *  actual is only the roll-up of the segments that have a count
   *  (revenue.ts perRespondentNOf). Not the guard: their records may reconcile
   *  perfectly; it is the count that covers only part of the survey. Named on
   *  the card beside `excluded`, with the detail in `partialRollUp`. */
  partialHeldOut: number
  /** Of `n`, how many are MIXED surveys contributing only this leg. Worth
   *  showing separately: a mixed leg's spend is a partition, not a whole
   *  survey's bill, and a reader comparing it with a single-route survey should
   *  know which they are looking at. */
  mixed: number
  /** POOLED spend ÷ completes bought, on exactly the surveys behind `blended`.
   *  The left dot of the dumbbell; `blended` is the right. On one population
   *  the gap between them is exactly `scrubRate`: blended × (1 − scrubRate) =
   *  perComplete. */
  perComplete: number
  /** Recovered rewards inside `spend` (≤ 0). `spend` is NET; the gross figure
   *  is spend − recovered. Surfaced because recoveries are booked in batches
   *  and a month still waiting for its recoveries reads dearer than one that
   *  has had them (David, 2026-09-24: recoveries are their own line). */
  recovered: number
  /** (spend − recovered) ÷ qualified — the rate before any reward came back. */
  blendedGross: number
  /** Survey ids behind the figure, for the drill check. */
  ids: string[]
  /** One row per leg behind the figure, in the order they were admitted — the
   *  per-survey rates the median and quartiles above were taken from, so the
   *  per-respondent tab can rank surveys against the typical one, count how
   *  many a buy multiple covers, and price a quote floor on the SAME surveys
   *  the dumbbell draws, without re-deriving the admission test. */
  observations: CpqrObservation[]
}

/** One survey's leg on one route, as the CPQR card admitted it. */
export interface CpqrObservation {
  id: string
  /** The leg's spend (NET of recovered rewards) and the credits inside it. */
  spend: number
  recovered: number
  /** Completes we paid for on this leg. */
  paid: number
  /** Delivered (post-QA) respondents on this leg. May be 0: money spent on a
   *  route that produced nothing usable still counts in the pooled figure. */
  delivered: number
  /** spend ÷ delivered, or null when nothing was delivered. */
  cpqr: number | null
  /** delivered ÷ paid, or null when either is 0. */
  keep: number | null
  /** One side of a survey fielded both ways. */
  mixed: boolean
}

/**
 * The mixed-route surveys a rate could not price, and why.
 *
 * Coverage that names its own gap. Most mixed surveys are unsplit today, which
 * can be more spend than the blast card's own exclusions, and a CPQR card that
 * shows two tidy numbers without it is claiming a completeness it does not
 * have.
 */
export interface MixedCoverage {
  /** Mixed delivered surveys with recorded cost, total. */
  surveys: number
  /** Of those, how many produced legs and are IN the rates above. */
  priced: number
  /** Spend on the ones that are not priced. */
  blockedSpend: number
  /** Delivered N on the ones that are not priced. */
  blockedN: number
  /** Why each was blocked, so the fix is legible: 'no-split' needs the
   *  deliverable joined, 'unrouted-cost' needs a cost line routed. */
  reasons: Partial<Record<LegBlock, number>>
  /** Flat cost on mixed surveys that names no route — the money that is
   *  blocking, in dollars. */
  unroutedSpend: number
}

/** Delivered, costed surveys IN the CPQR cards whose segment N actuals do not
 *  add up to the survey's own (revenue.ts segmentsDisagree) — the survey's N
 *  actual was typed, so it states the whole survey. They are counted at that N
 *  — the figure the invoice reads (David, 2026-09-27: "when we bill its just
 *  the n actual") — and listed so the Improve tab can ask for the segment
 *  counts. A survey whose N actual is only the partial roll-up is NOT here: it
 *  is held out, in `partialRollUp`. */
export interface SegmentNotes {
  surveys: number
  spend: number
  ids: string[]
}

/**
 * The quantile every per-respondent figure uses: nearest rank, the value at
 * index ⌊n × p⌋ of the sorted list. Exported so a figure drawn beside a CPQR
 * card (the quote floor, the buy multiple) states its "typical survey" the
 * same way the card's box does — two definitions of "median" on one tile would
 * put the tick and the sentence under it a survey apart.
 */
export const nearestRank = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}
const quantile = nearestRank

/**
 * The legs CPQR counts for ONE survey, or none with the reason it counts none.
 *
 * THE SINGLE DEFINITION of "does this survey reach the rate". The drill-down
 * strip under each CPQR card re-derives its population from SurveyPnl, and the
 * panel red-flags a strip whose contributions do not add back to the headline —
 * so a second copy of this predicate living in drills.ts is not a style point,
 * it is how the detail table comes to disagree with the number that opened it.
 * Both callers go through here.
 */
export function contributingLegs(
  p: FinProject, blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  ix?: FinIndex,
): { legs: Leg[]; reason: LegBlock } {
  if (!isDelivered(p)) return { legs: [], reason: 'none' }
  const sp = spendOf(p, blasts, suppliers, costs, ix)
  if (sp.total <= 0) return { legs: [], reason: 'none' }

  const { legs, reason, splitReason } = legsOf(p, blasts, suppliers, costs, ix)
  if (!legs.length) return { legs: [], reason }

  // CPQR divides by what survived QA into the deliverable. A leg that cannot say
  // how many of those it produced has no denominator, and half a survey's money
  // in a portfolio rate is worse than none of it — so this is all or nothing, as
  // it has always been. That includes a survey whose N actual is only the
  // roll-up of the segments that have a count ('partial-n-actual', PR00231):
  // legsOf hands it no delivered N, because all of its cost over part of its N
  // is not a price per respondent.
  if (legs.some(l => l.delivered == null)) return { legs: [], reason: splitReason }

  // A survey that delivered nothing has nothing to attribute. This is the gate
  // the CPQR rate has always applied (`if (!(qualified > 0)) continue`), and it
  // reads the SURVEY total so that a legitimate zero on one leg — a route we
  // spent on that produced nothing usable — still contributes its spend.
  if (!(legs.reduce((t, l) => t + (l.delivered ?? 0), 0) > 0)) {
    return { legs: [], reason: 'no-n-actual' }
  }

  // THE GUARD, now per leg. Without it this reported blast CPQR at $37.31
  // against its own $71.78 median and a 116.5% QA yield. Both impossible, both
  // rendered.
  //
  // The recorded completes have to cover BOTH figures this reasons about: the N
  // the leg says it collected (or its spend is incomplete) and the N it says
  // survived QA (or the divisor is bigger than the records). Guarding on
  // collected alone — the guard routeCosts uses — leaves the second hole open,
  // because a survey can record 100 collected, 100 paid and 150 actual and pass.
  // max() closes both.
  //
  // On a single-route survey leg.collected is the project's n_collected and
  // leg.paid/leg.delivered are the project totals, so this is byte-for-byte the
  // test that shipped — which is why the existing suite is the regression test
  // for legsOf.
  //
  // ALL OR NOTHING per survey. Admitting one leg of a mixed survey while its
  // partner fails would put half a survey's money into a portfolio rate and
  // silently drop the rest; a survey is in or it is out, as it always has been.
  if (!legs.every(l => l.collected > 0 && l.paid >= Math.max(l.collected, l.delivered ?? 0))) {
    return { legs: [], reason: 'under-recorded' }
  }
  return { legs, reason: 'ok' }
}

export function cpqrWithCoverage(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
  /** The caller's index over the same blasts, suppliers and costs, when it has
   *  one (the finance shell builds it once per load). */
  ixIn?: FinIndex,
): { rates: Cpqr[]; mixed: MixedCoverage; segmentNotes: SegmentNotes; partialRollUp: PartialRollUpNote } {
  // `skipped` and `partial` are PER ROUTE. A single shared counter would report
  // panel's exclusions on blast's card and vice versa.
  const ix = ixIn ?? buildIndex(blasts, suppliers, costs)
  const acc: Record<'blast' | 'panel', {
    spend: number; recovered: number; qualified: number; paid: number; per: number[]; keep: number[]
    skipped: number; partial: number; mixed: number; ids: Set<string>; obs: CpqrObservation[]
  }> = {
    blast: { spend: 0, recovered: 0, qualified: 0, paid: 0, per: [], keep: [], skipped: 0, partial: 0, mixed: 0, ids: new Set(), obs: [] },
    panel: { spend: 0, recovered: 0, qualified: 0, paid: 0, per: [], keep: [], skipped: 0, partial: 0, mixed: 0, ids: new Set(), obs: [] },
  }
  const mixed: MixedCoverage = {
    surveys: 0, priced: 0, blockedSpend: 0, blockedN: 0, reasons: {}, unroutedSpend: 0,
  }
  const segmentNotes: SegmentNotes = { surveys: 0, spend: 0, ids: [] }
  // The surveys held out because their N actual is a partial segment roll-up —
  // named, with their money, so the card can say what it is not describing.
  const partialRollUp = emptyPartialRollUp()

  for (const p of rows) {
    if (!isDelivered(p)) continue
    const route: Route = routeOf(p, blasts, suppliers, ix)
    if (route === 'none') continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0) continue

    const isMixed = route === 'both'
    if (isMixed) {
      mixed.surveys++
      mixed.unroutedSpend += legsOf(p, blasts, suppliers, costs, ix).unrouted
    }

    const { legs, reason } = contributingLegs(p, blasts, suppliers, costs, ix)

    if (!legs.length) {
      // `excluded` has always counted surveys the COVERAGE GUARD turned away, as
      // distinct from ones that simply had nothing to divide — keep that meaning
      // rather than folding every block into it.
      if (reason === 'under-recorded') {
        for (const l of legsOf(p, blasts, suppliers, costs, ix).legs) acc[l.route].skipped++
      }
      if (reason === 'partial-n-actual') {
        for (const l of legsOf(p, blasts, suppliers, costs, ix).legs) acc[l.route].partial++
        partialRollUp.surveys++
        partialRollUp.spend += sp.total
        partialRollUp.collected += Number(p.n_collected ?? 0)
        partialRollUp.ids.push(p.id)
      }
      if (isMixed) {
        mixed.reasons[reason] = (mixed.reasons[reason] ?? 0) + 1
        mixed.blockedSpend += sp.total
        mixed.blockedN += Number(p.n_actual ?? 0)
      }
      continue
    }

    // A leg that delivered nothing is a real outcome — money spent on a route
    // that produced no usable interview. Its SPEND still belongs in the pooled
    // blended figure (or the portfolio rate understates what respondents cost);
    // it contributes no per-survey rate, because that rate is infinite.
    if (isMixed) mixed.priced++
    if (segmentsDisagree(p)) {
      segmentNotes.surveys++; segmentNotes.spend += sp.total; segmentNotes.ids.push(p.id)
    }
    for (const l of legs) {
      const d = l.delivered ?? 0
      const a = acc[l.route]
      a.spend += l.spend
      a.recovered += l.recovered
      a.ids.add(p.id)
      a.qualified += d
      a.paid += l.paid
      if (isMixed) a.mixed++
      if (d > 0) a.per.push(l.spend / d)
      if (l.paid > 0 && d > 0) a.keep.push(d / l.paid)
      a.obs.push({
        id: p.id, spend: l.spend, recovered: l.recovered, paid: l.paid, delivered: d,
        cpqr: d > 0 ? l.spend / d : null,
        keep: l.paid > 0 && d > 0 ? d / l.paid : null,
        mixed: isMixed,
      })
    }
  }

  const out: Cpqr[] = []
  for (const route of ['panel', 'blast'] as const) {
    const a = acc[route]
    if (!a.per.length) continue
    out.push({
      route,
      blended: a.qualified > 0 ? a.spend / a.qualified : 0,
      median: quantile(a.per, 0.5),
      p25: quantile(a.per, 0.25),
      p75: quantile(a.per, 0.75),
      n: a.per.length,
      spend: a.spend,
      qualified: a.qualified,
      paid: a.paid,
      scrubRate: a.paid > 0 ? 1 - a.qualified / a.paid : 0,
      scrubRateMedian: a.keep.length ? 1 - quantile(a.keep, 0.5) : 0,
      keepP25: a.keep.length ? quantile(a.keep, 0.25) : 0,
      keepP75: a.keep.length ? quantile(a.keep, 0.75) : 0,
      excluded: a.skipped,
      partialHeldOut: a.partial,
      mixed: a.mixed,
      perComplete: a.paid > 0 ? a.spend / a.paid : 0,
      recovered: a.recovered,
      blendedGross: a.qualified > 0 ? (a.spend - a.recovered) / a.qualified : 0,
      ids: [...a.ids],
      observations: a.obs,
    })
  }
  return { rates: out, mixed, segmentNotes, partialRollUp }
}

/**
 * Blast incidence: completes ÷ people reached.
 *
 * Returned for BLAST ONLY, and the absence of a panel counterpart is the point.
 * `project_suppliers` records what we bought and what it cost but never how
 * many people were approached, so panel incidence is not merely unmeasured — it
 * is unrecordable in this schema. Any UI that shows this must say so, or a
 * reader will assume the missing side is zero or comparable.
 */
export function blastIncidence(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[],
): { reach: number; completes: number; rate: number } | null {
  const ix = buildIndex(blasts, suppliers, [])
  let reach = 0, completes = 0
  for (const p of rows) {
    if (routeOf(p, blasts, suppliers, ix) !== 'blast') continue
    for (const b of ix.blasts.get(p.id) ?? []) {
      reach += Number(b.people ?? 0)
      completes += Number(b.completes ?? 0)
    }
  }
  if (reach <= 0) return null
  return { reach, completes, rate: completes / reach }
}

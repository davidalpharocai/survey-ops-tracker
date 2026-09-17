/**
 * CPQR — Cost Per Qualified Respondent.
 *
 * David asked for this by name, for PS and B2B separately, 2026-09-15.
 *
 * ── WHY IT IS NOT THE SAME AS COST PER COMPLETE ─────────────────────────────
 * The finance hub already shows cost per complete: spend ÷ the completes we
 * PAID for. CPQR divides by the completes that survived data QA into the
 * deliverable — `n_actual`, what the client actually received. The gap between
 * the two is the scrub, and measured against production it is not a rounding
 * difference; it inverts the comparison between the routes:
 *
 *              n    CPQR blended   median    QA yield
 *   panel      31       $1.58        $1.07      63.6%
 *   blast      39      $78.52       $75.91      75.3%
 *
 * Both routes lose a third of what they buy to QA. A usable B2B interview costs
 * about $76 and a usable panel interview about $1.07 — so on CPQR medians the
 * routes are 71x apart, wider than the 57x the cost-per-complete card shows,
 * not narrower.
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
 * measurable — 5,905 completes from 4,980,119 people reached, 0.1186% — but
 * PureSpectrum reach is never recorded (project_suppliers has no people-reached
 * column), so the panel side of the comparison does not exist. An unprovable
 * explanation in the same sentence as a measured ratio lends the ratio its
 * authority; the claim has been removed rather than softened.
 */

import { buildIndex, isDelivered, spendOf, routeOf, type FinBlast, type FinCost, type FinProject, type FinSupplier, type Route } from './hub'

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
   * It is NOT what happens on a typical survey, and the difference is large:
   * pooled panel scrub is 24.8% and the MEDIAN panel survey scrubs 13.2%,
   * because PR00231 alone (5,342 collected, 342 delivered, 6% keep) pulls the
   * pooled figure down from 82.8% to 75.2%. A card that prints the pooled
   * ratio beside a median CPQR invites a reader planning their next study to
   * take a portfolio ratio as the typical case, so both now ship together.
   */
  scrubRate: number
  /** MEDIAN per-survey scrub — what to expect on the NEXT survey. Blast and
   *  panel are near-identical here (12.5% and 13.2%); they differ only in the
   *  tail, which is what the pooled figure is measuring. */
  scrubRateMedian: number
  /** p25/p75 of per-survey KEEP (qualified ÷ paid). The spread is the finding:
   *  0.74–0.97 on panel. Anyone planning a buy-multiple needs this, not a
   *  point estimate — a rule calibrated on the median under-buys on roughly
   *  half of all surveys. */
  keepP25: number
  keepP75: number
  /** Costed delivered surveys on this route that the guard excluded, so the UI
   *  can print the coverage rather than implying the rate covers everything. */
  excluded: number
}

const quantile = (xs: number[], p: number) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]
}

/**
 * CPQR per route, over DELIVERED surveys only.
 *
 * Delivered-only because `n_actual` is the post-QA number and it is not final
 * until the study ships; a survey still in Data QA would divide by a figure
 * that is going to move. Route is MEASURED from field rows, never read off
 * project_type, which is wrong on roughly 15 of 123 surveys that hold rows.
 */
export function cpqrByRoute(
  rows: FinProject[], blasts: FinBlast[], suppliers: FinSupplier[], costs: FinCost[],
): Cpqr[] {
  // `skipped` is PER ROUTE. A single shared counter would report panel's
  // exclusions on blast's card and vice versa.
  const ix = buildIndex(blasts, suppliers, costs)
  const acc: Record<'blast' | 'panel', {
    spend: number; qualified: number; paid: number; per: number[]; keep: number[]; skipped: number
  }> = {
    blast: { spend: 0, qualified: 0, paid: 0, per: [], keep: [], skipped: 0 },
    panel: { spend: 0, qualified: 0, paid: 0, per: [], keep: [], skipped: 0 },
  }
  for (const p of rows) {
    if (!isDelivered(p)) continue
    const route: Route = routeOf(p, blasts, suppliers, ix)
    if (route !== 'blast' && route !== 'panel') continue
    if (p.n_actual == null) continue
    const qualified = Number(p.n_actual)
    if (!(qualified > 0)) continue
    const sp = spendOf(p, blasts, suppliers, costs, ix)
    if (sp.total <= 0) continue
    // THE GUARD. Without it this reported blast CPQR at $37.31 against its own
    // $71.78 median and a 116.5% QA yield. Both impossible, both rendered.
    //
    // The recorded completes have to cover BOTH figures this reasons about: the
    // N the survey says it collected (or its spend is incomplete) and the N it
    // says survived QA (or the divisor is bigger than the records). Guarding on
    // n_collected alone — the guard routeCosts uses — leaves the second hole
    // open, because a survey can record 100 collected, 100 paid and 150 actual
    // and pass. max() closes both.
    const collected = Number(p.n_collected ?? 0)
    const covered = Math.max(collected, qualified)
    if (!(collected > 0 && sp.paidCompletes >= covered)) { acc[route].skipped++; continue }
    const a = acc[route]
    a.spend += sp.total
    a.qualified += qualified
    a.paid += sp.paidCompletes
    a.per.push(sp.total / qualified)
    if (sp.paidCompletes > 0) a.keep.push(qualified / sp.paidCompletes)
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
    })
  }
  return out
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

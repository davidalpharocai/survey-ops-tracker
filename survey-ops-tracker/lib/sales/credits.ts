/**
 * Credit consumption against a term — the number a salesperson shows a client.
 *
 * David: "we'll need to assign credits or dollars to surveys so there needs to
 * be a field on surveys for that, and then a way to roll up usage towards a term
 * so the sales person can show credits consumption."
 *
 * THE HARD PART IS NOT THE ARITHMETIC, IT IS THE UNKNOWNS. `survey_projects.credits`
 * is nullable and means "not priced yet", which is NOT zero. Today it is null on
 * every row in production. Summing nulls as zero would produce a confident
 * "you've used 0 of 46,085" — a wrong number, shown to a paying client, by a
 * salesperson with no way to know it was wrong. So consumption is reported with
 * the count of unpriced surveys beside it and is explicitly a FLOOR whenever
 * that count is non-zero.
 *
 * Pure and tested, for the same reason the money helpers are: this is the figure
 * that leaves the building.
 */

export interface CreditSurvey {
  id: string
  credits?: number | null
  term_id?: string | null
}

export interface Term {
  id: string
  name: string
  credits_total?: number | null
  starts_on?: string | null
  renews_on?: string | null
}

export interface Consumption {
  /** Σ of the credits actually recorded. A FLOOR when `unpriced` > 0. */
  used: number
  /** Surveys counted in `used` that carry a figure. */
  priced: number
  /** Surveys with no credit figure — not free, just not priced yet. */
  unpriced: number
  /** The allowance, or null when the term does not state one. */
  total: number | null
  /** total − used, or null when there is no allowance to draw down. */
  remaining: number | null
  /** 0–100+, or null when there is nothing to be a percentage of. Can exceed
   *  100: going over the allowance is a real thing that must be visible, not
   *  clamped into looking fine. */
  pct: number | null
  /** True when any figure here is missing data — the caller must say so. */
  isFloor: boolean
}

/** Consumption for one term, from the surveys attached to it. */
export function consumptionFor(term: Term, surveys: CreditSurvey[]): Consumption {
  const mine = surveys.filter(s => s.term_id === term.id)
  return rollUp(mine, term.credits_total ?? null)
}

/** Consumption for a set of surveys against an allowance, term or not. */
export function rollUp(surveys: CreditSurvey[], total: number | null): Consumption {
  const priced = surveys.filter(s => s.credits != null)
  const used = priced.reduce((t, s) => t + Number(s.credits), 0)
  const unpriced = surveys.length - priced.length
  const remaining = total == null ? null : total - used
  return {
    used,
    priced: priced.length,
    unpriced,
    total,
    remaining,
    // Guard the divisor: an allowance of 0 is a term that bought nothing, and
    // dividing by it gives Infinity, which renders as a bar of unbounded width.
    pct: total == null || total <= 0 ? null : (used / total) * 100,
    isFloor: unpriced > 0,
  }
}

/**
 * The one-line statement of the position, written so it can be read aloud to a
 * client without a caveat having to be added by the person reading it.
 *
 * Every branch that could mislead says why: no allowance recorded, nothing
 * priced yet, a partial count, or over the allowance.
 */
export function describeConsumption(c: Consumption): string {
  const n = (v: number) => Math.round(v).toLocaleString('en-US')

  if (c.total == null) {
    if (c.priced === 0) return 'No term recorded, and none of these surveys is priced in credits yet.'
    return `${n(c.used)} credits used across ${c.priced} survey${c.priced === 1 ? '' : 's'}${
      c.isFloor ? `, with ${c.unpriced} not yet priced` : ''
    }. No term allowance recorded to measure it against.`
  }

  if (c.priced === 0) {
    return `${n(c.total)} credits on the term. None of the ${c.unpriced} survey${
      c.unpriced === 1 ? '' : 's'
    } here is priced yet, so nothing is drawn down — that is "not recorded", not "nothing used".`
  }

  const head = `${n(c.used)} of ${n(c.total)} credits used`
  const pct = c.pct == null ? '' : ` (${Math.round(c.pct)}%)`
  const left =
    c.remaining != null && c.remaining < 0
      ? `, ${n(Math.abs(c.remaining))} OVER the allowance`
      : c.remaining != null
        ? `, ${n(c.remaining)} remaining`
        : ''
  const floor = c.isFloor
    ? `. ${c.unpriced} survey${c.unpriced === 1 ? ' is' : 's are'} not priced yet, so the used figure is a floor.`
    : '.'
  return head + pct + left + floor
}

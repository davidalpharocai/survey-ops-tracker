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

import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'

export interface CreditSurvey {
  id: string
  credits?: number | null
  term_id?: string | null
  /** Needed to tell a DRAWN credit from a committed one — see `hasDrawn`. */
  board_column?: string | null
  n_collected?: number | null
  n_actual?: number | null
}

/**
 * Has this survey actually drawn its credits?
 *
 * Migration 100 settles this, and it is not a preference: "Whether these credits
 * have been CONSUMED is derived from the survey's stage — a survey that has
 * fielded has drawn them — and is deliberately not stored a second time." It
 * mirrors the CCM consume-at-field model.
 *
 * `rollUp` had no stage test at all, so a survey merely PRICED counted as
 * consumed. Measured in production 2026-09-22: BofA's credits cell read 158
 * when 58 were drawn — a 172% overstatement — because PR00438's 100 credits sit
 * at Doc Programming, never launched, never fielded. That number is shown to
 * the client.
 *
 * Collection is accepted as evidence alongside the board column because it is
 * the thing the column is a proxy FOR: a survey with respondents in has fielded,
 * whatever its card says. A CANCELLED survey that reached fielding still counts
 * as drawn — the panel and the incentives were spent regardless of how it ended.
 */
export function hasDrawn(s: CreditSurvey): boolean {
  if (Number(s.n_collected ?? 0) > 0 || Number(s.n_actual ?? 0) > 0) return true
  const i = STAGE_ORDER.indexOf((s.board_column ?? '') as BoardColumn)
  return i >= STAGE_ORDER.indexOf('Fielding')
}

/**
 * The term in force on `today`, or null.
 *
 * There is no `is_current` flag on client_terms and deliberately so — a flag
 * would be a second copy of the dates, free to drift. The period is the truth:
 * `starts_on <= today < renews_on`, with a missing end treated as open-ended
 * (an unrenewed contract has not ended, it is simply undated).
 *
 * Returns the LATEST-STARTING match, so overlapping imported terms resolve to
 * the most recent rather than to whichever the database happened to return
 * first.
 */
export function currentTerm(terms: Term[], today: string): Term | null {
  const live = terms.filter(t =>
    t.starts_on != null && t.starts_on <= today && (t.renews_on == null || today < t.renews_on))
  if (!live.length) return null
  return live.slice().sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? ''))[0]
}

export interface Term {
  id: string
  name: string
  credits_total?: number | null
  starts_on?: string | null
  renews_on?: string | null
}

export interface Consumption {
  /** Σ of the credits DRAWN — priced AND fielded. A FLOOR when `unpriced` > 0. */
  used: number
  /** Σ priced but not yet fielded: committed, not consumed. Reported rather
   *  than dropped, so the difference between this and the old all-inclusive
   *  total is visible instead of looking like credits went missing. */
  committed: number
  /** How many surveys make up `committed`. */
  committedCount: number
  /** Surveys counted in `used` — priced and drawn. */
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

/**
 * Consumption for a set of surveys against an allowance, term or not.
 *
 * `used` counts only what has been DRAWN (see `hasDrawn`). What is priced but
 * not yet fielded is reported separately as `committed` rather than dropped —
 * a salesperson who saw 158 yesterday and 58 today needs the other 100 to be
 * somewhere on the screen, or the fix reads as a bug.
 */
export function rollUp(surveys: CreditSurvey[], total: number | null): Consumption {
  const priced = surveys.filter(s => s.credits != null)
  const drawn = priced.filter(hasDrawn)
  const used = drawn.reduce((t, s) => t + Number(s.credits), 0)
  const committed = priced.filter(s => !hasDrawn(s)).reduce((t, s) => t + Number(s.credits), 0)
  const unpriced = surveys.length - priced.length
  const remaining = total == null ? null : total - used
  return {
    used,
    committed,
    committedCount: priced.length - drawn.length,
    priced: drawn.length,
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
 * The three figures David asked the accounts page for: "credits used (in current
 * term), credits remaining, credits used all time".
 *
 * They answer different questions and are computed over different sets, which is
 * exactly why they belong side by side:
 *
 *   usedThisTerm  — drawn by surveys attached to the term in force TODAY.
 *   remaining     — that term's allowance minus the above. Null when no term is
 *                   recorded, because "remaining" against no allowance is not 0,
 *                   it is unanswerable.
 *   usedAllTime   — drawn across EVERY survey on the account, including those
 *                   with no term_id. A client that has bought one contract and
 *                   run work outside it has two different true numbers, and
 *                   showing only the term one understates the relationship.
 *
 * Note `usedAllTime` is not a running total of past terms — it is every drawn
 * credit we have recorded for the account, which is the same thing only if every
 * survey was attached to some term. `untermed` says how many were not.
 */
export interface CreditPosition {
  term: Term | null
  usedThisTerm: number
  remaining: number | null
  allowance: number | null
  usedAllTime: number
  /** Priced, not yet fielded, across the whole account. */
  committed: number
  /** Surveys carrying credits but no term_id — in usedAllTime, not in the term. */
  untermed: number
  /** Surveys with no credit figure at all, so every figure above is a floor. */
  unpriced: number
}

export function creditPosition(
  surveys: CreditSurvey[],
  terms: Term[],
  today: string,
): CreditPosition {
  const term = currentTerm(terms, today)
  const inTerm = term ? surveys.filter(s => s.term_id === term.id) : []
  const thisTerm = rollUp(inTerm, term?.credits_total ?? null)
  const allTime = rollUp(surveys, null)
  return {
    term,
    usedThisTerm: thisTerm.used,
    remaining: thisTerm.remaining,
    allowance: term?.credits_total ?? null,
    usedAllTime: allTime.used,
    committed: allTime.committed,
    untermed: surveys.filter(s => s.credits != null && s.term_id == null).length,
    unpriced: allTime.unpriced,
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

  // Computed once and appended to EVERY branch. Committed-not-drawn is stated
  // wherever there is any, because it is the difference between this figure and
  // the one a reader may remember, and an unexplained drop reads as an error
  // rather than as a correction.
  const held = c.committed > 0
    ? ` A further ${n(c.committed)} ${c.committed === 1 ? 'credit is' : 'credits are'} priced on ${
        c.committedCount} survey${c.committedCount === 1 ? '' : 's'} that ${
        c.committedCount === 1 ? 'has' : 'have'} not fielded yet, so ${
        c.committedCount === 1 ? 'it is' : 'they are'} committed but not drawn.`
    : ''

  if (c.total == null) {
    if (c.priced === 0) return 'No term recorded, and none of these surveys is priced in credits yet.' + held
    return `${n(c.used)} credits used across ${c.priced} survey${c.priced === 1 ? '' : 's'}${
      c.isFloor ? `, with ${c.unpriced} not yet priced` : ''
    }. No term allowance recorded to measure it against.` + held
  }

  if (c.priced === 0) {
    return `${n(c.total)} credits on the term. None of the ${c.unpriced} survey${
      c.unpriced === 1 ? '' : 's'
    } here is priced yet, so nothing is drawn down — that is "not recorded", not "nothing used".` + held
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
  return head + pct + left + floor + held
}

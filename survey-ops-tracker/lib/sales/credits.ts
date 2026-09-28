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
  /** Σ of the credits DRAWN — priced AND fielded. A FLOOR when `unpricedDrawn` > 0. */
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
  /** Unpriced surveys that HAVE drawn (fielded or collected). These, and only
   *  these, make `used` a minimum: they took credits we have not counted. */
  unpricedDrawn: number
  /** Unpriced surveys that have not fielded. They have drawn nothing, priced
   *  or not, so they leave `used` exact. Reported so the reader is told they
   *  exist rather than left to wonder why a figure is not qualified. */
  unpricedUndrawn: number
  /** The allowance, or null when the term does not state one. */
  total: number | null
  /** total − used, or null when there is no allowance to draw down. */
  remaining: number | null
  /** 0–100+, or null when there is nothing to be a percentage of. Can exceed
   *  100: going over the allowance is a real thing that must be visible, not
   *  clamped into looking fine. */
  pct: number | null
  /** True when `used` is a minimum — some survey has DRAWN credits it has no
   *  price for — and the caller must say so. An unpriced survey still in
   *  design does not make the figure a floor: it has drawn nothing. */
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
  const unpricedRows = surveys.filter(s => s.credits == null)
  const unpriced = unpricedRows.length
  // Split the unpriced by whether they have drawn. Before this, ANY unpriced
  // survey made the figure a floor, so DE Shaw read "at least" because of two
  // surveys still in design that had drawn nothing — while the printed
  // statement, counting only what had drawn, called a different number exact.
  // One rule now, here, so the screen and the paper cannot disagree about what
  // makes a figure a minimum.
  const unpricedDrawn = unpricedRows.filter(hasDrawn).length
  const remaining = total == null ? null : total - used
  return {
    used,
    committed,
    committedCount: priced.length - drawn.length,
    priced: drawn.length,
    unpriced,
    unpricedDrawn,
    unpricedUndrawn: unpriced - unpricedDrawn,
    total,
    remaining,
    // Guard the divisor: an allowance of 0 is a term that bought nothing, and
    // dividing by it gives Infinity, which renders as a bar of unbounded width.
    pct: total == null || total <= 0 ? null : (used / total) * 100,
    isFloor: unpricedDrawn > 0,
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
  /** Surveys with no credit figure at all. */
  unpriced: number
  /** Of those, the ones that have DRAWN — the only ones that make the used
   *  figures a floor (see rollUp). Account-wide: it qualifies usedAllTime. */
  unpricedDrawn: number
  /** The same, counted inside the term in force only. It is what qualifies
   *  usedThisTerm (a floor) and remaining (a ceiling). Using the account-wide
   *  count there marked a term figure as a minimum because of a survey on an
   *  older contract. */
  unpricedDrawnThisTerm: number
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
    unpricedDrawn: allTime.unpricedDrawn,
    unpricedDrawnThisTerm: thisTerm.unpricedDrawn,
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

  // Unpriced surveys that have not fielded. They drew nothing, so they do not
  // qualify the figure, but a reader who knows they exist and sees no mention
  // of them would assume they were forgotten. "more" only when the floor
  // sentence has already counted some unpriced surveys.
  const k = c.unpricedUndrawn
  const idle = k > 0
    ? ` ${k} ${c.isFloor ? 'more' : `survey${k === 1 ? '' : 's'}`} ${k === 1 ? 'is' : 'are'} not priced and ${
        k === 1 ? 'has' : 'have'} not fielded, so ${k === 1 ? 'it has' : 'they have'} drawn nothing.`
    : ''

  if (c.total == null) {
    if (c.priced === 0) return 'No term recorded, and none of these surveys is priced in credits yet.' + held
    return `${n(c.used)} credits used across ${c.priced} survey${c.priced === 1 ? '' : 's'}${
      c.isFloor ? `, with ${c.unpricedDrawn} more that ${c.unpricedDrawn === 1 ? 'has' : 'have'} fielded but ${
        c.unpricedDrawn === 1 ? 'is' : 'are'} not yet priced` : ''
    }. No term allowance recorded to measure it against.` + idle + held
  }

  // Nothing priced has drawn, but something unpriced HAS: the amount drawn is
  // unknown, which is not the same as zero. When nothing at all has drawn, the
  // general sentence below is simply true ("0 of 375 used") and says so.
  if (c.priced === 0 && c.unpricedDrawn > 0) {
    return `${n(c.total)} credits on the term. ${c.unpricedDrawn} survey${
      c.unpricedDrawn === 1 ? ' has' : 's have'
    } fielded here but none is priced yet, so the amount drawn is "not recorded", which is not the same as "nothing used".` + idle + held
  }

  const head = `${n(c.used)} of ${n(c.total)} credits used`
  const pct = c.pct == null ? '' : ` (${Math.round(c.pct)}%)`
  const left =
    c.remaining != null && c.remaining < 0
      ? `, ${n(Math.abs(c.remaining))} OVER the allowance`
      : c.remaining != null
        ? `, ${n(c.remaining)} remaining`
        : ''
  // Only the unpriced surveys that have DRAWN make this a floor — see rollUp.
  const floor = c.isFloor
    ? `. ${c.unpricedDrawn} survey${c.unpricedDrawn === 1 ? ' that has' : 's that have'} fielded ${
        c.unpricedDrawn === 1 ? 'is' : 'are'} not priced yet, so the used figure is a floor.`
    : '.'
  return head + pct + left + floor + idle + held
}

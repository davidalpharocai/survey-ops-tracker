/**
 * The audience pair, and what is left of it.
 *
 * Migration 094 split one ambiguous "Audience Size" into two numbers:
 *   · total  (audience_size) — contacts the team handed us. Our supply.
 *   · used   (audience_used) — how many of them we have actually drawn on.
 *
 * REMAINING IS DERIVED, never stored. A third column would be a third number to
 * disagree with the other two.
 *
 * Pure and standalone rather than inline in the component, for the same reason
 * resolveAccess() and the nRange helpers are: this decides what a number MEANS,
 * it has a threshold in it, and the "send again or buy more contacts" guidance
 * will need the same answer on a second surface. One definition, tested once.
 *
 * WHY `used` CANNOT BE DERIVED FROM BLAST REACH — the shortcut anyone reading
 * this will reach for first. Reach counts SENDS, and reminder passes re-send to
 * the same list. PR00309 records reach of 95,788 against a pool of 31,545: its
 * two blasts dated 2026-08-13 sum to exactly 31,545, then the same list again on
 * 08-15 and again on 08-17. Three passes, one pool, one audience used.
 */

/** How many contacts are left, and how alarming that is. */
export type AudienceState =
  /** No total recorded — nothing can be said, so callers render nothing. */
  | { kind: 'unknown' }
  /** Total known, `used` never recorded. NOT the same as "none used". */
  | { kind: 'unrecorded'; total: number }
  /** `used` exceeds the total. Impossible for a pool, so one number is wrong. */
  | { kind: 'over'; total: number; used: number }
  /** Contacts remain. `nearlyGone` when a tenth or less of the list is left. */
  | { kind: 'remaining'; total: number; used: number; left: number; nearlyGone: boolean }
  /** The list is fully spent: more responses need more incentive, or more contacts. */
  | { kind: 'exhausted'; total: number }

/** A tenth of the list. Below this, "send again" stops being a real option and
 *  the choice becomes incentive-vs-more-contacts, which is worth flagging BEFORE
 *  the list runs dry rather than at zero. */
export const NEARLY_GONE_SHARE = 0.1

export function audienceState(
  total: number | null | undefined,
  used: number | null | undefined
): AudienceState {
  if (total == null) return { kind: 'unknown' }
  // A recorded total of 0 is a real statement ("the team gave us nothing") and
  // is not the same as an absent one, so it is not folded into 'unknown'. With
  // no contacts at all the list is spent by definition.
  if (used == null) return { kind: 'unrecorded', total }
  // A NEGATIVE used is nonsense, and it does not fall out of the branches below:
  // it slips past `used > total` and reports MORE remaining than the pool holds
  // (audienceState(0, -5) used to render "5 of 0 contacts still available").
  // 094's `>= 0` CHECK stops it reaching the database, but the optimistic update
  // paints the value for the whole round trip and commitNumber accepts a leading
  // minus, so the guard has to be here too. Treated as the same contradiction as
  // over-use, because it is one: the pair cannot both be right.
  if (used < 0 || used > total) return { kind: 'over', total, used }

  const left = total - used
  if (left === 0) return { kind: 'exhausted', total }

  // Guarded against total === 0, which cannot reach here with left > 0 but
  // would divide by zero if the branches above were ever reordered.
  const share = total > 0 ? left / total : 0
  return { kind: 'remaining', total, used, left, nearlyGone: share <= NEARLY_GONE_SHARE }
}

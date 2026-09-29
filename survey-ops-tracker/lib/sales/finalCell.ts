import { deliveredN, stillCollecting, type DeliveryInput } from './deliveredN'

/**
 * How ONE response figure reads under the heading "Final", for every sales
 * surface that shows one.
 *
 * ── WHY THIS IS NOT INLINE IN A COMPONENT ───────────────────────────────────
 * Because it was, twice, and the third copy is what this file prevents. The
 * surveys list worked this out inside its cell renderer; the contacts page did
 * not, and printed `n_actual ?? n_collected` under the words "N Collected" —
 * the PR00481 pattern, where a survey still in field shows its running total
 * as though it were a delivered count. `lib/sales/stage.ts` carries the same
 * lesson at length: four surfaces each with their own copy of one rule, three
 * of them wrong, sitting on screens next to each other.
 *
 * ── THE FOUR READINGS, AND ONLY THE FIRST IS A FINAL FIGURE ─────────────────
 * Under a heading that says "Final", an unmarked number is a claim that the
 * survey delivered it. So everything that is not a recorded post-QA count
 * carries its own mark, and the NUMBER is unchanged in all four:
 *
 *   recorded   n_actual exists. The answer. No mark.
 *   estimate   projected by deliveredN from a finished collection against a
 *              target. "~ … est."
 *   so-far     still gathering. "so far" — a claim that more is coming, so it
 *              is read off stillCollecting (the predicate deliveredN projects
 *              with) rather than inferred from what deliveredN returned.
 *              Inferring it was wrong on 60 of 433 live surveys, measured
 *              2026-09-28: a RANGED target and a survey with NO target both
 *              reach "not recorded and not estimated" while finished. PR00393
 *              — Delivery, Closed, 1,418 collected against a 200–300 range —
 *              read "1,418 so far" two columns from a Stage cell saying
 *              "Delivered".
 *   not-final  finished, nothing post-QA ever recorded, and nothing to project
 *              from. The honest remainder.
 *
 * ── AND THE FIFTH CASE, WHICH IS NOT A NUMBER ───────────────────────────────
 * `none`: no count has ever been recorded. A 0 with no audit row is the column
 * default, not a measurement (migration 111). Printing it as "0 · 0%" in amber
 * calls it a result — Alex's list, 2026-09-23, PR00482: Submitted, target
 * 1,000, shown exactly that way.
 */
export type FinalReading = 'recorded' | 'estimate' | 'so-far' | 'not-final' | 'none'

export interface FinalCell {
  reading: FinalReading
  /** The figure to print, or null when `reading` is 'none'. */
  value: number | null
  /** The short mark beside it: '', '~ … est.' is signalled by `estimate`. */
  mark: '' | 'so far' | 'not final'
  /** The sentence a reader gets on hover. Never empty. */
  note: string
}

export interface FinalCellInput extends DeliveryInput {
  n_target_max?: number | null
  /** When the collected count was last edited (migration 111). `null` means
   *  the read SUCCEEDED and there is no audit row — never recorded. `undefined`
   *  means we could not tell, and we say nothing. */
  n_collected_updated_at?: string | null
}

const NEVER_NOTE = 'No count has been recorded for this survey yet.'

export function finalCell(r: FinalCellInput): FinalCell {
  // Strict null on n_actual: undefined means we could not tell.
  if (r.n_actual == null && Number(r.n_collected ?? 0) === 0 && r.n_collected_updated_at === null) {
    return { reading: 'none', value: null, mark: '', note: NEVER_NOTE }
  }

  const raw = r.n_actual ?? (r.n_collected == null ? null : Number(r.n_collected))
  // A RANGED target keeps the "in range / to floor" wording its caller prints
  // and is not projected against: the floor is not the target. deliveredN is
  // not consulted for the FIGURE in that case — but the survey is still either
  // collecting or finished, and that is what decides the mark.
  const ranged = r.n_target != null && r.n_target_max != null && r.n_target_max !== r.n_target
  const d = ranged ? null : deliveredN(r)
  const value = d?.value ?? raw

  const recorded = d ? d.basis === 'recorded' : r.n_actual != null
  if (recorded) {
    return { reading: 'recorded', value, mark: '', note: 'Responses delivered after quality review.' }
  }

  // Only the two branches that are MEASUREMENTS of past surveys are an
  // estimate. deliveredN's no-target branch hands back the raw collection with
  // estimated=true, and a "~" on a number nothing was done to is a guess
  // wearing a measurement's clothes.
  const est = d != null && d.estimated && r.n_target != null && r.n_target > 0 &&
    (d.basis === 'at-or-over-target' || d.basis === 'short-of-target')
  if (est) return { reading: 'estimate', value, mark: '', note: d!.note }

  if (stillCollecting(r)) {
    return {
      reading: 'so-far',
      value,
      mark: 'so far',
      note: d?.note || 'Responses in hand. This survey is still in field, so it has no final figure yet.',
    }
  }

  return {
    reading: 'not-final',
    value,
    mark: 'not final',
    note: d?.note ||
      'Responses gathered in field. No count has been recorded since quality review, and this survey sold a ' +
      'range rather than a single target, so nothing is projected from it.',
  }
}

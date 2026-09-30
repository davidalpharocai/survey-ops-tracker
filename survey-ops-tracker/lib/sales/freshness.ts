import { etDate, etTime } from './dateRange'
import { daysBetween } from './home'

/**
 * How current the response count on an in-field survey is — the line under each
 * row of "In field now" on the sales home screen.
 *
 * ── WHAT IT DATES ───────────────────────────────────────────────────────────
 * The last recorded change to the survey's collected-response count
 * (sales_n_collected_freshness, migration 111). Only surveys still collecting
 * carry this line, so the figure beside it is always a count in progress.
 *
 * ── WHY THE WORDS CHANGED, 2026-09-28 ───────────────────────────────────────
 * It used to read "N updated 26 Sep, 14:32 ET · 2 days ago". "N collected" was
 * a column heading on the sales screens when that was written, and on the same
 * day it stopped being one anywhere in the sales portal: the surveys list and
 * the account table now head that column "Final", the survey page shows N
 * Target and N Actual, and the client documents print Target and Final. The
 * stamp was left dating a field by a name its reader could no longer find.
 *
 * It now names the ACT rather than the field — "responses last counted" — which
 * is true of the thing being timestamped whatever the column is called, and
 * reads as plain English rather than as a field reference.
 *
 * ── THE THREE ANSWERS, WHICH ARE NOT TWO ────────────────────────────────────
 * Alex via David, 2026-09-28: "he should be able to see the last updated for N
 * collected on the home screen vs having to click in. it should show the date
 * and time." The exact time earns its space: on 28 Sep four of his studies
 * (PR00383, PR00392, PR00427, PR00461) were last changed within the same minute
 * at 8:24 AM, and "updated today" cannot tell that from an edit made at nine at
 * night.
 *
 *   dated   — a real measurement, with the day and the clock time in Eastern.
 *   never   — 8 of Alex's 25 live surveys on 28 Sep have no recorded change at
 *             all. A survey showing 0 of 3,000 with no history is not behind,
 *             it is UNMEASURED, and those are opposite things to tell a
 *             salesperson.
 *   unknown — null, when the freshness read itself failed. "We don't know" must
 *             never render as "never"; the caller shows nothing at all.
 *
 * ET, not the server's zone. The server's clock is UTC, a day ahead after 8pm
 * ET, and slicing the raw timestamp dated a 9pm ET edit to the next day.
 */
export interface Freshness {
  /** The line as printed. */
  text: string
  /** Old enough to colour: more than a week, or never measured. */
  stale: boolean
  /** The hover explanation, in full sentences. */
  title: string
}

/** More than a week without a count is worth colouring on a live study. */
export const STALE_AFTER_DAYS = 7

export function freshness(last: string | undefined, today: string, available: boolean): Freshness | null {
  if (!available) return null
  if (!last) {
    return {
      text: 'responses never counted',
      stale: true,
      title:
        'No response count has ever been recorded for this study, so the figure beside it is not a ' +
        'measurement — it is the value the row was created with.',
    }
  }
  const day = etDate(last) ?? last.slice(0, 10)
  const clock = etTime(last)
  const d = daysBetween(today, day)
  const ago = d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
  return {
    text: `responses last counted ${day}${clock ? `, ${clock} ET` : ''} · ${ago}`,
    stale: d > STALE_AFTER_DAYS,
    title: `The response count on this study last changed ${day}${clock ? ` at ${clock} Eastern` : ''}.`,
  }
}

/**
 * The one sentence at the top of Insights — warm, and only ever what the
 * numbers say.
 *
 * David wants the page to "show the hard work paying off". The way to do that
 * without ever overselling is to lead with the team and the work, and then add
 * only the claims the data carries:
 *
 *   · "the most since June" — only for a single calendar month, only when that
 *     month has at least MIN_COMPARE_N surveys, and only naming a month that
 *     really had as many or more (so the claim is checkable on the chart);
 *   · "up from 38 in 1–27 Aug" — exactly the "Surveys delivered" tile's
 *     comparison, so the two can never disagree: only when BOTH periods have
 *     at least MIN_COMPARE_N surveys, and only when the undated deliveries
 *     that probably belong to them could not change the answer. A fall is
 *     stated as "compared with", never hidden and never dressed up; an earlier
 *     count that is missing undated deliveries reads "at least";
 *   · respondents — "at least" when some delivered surveys have no count yet,
 *     because a missing count is not zero;
 *   · on time — only when at least MIN_COMPARE_N surveys can be judged.
 *
 * No adjective here is praise the numbers did not earn: "the most since" is a
 * rank, "up from" is arithmetic.
 */

import { fmtNum } from '@/lib/utils/number'
import type { Comparison, Measure, UndatedMonths } from './model'
import { MIN_COMPARE_N } from './constants'
import { addMonths, monthKey, monthLong, rangeWords, type DateRange } from './range'
import { NO_CAPTAIN, type InsightsFilter } from './filters'

export interface HeadlineInput {
  filter: InsightsFilter
  today: string
  range: DateRange
  cur: Measure
  prev: Measure | null
  prevLabel: string | null
  /** The "Surveys delivered" tile's comparison — the headline states the same
   *  one, or none. */
  compareDelivered: Comparison
  /** Delivered surveys per calendar month over ALL time (under the type /
   *  captain / account filters), for "the most since …". */
  allMonthCounts: Map<string, number>
  /** The delivered surveys with no deliver date, by the month they probably
   *  belong to — a month on record may be missing them. */
  undatedMonths: UndatedMonths
  captainName: string | null
  accountName: string | null
  /** The type filter's key (filters.ts TypeKey), or null. */
  typeKey: string | null
  runsToToday: boolean
}

/** How a type filter reads inside "12 ___ surveys ___": "12 PS surveys",
 *  "3 surveys with no type set", "2 surveys filed under the older Rerun type". */
function typeWords(k: string | null): { before: string; after: string } {
  if (!k) return { before: '', after: '' }
  if (k === 'none') return { before: '', after: ' with no type set' }
  if (k === 'Rerun') return { before: '', after: ' filed under the older Rerun type' }
  return { before: `${k} `, after: '' }
}

const MIN_N = MIN_COMPARE_N

/** "The most in any month on record" needs a record to speak of: at least
 *  this many earlier months with deliveries. Beating one earlier month is a
 *  comparison, not a record. */
export const RECORD_MIN_MONTHS = 3

/**
 * For a single month: the latest EARLIER month with at least as many
 * deliveries. Returns 'record' when no earlier month comes close (and there is
 * enough history to call it that), null when the claim would be empty (the
 * month just before had as many) or unfounded.
 *
 * Old months are missing deliveries: many delivered surveys have no deliver
 * date, most of them sheet imports from before June. So each earlier month is
 * read as a range — its dated count, up to that plus the undated surveys whose
 * due (else launch, else submitted) date falls in it — and a claim is made only
 * when it holds at both ends:
 *   · "the most since June" needs June to have had as many for certain (its
 *     dated count alone, against this month's highest), and every month in
 *     between to stay below even at its highest;
 *   · "the most in any month on record" is a claim about every month there has
 *     been, so it must survive even the undated surveys with no date of any kind
 *     (`unplaced`) all landing in one earlier month.
 */
export function mostSince(
  month: string,
  count: number,
  allMonthCounts: Map<string, number>,
  undated: UndatedMonths = { byMonth: new Map(), unplaced: 0 },
): string | 'record' | null {
  if (count < MIN_N) return null
  const dated = (k: string) => allMonthCounts.get(k) ?? 0
  const highest = (k: string) => dated(k) + (undated.byMonth.get(k) ?? 0)
  const earlier = [...new Set([...allMonthCounts.keys(), ...undated.byMonth.keys()])]
    .filter(k => k < month && highest(k) > 0)
    .sort()
  if (earlier.length === 0) return null
  // This month at its highest: its own undated surveys may belong to it too.
  const ownHighest = count + (undated.byMonth.get(month) ?? 0)
  for (let i = earlier.length - 1; i >= 0; i--) {
    const k = earlier[i]
    if (highest(k) >= count) {
      // k may have had as many. Name it only if it certainly did.
      if (dated(k) < ownHighest) return null
      // "The most since August" in September says nothing: August had more.
      return k === addMonths(month, -1) ? null : k
    }
  }
  const top = Math.max(...earlier.map(highest))
  if (top + undated.unplaced >= count) return null
  return earlier.length >= RECORD_MIN_MONTHS ? 'record' : null
}

export function buildHeadline(h: HeadlineInput): string {
  const { cur, filter: f } = h
  const n = cur.delivered
  const when = rangeWords(f.range, h.today)
  const { before: kind, after: kindAfter } = typeWords(h.typeKey)
  const forAcct = h.accountName ? ` for ${h.accountName}` : ''
  const noCaptain = f.captain === NO_CAPTAIN
  const who = h.captainName && !noCaptain ? h.captainName : 'The team'
  const unowned = noCaptain ? ' without a captain' : ''
  const qualifiers = `${kindAfter}${forAcct}${unowned}`

  if (n === 0) {
    return `No ${kind}surveys${qualifiers} ${h.runsToToday ? 'have been' : 'were'} delivered ${when}.`
  }

  const verb = h.runsToToday ? 'has delivered' : 'delivered'
  let first = `${who} ${verb} ${fmtNum(n)} ${kind}survey${n === 1 ? '' : 's'}${qualifiers} ${when}`

  // A rank claim for a single calendar month; otherwise the previous period.
  let clause = ''
  if (f.range.preset === 'this-month' || f.range.preset === 'last-month') {
    const month = monthKey(h.range.from as string)
    const since = mostSince(month, n, h.allMonthCounts, h.undatedMonths)
    const already = f.range.preset === 'this-month' ? 'already ' : ''
    if (since === 'record') clause = `, ${already}the most in any month on record`
    else if (since) clause = `, ${already}the most since ${monthLong(since, since.slice(0, 4) !== month.slice(0, 4))}`
  }
  const c = h.compareDelivered
  if (!clause && h.prev && h.prevLabel && (c.state === 'up' || c.state === 'down' || c.state === 'same')) {
    // The tile's "at least" carries over: an earlier count missing undated
    // deliveries is a floor.
    const p = `${c.floor ? 'at least ' : ''}${fmtNum(h.prev.delivered)}`
    clause = c.state === 'up' ? `, up from ${p} in ${h.prevLabel}`
      : c.state === 'same' ? `, the same as in ${h.prevLabel}`
        : `, compared with ${p} in ${h.prevLabel}`
  }
  first += clause + '.'

  const resp = cur.withN > 0
    ? `${cur.withoutN > 0 ? 'at least ' : ''}${fmtNum(cur.respondents)} respondent${cur.respondents === 1 ? '' : 's'}`
    : null
  const onTime = cur.judged >= MIN_N && cur.onTimePct != null
    ? `${Math.round(cur.onTimePct * 100)}% of those with a due date arrived on or before it`
    : null
  if (resp && onTime) return `${first} That is ${resp}, and ${onTime}.`
  if (resp) return `${first} That is ${resp}.`
  if (onTime) return `${first} ${onTime}.`
  return first
}

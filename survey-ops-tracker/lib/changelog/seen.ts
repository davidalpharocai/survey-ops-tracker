import { LATEST_CHANGE_DATE } from './entries'

// The "have you read the latest entry" marker.
//
// Deliberately per-BROWSER, not per-account: a dot on a nav item is a
// convenience, not a record, and storing it server-side would mean a table, a
// write on every page view, and a migration — for a dot. The cost of getting it
// wrong is that someone sees the dot twice, or misses it on their second
// machine. Neither is worth a round trip.
//
// Every access is wrapped: localStorage throws outright in some contexts (a
// private window, a browser set to block site data), and the changelog must
// never be the reason a page fails to render.

export const SEEN_KEY = 'socc:changelog-seen'

/** True when there is an entry newer than the one this browser last saw.
 *  Answers FALSE on any failure — a missing dot is a much smaller annoyance than
 *  a permanent one that never clears. */
export function hasUnreadChanges(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    // Never visited: show the dot once, so the feature announces itself.
    if (!seen) return true
    // String comparison is correct for ISO dates (YYYY-MM-DD sorts
    // lexicographically) and avoids timezone parsing entirely.
    return LATEST_CHANGE_DATE > seen
  } catch {
    return false
  }
}

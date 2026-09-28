/**
 * The goals and thresholds the Insights dashboard judges against, defined
 * ONCE. The charts' goal lines, the tiles' colours and every sentence on the
 * page read these, so changing a goal here changes it everywhere.
 *
 * They are GOALS, not rules: drawn as a dashed line and coloured against,
 * never enforced anywhere.
 */

/** On-time goal: 90% of delivered surveys on or before their due date. A
 *  starting goal (the figure David's brief gave as its example), not a
 *  measurement. */
export const ON_TIME_GOAL = 0.9

/** Cycle-time goal: a median of 7 calendar days from submitted to delivered —
 *  one week. A starting goal chosen when this page was built, to be confirmed
 *  by David; not a measurement. */
export const CYCLE_DAYS_GOAL = 7

/** A comparison between two periods is only stated when BOTH sides rest on at
 *  least this many surveys; below it the page says "too few to compare" rather
 *  than calling a swing of two surveys a trend. */
export const MIN_COMPARE_N = 10

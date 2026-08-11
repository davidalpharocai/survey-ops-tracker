/** The cadence dates for the missed waves of an overdue series: starting from
 * baseISO (the series' cadence_anchor = last known wave date or seed anchor),
 * step forward by cadenceMonths and emit each date that is strictly after base
 * and <= today. These become delivered placeholder waves; the LAST one is the
 * most recent wave, so next-due = last + cadence rolls into the future.
 * Returns [] if cadenceMonths is null/0 or base is already >= today (no gap).
 * All dates are YYYY-MM-DD; step months UTC-anchored to avoid TZ drift.
 *
 * SOURCE OF TRUTH: scripts/backfill-placeholders.mjs inlines an identical copy
 * of this stepping logic (a plain .mjs can't import this .ts) — keep them in
 * sync if you change the algorithm here. */
export function placeholderWaveDates(
  baseISO: string | null,
  cadenceMonths: number | null,
  todayISO: string,
): string[] {
  if (!baseISO || !cadenceMonths) return []
  const cursor = new Date(baseISO + 'T00:00:00Z')
  if (isNaN(cursor.getTime())) return []
  const out: string[] = []
  // Cap iterations so a bad input (e.g. today far in the future) can never loop
  // forever — ~600 covers 50 years of monthly waves, far more than real data.
  for (let i = 0; i < 600; i++) {
    cursor.setUTCMonth(cursor.getUTCMonth() + cadenceMonths)
    const iso = cursor.toISOString().slice(0, 10)
    if (iso <= todayISO) out.push(iso)
    else break
  }
  return out
}

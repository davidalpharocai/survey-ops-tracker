/** Add `n` months to a UTC date, CLAMPING the day-of-month to the target
 * month's last day — Jan 31 + 1mo → Feb 28 (not Mar 3). This matches Postgres
 * `make_interval(months => n)`, which the rerun_series_status view uses to
 * compute the real due date, so a 29–31-anchored series doesn't drift out of
 * step with the view. Each wave is computed from the ORIGINAL base (base + i·n),
 * so the day-of-month is restored wherever the month is long enough (Jan 31 →
 * Feb 28, Mar 31, Apr 30, …), exactly like anchor + interval in SQL. */
function addMonthsClampedUTC(d: Date, n: number): Date {
  const day = d.getUTCDate()
  const t = new Date(d)
  t.setUTCDate(1)
  t.setUTCMonth(t.getUTCMonth() + n)
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  t.setUTCDate(Math.min(day, lastDay))
  return t
}

/** The cadence dates for the missed waves of an overdue series: starting from
 * baseISO (the series' cadence_anchor = last known wave date or seed anchor),
 * step forward by cadenceMonths and emit each date that is strictly after base
 * and <= today. These become delivered placeholder waves; the LAST one is the
 * most recent wave, so next-due = last + cadence rolls into the future.
 * Returns [] if cadenceMonths is null/0 or base is already >= today (no gap).
 * All dates are YYYY-MM-DD; months step UTC-anchored (from the fixed base) with
 * Postgres-style day clamping (see addMonthsClampedUTC) to avoid TZ/month-end
 * drift.
 *
 * SOURCE OF TRUTH: scripts/backfill-placeholders.mjs inlines a copy of this
 * (addMonthsClampedUTC + placeholderWaveDates) — a plain .mjs can't import this
 * .ts. Keep the two BYTE-IDENTICAL in behavior if you change the algorithm. */
export function placeholderWaveDates(
  baseISO: string | null,
  cadenceMonths: number | null,
  todayISO: string,
): string[] {
  if (!baseISO || !cadenceMonths) return []
  const base = new Date(baseISO + 'T00:00:00Z')
  if (isNaN(base.getTime())) return []
  const out: string[] = []
  // Cap iterations so a bad input (e.g. today far in the future) can never loop
  // forever — 600 covers 50 years of monthly waves, far more than real data.
  for (let i = 1; i <= 600; i++) {
    const iso = addMonthsClampedUTC(base, cadenceMonths * i).toISOString().slice(0, 10)
    if (iso <= todayISO) out.push(iso)
    else break
  }
  return out
}

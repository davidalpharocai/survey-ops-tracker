// Pure analytics for the project Insights tab — no I/O, fully testable. Dates are
// passed in (incl. "today") so the math is deterministic under test.

export function pctOf(n: number, d: number | null | undefined): number | null {
  return d != null && d > 0 ? (n / d) * 100 : null
}

/** Whole days from start→end (floored, min 0). Accepts YYYY-MM-DD or full ISO. */
export function daysBetween(startISO: string, endISO: string): number {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : 0
}

export interface Pace {
  perDay: number | null
  daysElapsed: number
  remaining: number | null
  projectedDaysToTarget: number | null
  projectedFinishISO: string | null
}

/** Collection pace + a naive linear projection of when the target is hit. */
export function computePace(opts: {
  collected: number
  target: number | null
  startISO: string | null
  todayISO: string
}): Pace {
  const { collected, target, startISO, todayISO } = opts
  const empty: Pace = { perDay: null, daysElapsed: 0, remaining: null, projectedDaysToTarget: null, projectedFinishISO: null }
  if (!startISO) return empty
  // A future (or unparseable) start date means fielding hasn't begun — no meaningful
  // pace yet. (Guards pre-launch data entry from inflating per-day / finish.)
  const startMs = new Date(startISO).getTime()
  const todayMs = new Date(todayISO).getTime()
  if (!Number.isFinite(startMs) || startMs > todayMs) return empty
  const daysElapsed = Math.max(1, daysBetween(startISO, todayISO))
  const perDay = collected > 0 ? collected / daysElapsed : 0
  const remaining = target != null ? Math.max(0, target - collected) : null
  if (remaining === 0) return { perDay, daysElapsed, remaining, projectedDaysToTarget: 0, projectedFinishISO: todayISO.slice(0, 10) }
  if (remaining != null && perDay > 0) {
    const projectedDaysToTarget = Math.ceil(remaining / perDay)
    const d = new Date(todayISO)
    d.setDate(d.getDate() + projectedDaysToTarget)
    return { perDay, daysElapsed, remaining, projectedDaysToTarget, projectedFinishISO: d.toISOString().slice(0, 10) }
  }
  return { perDay, daysElapsed, remaining, projectedDaysToTarget: null, projectedFinishISO: null }
}

/** Blended all-in cost per completed response. */
export function costPerComplete(actualSpend: number, collected: number): number | null {
  return collected > 0 ? actualSpend / collected : null
}

/** Projected final cost = blended cost/complete × the completes we'll end up paying for.
 *  Floored at what's already collected so an over-quota project never projects a final
 *  cost below money already spent. */
export function projectedFinalCost(blended: number | null, target: number | null, collected = 0): number | null {
  return blended != null && target != null ? blended * Math.max(target, collected) : null
}

// ---- B2B (blasts) ----

export interface BlastLite {
  people: number | null
  completes: number | null
  bid: number | null
  blast_at: string | null
  note?: string | null
}

/** Completion rate = completes ÷ people reached (%). null if no reach recorded. */
export function blastCompletionRate(b: BlastLite): number | null {
  return pctOf(b.completes ?? 0, b.people ?? 0)
}

/** Cumulative completes over time (chronological by blast date). */
export function cumulativeCompletes(blasts: BlastLite[]): { at: string | null; cumulative: number }[] {
  const sorted = [...blasts].sort((a, b) => (a.blast_at ?? '').localeCompare(b.blast_at ?? ''))
  let run = 0
  return sorted.map((b) => {
    run += b.completes ?? 0
    return { at: b.blast_at, cumulative: run }
  })
}

// ---- PS (suppliers across launches) ----

export interface SupplierAgg {
  name: string
  collected: number
  spend: number
  cpi: number // latest CPI seen for this supplier (for a "best value" read)
}

/** Aggregate supplier rows (across all launches) by supplier name, richest first. */
export function supplierMix(rows: { name: string; cpi: number; n_collected: number }[]): SupplierAgg[] {
  const m = new Map<string, SupplierAgg>()
  for (const r of rows) {
    const a = m.get(r.name) ?? { name: r.name, collected: 0, spend: 0, cpi: r.cpi || 0 }
    a.collected += r.n_collected || 0
    a.spend += (r.cpi || 0) * (r.n_collected || 0)
    a.cpi = r.cpi || a.cpi
    m.set(r.name, a)
  }
  return [...m.values()].sort((a, b) => b.collected - a.collected)
}

/** The supplier delivering completes at the lowest effective CPI (spend ÷ collected);
 *  only among those that collected anything. null if none collected. */
export function bestValueSupplier(aggs: SupplierAgg[]): { name: string; effectiveCpi: number } | null {
  let best: { name: string; effectiveCpi: number } | null = null
  for (const a of aggs) {
    if (a.collected <= 0) continue
    const eff = a.spend / a.collected
    if (!best || eff < best.effectiveCpi) best = { name: a.name, effectiveCpi: eff }
  }
  return best
}

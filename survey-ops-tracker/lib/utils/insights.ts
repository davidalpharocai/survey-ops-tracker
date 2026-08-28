// Pure analytics for the project Insights tab — no I/O, fully testable. Dates are
// passed in (incl. "today") so the math is deterministic under test.
//
// A note on N since migration 078: `n_target` is the FLOOR of a range (the N we
// committed to) and `n_target_max` is the ceiling. Every `target` in this file is
// whatever the caller passed, and callers pass the floor — so "100%", "on track",
// and "projected final" all mean "clears the commitment", not "fills the range".
// That's the intended reading (the floor is what we owe), but it's a real
// decision: a caller that wants the top of the range must pass n_target_max in.
// Nothing here should silently mix the two.

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

export interface SegmentPaceRow {
  label: string
  collected: number
  target: number | null
  /** collected ÷ target, as a percent. */
  pct: number | null
  perDay: number | null
  projectedFinishISO: string | null
  /** Where this segment lands by the due date at the current pace. */
  projectedFinal: number | null
  /** projectedFinal ÷ target, as a percent. */
  projectedPct: number | null
  /** true = projected to hit its own target by the due date (or already met);
   *  false = behind; null = can't assess (no target, or no due date to judge against). */
  onTrack: boolean | null
}

/**
 * Per-segment pace. Judged against each segment's own n_target — the FLOOR of its
 * range — so `onTrack` means "will clear what we committed to for this segment".
 * A total-N that meets/exceeds the project target can hide a
 * segment that's badly under its OWN target — over-collecting Buyers doesn't
 * rescue an under-collected Sellers. So each segment is paced independently
 * against its own target, using the project's launch date + due date (segments
 * share the project timeline — they don't have their own dates).
 * Pure: `todayISO` is passed in.
 */
export function segmentPaces(opts: {
  segments: { label: string | null; n_target: number | null; n_collected: number | null }[]
  startISO: string | null
  dueISO: string | null
  todayISO: string
  /** Once delivered, collection has stopped — judge each segment on collected-vs-target,
   *  not a meaningless forward projection. */
  delivered?: boolean
}): SegmentPaceRow[] {
  return opts.segments.map((s, i) => {
    const collected = s.n_collected ?? 0
    const target = s.n_target
    const pace = computePace({ collected, target, startISO: opts.startISO, todayISO: opts.todayISO })
    const pct = pctOf(collected, target)
    // Projected final only exists when there's a forward pace AND a due date to project to.
    let projectedFinal: number | null = null
    if (pace.perDay != null && opts.dueISO) {
      const daysLeft = daysBetween(opts.todayISO, opts.dueISO)
      projectedFinal = Math.round(collected + pace.perDay * daysLeft)
    }
    const projectedPct = projectedFinal != null ? pctOf(projectedFinal, target) : null
    let onTrack: boolean | null = null
    if (target != null && target > 0) {
      if (collected >= target) onTrack = true // already met
      else if (opts.delivered) onTrack = false // delivered under target = short (no projection)
      else if (pace.perDay == null) onTrack = null // fielding hasn't started (pre-launch) — can't assess
      else if (projectedPct == null) onTrack = null // no due date to judge against
      // Derive from the SAME rounded % the UI shows, so status + number never contradict.
      else onTrack = Math.round(projectedPct) >= 100
    }
    return {
      label: (s.label && s.label.trim()) || `Segment ${i + 1}`,
      collected,
      target,
      pct,
      perDay: pace.perDay,
      projectedFinishISO: pace.projectedFinishISO,
      projectedFinal,
      projectedPct,
      onTrack,
    }
  })
}

/** Projected final cost = blended cost/complete × the completes we'll end up paying for.
 *  Floored at what's already collected so an over-quota project never projects a final
 *  cost below money already spent.
 *  `target` is the N you intend to pay for: pass n_target for the cost of meeting the
 *  commitment, n_target_max for the worst case if the range fills. This is spend
 *  (cost to run), so it stays visible to the whole team — unlike the budget ceiling
 *  it gets compared against. */
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

/**
 * Completion rate = completes ÷ people reached (%). null when the rate is
 * UNKNOWN, which is either no reach recorded (no denominator) or no completes
 * recorded (no numerator).
 *
 * The completes half is not defensive tidying. `completes ?? 0` here reported
 * 0.00% for 13 of the 18 blasts that had a reach — every one of them a blast
 * whose completes nobody had typed in yet (migration 091). Averaged together
 * those fabricated zeros made the portfolio read as if HIGHER bids produced
 * LOWER response, the exact opposite of the truth, because the expensive blasts
 * happened to be the ones still awaiting their counts. An absent numerator has
 * to propagate as "unknown" or it becomes evidence for a conclusion.
 *
 * A recorded 0 completes still yields 0.00% — that blast really did fail.
 */
export function blastCompletionRate(b: BlastLite): number | null {
  if (b.completes == null) return null
  return pctOf(b.completes, b.people ?? 0)
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

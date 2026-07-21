// Pure PS-suppliers math for the Money card. CPI = cost per interview (the rate a
// PureSpectrum sample supplier charges per completed response). Per-supplier caps
// are ceilings on ONE shared pool (the project's target), not additive — so before
// any completes are recorded the cost is a RANGE, and once per-supplier N collected
// is entered the actual cost = Σ(CPI × N collected).

export interface SupplierLine {
  cpi: number
  completes_cap: number
  n_collected?: number | null
}

/** Actual spend so far = Σ(CPI × N collected). */
export function actualCost(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.cpi || 0) * (r.n_collected || 0), 0)
}

/** Σ N collected across suppliers (should reconcile to the project's N collected). */
export function totalCollected(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.n_collected || 0), 0)
}

/** Blended actual CPI = actual spend ÷ total collected; null if none collected. */
export function blendedActualCpi(rows: SupplierLine[]): number | null {
  const c = totalCollected(rows)
  return c > 0 ? actualCost(rows) / c : null
}

/** Cost range to hit `target` completes given the suppliers' CPIs: cheapest-fills-it
 *  (low) to priciest-fills-it (high). null if no target or no priced suppliers. */
export function estimateRange(target: number | null, rows: SupplierLine[]): { low: number; high: number } | null {
  if (!target || target <= 0) return null
  const cpis = rows.map((r) => r.cpi || 0).filter((c) => c > 0)
  if (cpis.length === 0) return null
  return { low: target * Math.min(...cpis), high: target * Math.max(...cpis) }
}

/** Σ completes cap across suppliers (each cap is a per-supplier ceiling). */
export function totalCappedCompletes(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.completes_cap || 0), 0)
}

/** The most common completes_cap among a launch's priced/capped suppliers (the mode;
 *  ties break to the larger cap). null if none. Used as the default launch target —
 *  in practice a launch's target and its per-supplier caps are the same number. */
export function modalCap(rows: SupplierLine[]): number | null {
  const caps = rows.map((r) => r.completes_cap || 0).filter((c) => c > 0)
  if (caps.length === 0) return null
  const counts = new Map<number, number>()
  for (const c of caps) counts.set(c, (counts.get(c) || 0) + 1)
  let best = caps[0]
  let bestN = 0
  for (const [c, n] of counts) if (n > bestN || (n === bestN && c > best)) { best = c; bestN = n }
  return best
}

// ---- Launch-level ----
// A PS project has 1..N launches (fielding waves). Each launch is a target + its own
// supplier lines. Actual cost is just Σ over all lines (launches don't change it); the
// ESTIMATE is per-launch (target × min..max CPI) and the project estimate is their sum.

export interface LaunchLite {
  target?: number | null
  lines: SupplierLine[]
}

/** One launch's estimate range = its target × [cheapest CPI … priciest CPI in the launch]. */
export function launchRange(launch: LaunchLite): { low: number; high: number } | null {
  return estimateRange(launch.target ?? null, launch.lines)
}

/** Project estimate range = the SUM of each launch's range. Launches with no target or
 *  no priced suppliers contribute nothing; null if none contribute. */
export function projectEstimateRange(launches: LaunchLite[]): { low: number; high: number } | null {
  let low = 0
  let high = 0
  let any = false
  for (const l of launches) {
    const r = launchRange(l)
    if (r) {
      low += r.low
      high += r.high
      any = true
    }
  }
  return any ? { low, high } : null
}

/** Project actual cost = Σ(CPI × N collected) across every launch's lines. */
export function projectActualCost(launches: LaunchLite[]): number {
  return launches.reduce((s, l) => s + actualCost(l.lines), 0)
}

/** Σ N collected across all launches. */
export function projectCollected(launches: LaunchLite[]): number {
  return launches.reduce((s, l) => s + totalCollected(l.lines), 0)
}

/** Σ of the launch targets — the project's planned completes across all launches. */
export function projectTarget(launches: LaunchLite[]): number {
  return launches.reduce((s, l) => s + (l.target || 0), 0)
}

/** Blended actual CPI across launches = project actual ÷ project collected; null if none collected. */
export function projectBlendedCpi(launches: LaunchLite[]): number | null {
  const c = projectCollected(launches)
  return c > 0 ? projectActualCost(launches) / c : null
}

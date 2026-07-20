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

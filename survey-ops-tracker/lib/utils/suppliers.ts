// Pure PS-suppliers math for the Money card. CPI = cost per interview (the rate a
// PureSpectrum sample supplier charges per completed response). Estimate-only —
// SOCC has no per-supplier completes, so this is planning, not actuals.

export interface SupplierLine {
  cpi: number
  completes_cap: number
}

/** Max spend if every supplier fills its cap = Σ(cap × CPI). */
export function estimatedCost(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.cpi || 0) * (r.completes_cap || 0), 0)
}

/** Σ completes cap across suppliers. */
export function totalCappedCompletes(rows: SupplierLine[]): number {
  return rows.reduce((s, r) => s + (r.completes_cap || 0), 0)
}

/** Cap-weighted CPI = estimatedCost / Σcap; null if there are no caps. */
export function blendedCpi(rows: SupplierLine[]): number | null {
  const caps = totalCappedCompletes(rows)
  return caps > 0 ? estimatedCost(rows) / caps : null
}

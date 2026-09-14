/**
 * Which money widgets a project shows.
 *
 * ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
 * This used to be a straight switch on project_type: PS showed Suppliers, B2B
 * showed Blasts, and Rerun/untyped showed both. That treated the type LABEL as
 * a statement about how the survey was fielded, and it is not one. A B2B study
 * whose second wave went to PureSpectrum had nowhere to record it, and — worse —
 * rows that already existed were rendered nowhere at all:
 *
 *   Measured 2026-09-14: 10 projects held $20,197.73 of spend that counted
 *   toward actual_spend with no section on the page that could explain it.
 *   On PR00292, PR00279, PR00293 and PR00441 that was ONE HUNDRED PERCENT of
 *   the figure shown — the page displayed a spend number and nothing beneath it
 *   that added up to it. project_blasts and project_suppliers both feed
 *   recompute_project_spend (migration 095), so the money was always counted;
 *   only the explanation was missing.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * Show a source if the project is TYPED for it, or if it HAS rows for it, or if
 * the user has just asked to add it. Existence wins over the label, which makes
 * this self-healing: the moment a launch or a blast exists it becomes visible,
 * with no re-typing and no migration.
 *
 * project_type keeps its job — it is what the survey IS, and it still drives
 * rerun defaults and pricing. It simply stops dictating how the money was spent.
 */
export function moneySources(opts: {
  projectType: string | null
  hasBlasts: boolean
  hasPS: boolean
  alsoPS: boolean
  alsoBlasts: boolean
}) {
  // Legacy 'Rerun' rows predate the type/dimension split and were never
  // re-typed; untyped rows never mapped cleanly. Both show everything.
  const untyped = opts.projectType === 'Rerun' || opts.projectType == null
  return {
    showSuppliers: untyped || opts.projectType === 'PS' || opts.hasPS || opts.alsoPS,
    showBlasts: untyped || opts.projectType === 'B2B' || opts.hasBlasts || opts.alsoBlasts,
  }
}

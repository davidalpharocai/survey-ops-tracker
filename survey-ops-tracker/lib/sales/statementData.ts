/**
 * What the Survey Activity Statement is built from, shared by the two routes
 * that build it.
 *
 * TWO ROUTES, ONE DOCUMENT:
 *
 *   /sales/accounts/[id]/print      a salesperson, reading the sales_* views,
 *                                   scoped to their own book by migration 102.
 *   /clients/[id]/statement         an analyst, reading the base tables.
 *
 * They exist separately because they cannot share a data path: `sales_projects`
 * opens with `where public.my_role() = 'sales'`, so an analyst selecting from
 * it gets zero rows no matter what else is true. The analyst route is not a
 * back door — an analyst already reads every column of survey_projects — it is
 * the only way for anyone but a salesperson to produce the document at all.
 * David asked for it on 2026-09-28: "can you enable the pdf feature for me so i
 * can test it vs having to view-as alex every time."
 *
 * WHAT MUST NOT DRIFT is what each route hands the component. Two routes
 * selecting their own column lists is how the same account comes out as two
 * different documents, so the list lives here and both import it.
 */

/**
 * The columns AccountPrint needs, and only those.
 *
 * AN ALLOWLIST, NOT A CONVENIENCE. `select('*')` on survey_projects would pull
 * n_internal_target, budget and actual_spend into the payload of a page whose
 * whole purpose is to be handed to a client. The component would not print
 * them, which is not the same as their not being there — and the sales route
 * cannot select them at all, so `*` would also be the two routes' first point
 * of divergence. Adding a column here is a disclosure decision about a
 * client-facing document; treat it like the comment on the sales_projects view
 * does.
 *
 * Mirrors the sales view's projection (migration 102). Every name here exists
 * in BOTH survey_projects and sales_projects.
 */
export const STATEMENT_PROJECT_COLS =
  'id, project_code, project_name, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, term_id, submitted_date, launch_date, deliver_date, delivered_at, requested_by_name, longitudinal, rerun_number'

/**
 * Which of these surveys have never had their collected count recorded.
 *
 * The sales route reads `sales_n_collected_freshness` (migration 111), a
 * two-column view that exists precisely because project_audit carries spend and
 * internal targets in old_value/new_value and is denied to the sales tier. An
 * analyst has no such problem and reads project_audit directly — but the RULE
 * has to match, or the same account prints "not recorded" on one route and a 0
 * on the other.
 *
 * The rule: a survey with no `n_collected` audit row has never been measured,
 * and its 0 is the column default rather than a count. `changed_at` is not
 * needed — the statement asks only whether a row exists.
 *
 * A FAILED READ RETURNS AN EMPTY LIST, never "all of them". Not knowing whether
 * a count was recorded is a statement about our access; marking every survey
 * "not recorded" on the strength of it would put a claim about the client's
 * data on the client's document.
 */
export function neverRecordedFrom(
  ids: string[],
  audit: { project_id: string }[] | null,
  failed: boolean,
): string[] {
  if (failed) return []
  const seen = new Set((audit ?? []).map(a => a.project_id))
  return ids.filter(id => !seen.has(id))
}

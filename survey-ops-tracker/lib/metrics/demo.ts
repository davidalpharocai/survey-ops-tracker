/**
 * Keeping demo and test accounts out of the numbers.
 *
 * David, 2026-09-14: "PR00300 is a demo record and should always be excluded
 * from metrics, reporting, and everything in between."
 *
 * ── WHY THIS EXISTS WHEN `reportable_projects` ALREADY DOES ─────────────────
 * Migration 113 added a view that does exactly this filtering, and it is the
 * right thing for a caller that only needs columns. Several of the callers here
 * cannot use it: PostgREST resolves an embedded resource
 * (`captain:team_members(name, initials)`) through a foreign key, and a VIEW has
 * no foreign keys — so switching those selects to the view turns a working
 * embed into a runtime error. Rather than unpick the embeds, these callers keep
 * reading the table and drop the rows here.
 *
 * ── FILTERED IN JS, DELIBERATELY, NOT WITH .not('client_id','in',…) ─────────
 * The obvious PostgREST version excludes rows whose client_id is in the demo
 * list. But `NULL not in (…)` is NULL, not true, so every project with NO
 * client_id would be silently dropped from the numbers as well — the exact
 * class of silent, in-our-favour error this whole strand of work has been about.
 * These functions already load their full working set, so filtering afterwards
 * is both correct and free.
 *
 * ── WHAT IS NOT FILTERED ───────────────────────────────────────────────────
 * Search, the board, the list, and anything scoped to one record. PR00300 has
 * to stay openable and findable — it is the project the guide-screenshot
 * pipeline drives. The rule is that it does not COUNT, not that it disappears.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Rows shaped enough to be filtered. Anything with a client_id qualifies. */
export interface HasClient {
  client_id?: string | null
}

/**
 * The ids of accounts flagged `is_demo` (migration 113).
 *
 * Returns an EMPTY SET if the column or table cannot be read — which means
 * nothing is filtered and the demo row reappears in the numbers. That is the
 * right failure: over-reporting by one known survey is visible and fixable,
 * whereas throwing here would take down every metric in the app because a
 * cosmetic exclusion could not be resolved.
 */
export async function demoClientIds(supabase: SupabaseClient): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('clients').select('id, is_demo')
    if (error) return new Set()
    return new Set(
      (data as { id: string; is_demo?: boolean | null }[])
        .filter(c => c.is_demo === true)
        .map(c => c.id),
    )
  } catch {
    return new Set()
  }
}

/** Drop rows belonging to a demo account. A row with no client_id is KEPT —
 *  "no account recorded" is not "demo account". */
export function withoutDemo<T extends HasClient>(rows: T[], demo: Set<string>): T[] {
  if (demo.size === 0) return rows
  return rows.filter(r => !(r.client_id && demo.has(r.client_id)))
}

/** Load the flag set and filter in one call, for the common case. */
export async function excludeDemo<T extends HasClient>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<T[]> {
  return withoutDemo(rows, await demoClientIds(supabase))
}

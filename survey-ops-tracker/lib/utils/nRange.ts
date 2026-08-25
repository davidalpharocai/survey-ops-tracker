// The agreed N target is a RANGE, not one number (migration 078): `n_target` is
// the MINIMUM and `n_target_max` the maximum, on both survey_projects and
// project_segments. A null max means "no upper end agreed" — the single-number
// case we had before 078 — so every reader has to resolve it to the min before
// doing anything with it, and every WRITER has to send both ends in one patch
// (the DB trigger raises on max < min and only sees the fields the patch
// carries). This module is the one place those two rules live: the range editor,
// the gen-pop floor grading, and the segment rollup readout all come here.

import { fmtNum } from '@/lib/utils/number'

export interface NRange {
  min: number | null
  max: number | null
}

/**
 * Resolve a half-set pair. A null max mirrors the min (one agreed number), and a
 * null min mirrors the max — that second case is only reachable from a row
 * hand-edited in SQL, but the range still has to render rather than blank out.
 * Both null stays both null: nothing agreed yet.
 */
export function resolveNRange(
  min: number | null | undefined,
  max: number | null | undefined,
): NRange {
  const lo = min ?? null
  const hi = max ?? null
  if (lo == null && hi == null) return { min: null, max: null }
  return { min: lo ?? hi, max: hi ?? lo }
}

/**
 * True when the pair is inverted — exactly what migration 078's
 * enforce_n_target_range trigger RAISES on. Checked client-side first so a
 * transposed range is caught in the editor, next to the two boxes that caused
 * it, instead of coming back as a failed save.
 */
export function isInvertedNRange(
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const r = resolveNRange(min, max)
  return r.min != null && r.max != null && r.max < r.min
}

/**
 * Human range: "1,350" when both ends agree (the single-number case), otherwise
 * "1,350 – 1,600". Returns `empty` when nothing is set.
 */
export function formatNRange(
  min: number | null | undefined,
  max: number | null | undefined,
  empty = '—',
): string {
  const r = resolveNRange(min, max)
  if (r.min == null || r.max == null) return empty
  return r.min === r.max ? fmtNum(r.min) : `${fmtNum(r.min)} – ${fmtNum(r.max)}`
}

/**
 * Roll a set of segments up into the project total: sum(min) .. sum(max).
 *
 * Deliberately mirrors sync_segment_totals() from migration 078 statement 4, so
 * the readout on the page and the number the trigger writes can't disagree:
 *   · the min is the plain sum of the segment mins (null-skipping);
 *   · a segment with no max contributes its min to the top end too
 *     (sum(coalesce(max, min))), because one agreed number is a degenerate
 *     range;
 *   · but if NO segment has a max, the project total's max stays null rather
 *     than sprouting a range nobody agreed to.
 */
export function sumNRange(
  rows: { n_target: number | null; n_target_max?: number | null }[],
): NRange {
  let min: number | null = null
  let max: number | null = null
  let anyMax = false
  for (const row of rows) {
    if (row.n_target != null) min = (min ?? 0) + row.n_target
    if (row.n_target_max != null) anyMax = true
    const hi = row.n_target_max ?? row.n_target
    if (hi != null) max = (max ?? 0) + hi
  }
  return { min, max: anyMax ? max : null }
}

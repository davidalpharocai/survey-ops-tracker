import type { createAdminClient } from '@/lib/supabase/admin'

// Legacy-lineage (rerun_series_id root pointer) wave renumbering. Shared by the
// link/unlink route (app/api/projects/link-rerun) and the legacy auto-spawn
// cron (app/api/cron/spawn-reruns) so a wave number is ALWAYS the wave's real
// chronological position — never a naive max+1 that leaves gaps when history
// is imported out of order (the "Mattress Firm 1,3,4" bug, 2026-08). Distinct
// from the first-class rerun_series model (migration 073), whose numbering is
// next_wave_no on the series row; this heals the un-migrated lineage data.

export interface LineageWave {
  id: string
  submitted_date: string | null
  launch_date: string | null
  deliver_date: string | null
  created_at: string | null
}

/** Pure: given all live waves in a legacy lineage and the root (original) id,
 * return the full (id → rerun_number) assignment. The root is always Wave 1;
 * the rest are ordered by submitted → launch → deliver → created date and
 * numbered 2, 3, … contiguously. Because numbers come from POSITION (not the
 * stored rerun_number), any pre-existing gap self-heals on every recompute.
 * deliver_date is in the fallback chain because some series (weekly trackers)
 * have no submitted/launch date and share an import created_at — deliver_date
 * is then the only per-wave signal that keeps the order stable. */
export function orderLineageByDate(waves: LineageWave[], root: string): { id: string; num: number }[] {
  const key = (w: LineageWave) =>
    String(w.submitted_date ?? w.launch_date ?? w.deliver_date ?? w.created_at ?? '')
  const rest = waves.filter((w) => w.id !== root).sort((a, b) => key(a).localeCompare(key(b)))
  return [{ id: root, num: 1 }, ...rest.map((w, i) => ({ id: w.id, num: i + 2 }))]
}

/** Fetch a legacy lineage (root + every wave pointing at it), compute the
 * position-based numbering, and write back only the rows whose number actually
 * changed. Idempotent — safe to call after every link/unlink and after every
 * legacy auto-spawn. */
export async function renumberLegacyLineage(
  admin: ReturnType<typeof createAdminClient>,
  root: string
): Promise<void> {
  const { data: waves } = await admin
    .from('survey_projects')
    .select('id, rerun_number, submitted_date, launch_date, deliver_date, created_at')
    .or(`id.eq.${root},rerun_series_id.eq.${root}`)
    .is('deleted_at', null)
  if (!waves) return
  const current = new Map(waves.map((w) => [w.id, w.rerun_number]))
  const targets = orderLineageByDate(waves as LineageWave[], root)
  for (const t of targets) {
    if (current.get(t.id) !== t.num) {
      await admin.from('survey_projects').update({ rerun_number: t.num }).eq('id', t.id)
    }
  }
}

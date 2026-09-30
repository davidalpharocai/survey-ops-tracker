import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { renumberLegacyLineage } from '@/lib/reruns/renumberLineage'
import { SeriesOpError, attachProjectToSeries, detachProjectFromSeries } from '@/lib/reruns/seriesOps'

export const dynamic = 'force-dynamic'

// Link an existing project into a rerun series (or detach it). Mirrors the model
// the auto-rerun cron already uses: a series is anchored to the ORIGINAL survey —
// the original has rerun_series_id = null (its own id IS the series id), and every
// later wave stores that root id in rerun_series_id, with rerun_number as the wave #.
// Analyst-gated; writes go through the service-role client.
//
// ── WHY THIS ROUTE ALSO WRITES series_id (2026-09-28) ───────────────────────
// Two columns describe rerun lineage, and this route used to write only one:
//
//   rerun_series_id -> the ROOT PROJECT's id. The legacy lineage pointer, and
//                      what the project page's wave list reads.
//   series_id       -> a rerun_series row (migration 073). What the SERIES page,
//                      the client-page grouping, the weekly digest and the spawn
//                      cron read.
//
// So a survey linked here showed up correctly on the project page and was
// invisible everywhere else. Not hypothetical: PR00463 was linked to PR00199
// through this route, and the Bioprocessing series page then reported its wave 2
// missing while the project page showed the link. Both screens were right inside
// their own model. Migration 124 repaired the 51 rows that had accumulated this
// way — and without this change the next click starts accumulating them again.
//
// The first-class path (app/api/reruns/series, attach_wave) has always written
// BOTH halves, and seriesOps.attachProjectToSeries says why at length. Rather
// than duplicate what it knows — the legacy-family sweep, the cross-client
// refusal, the parked-negative wave numbering that gets past migration 073's
// unique index — this route now calls it. The legacy write happens first, so the
// family attachProjectToSeries sweeps is the subtree we just moved.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

type Row = { id: string; rerun_series_id: string | null; rerun_number: number | null; series_id: string | null }

// Wave numbering by chronological position (root = Wave 1, rest by date) lives
// in lib/reruns/renumberLineage.ts (renumberLegacyLineage) so the auto-spawn
// cron heals the same way this route does. Called after every link/unlink.

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const actor = user.email ?? 'unknown'

  let body: { childId?: string; parentId?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const childId = (body.childId ?? '').trim()
  if (!childId) return NextResponse.json({ error: 'childId is required' }, { status: 400 })
  const parentId = body.parentId ? body.parentId.trim() : null

  const admin = createAdminClient()

  const { data: child } = await admin
    .from('survey_projects')
    .select('id, rerun_series_id, rerun_number, series_id')
    .eq('id', childId)
    .maybeSingle()
  if (!child) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  // If this project is itself a series root with its own waves, we MOVE the whole
  // subtree under the new root at link time (below) — merging two series instead of
  // refusing. The only illegal case is linking under yourself or your own wave,
  // which the `root === childId` cycle guard further down rejects.

  try {
    // ---- Unlink: make it a standalone survey again ----
    if (!parentId) {
      const c = child as Row
      // A survey in a first-class series leaves through detachProjectFromSeries,
      // which clears BOTH columns and carries two guards this route does not
      // have: it refuses to unanchor a series (removing its Wave 1) and refuses
      // to leave one with no waves at all. Both refusals are written to be read
      // by a person and pass through verbatim.
      if (c.series_id) {
        const { seriesId } = await detachProjectFromSeries(admin, childId, actor)
        if (c.rerun_series_id) await renumberLegacyLineage(admin, c.rerun_series_id)
        return NextResponse.json({ ok: true, unlinked: true, detachedFromSeries: seriesId })
      }
      const oldRoot = c.rerun_series_id
      const { error } = await admin
        .from('survey_projects')
        .update({ rerun_series_id: null, rerun_number: 1 })
        .eq('id', childId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (oldRoot) await renumberLegacyLineage(admin, oldRoot) // heal the waves left behind
      return NextResponse.json({ ok: true, unlinked: true })
    }

    // ---- Link: attach child under the parent's series root ----
    if (parentId === childId)
      return NextResponse.json({ error: "A study can't be a rerun of itself." }, { status: 400 })

    const { data: parent } = await admin
      .from('survey_projects')
      .select('id, rerun_series_id, rerun_number, series_id')
      .eq('id', parentId)
      .maybeSingle()
    if (!parent) return NextResponse.json({ error: 'Parent study not found.' }, { status: 404 })

    const p = parent as Row
    const root = p.rerun_series_id ?? p.id
    if (root === childId)
      return NextResponse.json(
        { error: "That study is already part of this one's series — pick a different original." },
        { status: 400 }
      )

    // Which first-class series does this family belong to, if any? Read it off
    // the ROOT rather than the parent, because the parent may be a mid-series
    // wave and it is the root that anchors the family. Falling back to the
    // parent's own series covers the case where the root predates the series and
    // never got linked itself. Read BEFORE any write, so a survey that cannot
    // join the series fails before it has been half-linked.
    const { data: rootRow } = await admin
      .from('survey_projects')
      .select('id, series_id')
      .eq('id', root)
      .maybeSingle()
    const targetSeries = (rootRow?.series_id as string | null) ?? p.series_id ?? null

    const c = child as Row
    if (targetSeries && c.series_id && c.series_id !== targetSeries) {
      return NextResponse.json(
        {
          error:
            'That study is already in a different rerun series. Remove it from that one first, then link it here.',
        },
        { status: 409 }
      )
    }

    // Move the child AND any waves that hang off it (its own subtree) under the new
    // root, so merging two series keeps every wave rather than orphaning the child's.
    // Then renumber the whole series by chronological position (not max+1).
    const { data: descendants } = await admin
      .from('survey_projects')
      .select('id')
      .eq('rerun_series_id', childId)
      .is('deleted_at', null)
    const moveIds = [childId, ...(descendants ?? []).map((d) => d.id)]
    const { error } = await admin
      .from('survey_projects')
      .update({ rerun_series_id: root })
      .in('id', moveIds)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await renumberLegacyLineage(admin, root)

    // Now the first-class half. attachProjectToSeries sweeps the legacy family,
    // which after the write above is exactly the subtree we just moved — so one
    // call carries every wave in with it.
    //
    // It can also REFUSE: a survey belonging to another client, or a family
    // member already sitting in a different series. Those refusals are correct
    // and their messages are written for a person — but the legacy write above
    // has already landed by then, and leaving it would produce exactly the
    // half-linked row this whole change exists to prevent. Two PostgREST calls
    // share no transaction, so put the first one back by hand before
    // re-throwing.
    let attached: string[] = []
    if (targetSeries) {
      const priorRoot = (child as Row).rerun_series_id
      try {
        const res = await attachProjectToSeries(admin, targetSeries, childId, actor)
        attached = res.attached
      } catch (attachErr) {
        await admin.from('survey_projects').update({ rerun_series_id: priorRoot }).in('id', moveIds)
        await renumberLegacyLineage(admin, root)
        if (priorRoot) await renumberLegacyLineage(admin, priorRoot)
        throw attachErr
      }
    }
    return NextResponse.json({
      ok: true,
      seriesId: root,
      moved: moveIds.length,
      // null when the family has no first-class series yet. That is still a
      // coherent state — the legacy lineage alone is what "Put into rerun
      // service" exists to upgrade — it is just not one the series page can see.
      series: targetSeries,
      attached,
    })
  } catch (e) {
    if (e instanceof SeriesOpError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Request failed.' }, { status: 500 })
  }
}

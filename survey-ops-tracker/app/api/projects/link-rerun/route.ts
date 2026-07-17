import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Link an existing project into a rerun series (or detach it). Mirrors the model
// the auto-rerun cron already uses: a series is anchored to the ORIGINAL survey —
// the original has rerun_series_id = null (its own id IS the series id), and every
// later wave stores that root id in rerun_series_id, with rerun_number as the wave #.
// Analyst-gated; writes go through the service-role client.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

type Row = { id: string; rerun_series_id: string | null; rerun_number: number | null }

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    .select('id, rerun_series_id, rerun_number')
    .eq('id', childId)
    .maybeSingle()
  if (!child) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  // If this project is itself a series root that others hang off, refuse to move
  // it — that would orphan its own waves. (Unlink/relink those individually.)
  const { count: childrenOfChild } = await admin
    .from('survey_projects')
    .select('id', { count: 'exact', head: true })
    .eq('rerun_series_id', childId)
    .is('deleted_at', null)
  if ((childrenOfChild ?? 0) > 0)
    return NextResponse.json(
      { error: 'This survey already has its own rerun waves linked to it — detach those first.' },
      { status: 409 }
    )

  // ---- Unlink: make it a standalone survey again ----
  if (!parentId) {
    const { error } = await admin
      .from('survey_projects')
      .update({ rerun_series_id: null, rerun_number: 1 })
      .eq('id', childId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, unlinked: true })
  }

  // ---- Link: attach child under the parent's series root ----
  if (parentId === childId) return NextResponse.json({ error: "A survey can't be a rerun of itself." }, { status: 400 })

  const { data: parent } = await admin
    .from('survey_projects')
    .select('id, rerun_series_id, rerun_number')
    .eq('id', parentId)
    .maybeSingle()
  if (!parent) return NextResponse.json({ error: 'Parent survey not found.' }, { status: 404 })

  const p = parent as Row
  const root = p.rerun_series_id ?? p.id
  if (root === childId)
    return NextResponse.json(
      { error: "That survey is already part of this one's series — pick a different original." },
      { status: 400 }
    )

  // Next wave number = one past the current max in the target series.
  const { data: series } = await admin
    .from('survey_projects')
    .select('rerun_number')
    .or(`id.eq.${root},rerun_series_id.eq.${root}`)
    .is('deleted_at', null)
  const maxNum = (series ?? []).reduce((m, r) => Math.max(m, Number(r.rerun_number ?? 1)), 1)

  const { error } = await admin
    .from('survey_projects')
    .update({ rerun_series_id: root, rerun_number: maxNum + 1 })
    .eq('id', childId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, seriesId: root, waveNumber: maxNum + 1 })
}

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

// Renumber a whole series by chronological POSITION so wave numbers always reflect
// the real history and self-heal on link/unlink: the root (original) is Wave 1, the
// rest are numbered by date (submitted → launch → created) → Wave 2, 3, … Called
// after every link/unlink so numbers never go stale or leave gaps.
async function renumberSeries(admin: ReturnType<typeof createAdminClient>, root: string) {
  const { data: waves } = await admin
    .from('survey_projects')
    .select('id, submitted_date, launch_date, created_at')
    .or(`id.eq.${root},rerun_series_id.eq.${root}`)
    .is('deleted_at', null)
  if (!waves) return
  const key = (w: { submitted_date: string | null; launch_date: string | null; created_at: string | null }) =>
    String(w.submitted_date ?? w.launch_date ?? w.created_at ?? '')
  const rest = waves.filter((w) => w.id !== root).sort((a, b) => key(a).localeCompare(key(b)))
  const targets: { id: string; num: number }[] = [{ id: root, num: 1 }, ...rest.map((w, i) => ({ id: w.id, num: i + 2 }))]
  for (const t of targets) {
    await admin.from('survey_projects').update({ rerun_number: t.num }).eq('id', t.id)
  }
}

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

  // If this project is itself a series root with its own waves, we MOVE the whole
  // subtree under the new root at link time (below) — merging two series instead of
  // refusing. The only illegal case is linking under yourself or your own wave,
  // which the `root === childId` cycle guard further down rejects.

  // ---- Unlink: make it a standalone survey again ----
  if (!parentId) {
    const oldRoot = (child as Row).rerun_series_id
    const { error } = await admin
      .from('survey_projects')
      .update({ rerun_series_id: null, rerun_number: 1 })
      .eq('id', childId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (oldRoot) await renumberSeries(admin, oldRoot) // heal the waves left behind
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
  await renumberSeries(admin, root)
  return NextResponse.json({ ok: true, seriesId: root, moved: moveIds.length })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Analyst-only. Mirrors app/api/reruns/sync auth.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// POST { rerun_key, cadence_months?, last_wave_on?, expected_next_on?, owner_email?, paused?, display_name?, note? }
// Upserts the durable per-study meta (cadence / last-wave / owner) that powers
// the expected-next-wave computation in the rerun_status view.
export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const rerun_key = typeof body.rerun_key === 'string' ? body.rerun_key.trim() : ''
  if (!rerun_key) return NextResponse.json({ error: 'rerun_key required' }, { status: 400 })

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const cadence = [1, 3, 6, 12].includes(Number(body.cadence_months)) ? Number(body.cadence_months) : null

  const patch = {
    rerun_key,
    cadence_months: cadence,
    last_wave_on: str(body.last_wave_on),
    expected_next_on: str(body.expected_next_on),
    owner_email: str(body.owner_email),
    paused: body.paused === true,
    display_name: str(body.display_name),
    note: str(body.note),
    updated_by: user.email ?? null,
    updated_at: new Date().toISOString(),
  }

  const admin = createAdminClient()
  const { error } = await admin.from('rerun_meta').upsert(patch, { onConflict: 'rerun_key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

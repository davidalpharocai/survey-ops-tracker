import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// Analyst-only. Mirrors app/api/reruns/meta auth.
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// POST { overdue_count?, undefined_count?, due_soon_count?, note? }
// Records that the weekly rerun review was completed — arms the ritual off
// until next Monday and captures the board's state at review time.
export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('rerun_review_log')
    .insert({
      reviewed_by: user.email ?? null,
      overdue_count: int(body.overdue_count),
      undefined_count: int(body.undefined_count),
      due_soon_count: int(body.due_soon_count),
      note: str(body.note),
    })
    .select('id, reviewed_by, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, review: data })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { promoteEmail } from '@/lib/email-activity/promote'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Analyst-only (mirrors app/api/deliverables/[id]/resolve/route.ts).
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// POST { projectId } → file the queued email onto that project's timeline (promote).
// POST { ignore: true } → mark it ignored so it leaves the queue.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; ignore?: boolean }
  const admin = createAdminClient()

  if (body.ignore) {
    const { error } = await admin.from('email_inbox').update({ status: 'ignored' }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, ignored: true })
  }

  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const { data: row, error: rowErr } = await admin.from('email_inbox').select('*').eq('id', id).single()
  if (rowErr || !row) return NextResponse.json({ error: 'Email not found' }, { status: 404 })

  const result = await promoteEmail(admin, row, body.projectId)
  if (result.error) return NextResponse.json({ error: result.error.message ?? 'File failed' }, { status: 500 })
  return NextResponse.json({ ok: true, promoted: result.promoted, deduplicated: result.deduplicated })
}

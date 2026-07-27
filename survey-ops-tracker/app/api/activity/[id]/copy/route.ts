import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { promoteEmail } from '@/lib/email-activity/promote'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Analyst-only (mirrors app/api/activity/delete + email-review).
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// POST { projectId } — copy this email activity entry onto ANOTHER project's
// timeline (for a chain that references two surveys). Reuses promoteEmail, which
// is now per-project-idempotent (migration 065); with no queue-row id it only
// inserts the activity row and skips the email_inbox flip.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { projectId } = (await req.json().catch(() => ({}))) as { projectId?: string }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: src, error } = await admin
    .from('project_activity')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!src) return NextResponse.json({ error: 'Activity entry not found' }, { status: 404 })
  if (src.type !== 'email' || !src.external_id) {
    return NextResponse.json({ error: 'Only emails can be logged to another survey' }, { status: 400 })
  }
  if (src.project_id === projectId) {
    return NextResponse.json({ error: 'Already on that survey' }, { status: 400 })
  }

  const result = await promoteEmail(
    admin,
    {
      external_id: src.external_id,
      direction: src.direction,
      from_email: src.sender,
      to_emails: src.recipients ? src.recipients.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
      subject: src.subject,
      snippet: src.snippet,
      body: src.body,
      occurred_at: src.occurred_at,
      // no `id` → promoteEmail skips the email_inbox flip (this is a copy, not a filing).
    },
    projectId
  )
  if (result.error) return NextResponse.json({ error: result.error.message ?? 'Copy failed' }, { status: 500 })
  return NextResponse.json({ ok: true, promoted: result.promoted, deduplicated: result.deduplicated })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dismissDeliverable } from '@/lib/deliverables/resolve'
import { normalizeDisplayName } from '@/lib/deliverables/display-name'
import type { TablesUpdate } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

// Inline auth helper — same pattern as app/api/deliverables/[id]/resolve/route.ts
async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

function dbUpdate(admin: ReturnType<typeof createAdminClient>, rid: string, patch: Record<string, unknown>) {
  return admin.from('deliverables').update(patch as TablesUpdate<'deliverables'>).eq('id', rid)
}

// Fetches the row's id, deleted_at — the not-found/soft-deleted decision lives in the callers.
async function getDeliverableRow(admin: ReturnType<typeof createAdminClient>, id: string) {
  return (await admin.from('deliverables').select('id, deleted_at').eq('id', id).single()).data
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { display_name?: string | null }
  const admin = createAdminClient()

  const row = await getDeliverableRow(admin, id)
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })

  // empty/absent display_name => null => fall back to the auto name
  await dbUpdate(admin, id, { display_name: normalizeDisplayName(body.display_name) })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const row = await getDeliverableRow(admin, id)
  if (!row || row.deleted_at) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 })

  await dismissDeliverable({
    updateDeliverable: async (rid, patch) => { await dbUpdate(admin, rid, patch) },
    now: new Date(),
  }, { id })
  return NextResponse.json({ ok: true })
}

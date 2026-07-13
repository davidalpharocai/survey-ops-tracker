import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncReruns } from '@/lib/reruns/sheet'
import { logSystemEvent } from '@/lib/server/observability'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Analyst-only (mirrors app/api/email-review/[id]/route.ts). User-triggered
// "Sync from sheet" — distinct from the machine cron route (CRON_SECRET-gated).
async function requireAnalyst() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST() {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { count } = await syncReruns(createAdminClient())
    await logSystemEvent({ source: 'sync-reruns', status: 'ok', detail: `Manual sync by ${user.email}: ${count} row(s).` })
    return NextResponse.json({ ok: true, count })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await logSystemEvent({ source: 'sync-reruns', status: 'error', detail })
    return NextResponse.json({ error: detail }, { status: 500 })
  }
}

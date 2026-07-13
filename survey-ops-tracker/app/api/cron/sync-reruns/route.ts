import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { syncReruns } from '@/lib/reruns/sheet'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Refreshes public.rerun_snapshot from Sree's "Manual Rerun(sree)" tab — the
// source for the read-only Rerun Radar (/reruns). Machine-triggered: Vercel cron
// (Authorization: Bearer CRON_SECRET) or a manual curl (x-webhook-secret:
// WEBHOOK_SECRET). Deliberately NOT yet listed in vercel.json: enable the daily
// schedule only once the Google OAuth token is confirmed durable in prod, so a
// silent token expiry can't skew the mirror unattended. Until then it's a
// human-initiated refresh whose result is visible.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  try {
    const admin = createAdminClient()
    const { count } = await syncReruns(admin)
    await logSystemEvent({ source: 'sync-reruns', status: 'ok', detail: `Mirrored ${count} rerun row(s) from the sheet.` })
    return Response.json({ count })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await logSystemEvent({ source: 'sync-reruns', status: 'error', detail })
    return Response.json({ error: detail }, { status: 500 })
  }
}

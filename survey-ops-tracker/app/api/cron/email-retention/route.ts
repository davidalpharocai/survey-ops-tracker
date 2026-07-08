import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { loadEmailMatchData } from '@/lib/email-activity/load'
import { matchEmail } from '@/lib/email-activity/match'
import { promoteEmail } from '@/lib/email-activity/promote'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily (see vercel.json). Three jobs for the email→activity timeline:
//   1. Back-fill: a `pending_no_project` email whose project now EXISTS attaches
//      to it — but only via an explicit PR-code / survey-ID, never a fuzzy signal
//      (no blind back-fill onto a guessed project).
//   2. Expire: un-triaged review / pending queue rows older than the TTL are
//      dropped (the email still lives in Gmail; this just keeps the queue honest).
//   3. Offboard purge: soft-delete logged email rows for clients offboarded
//      (soft-deleted) beyond a grace window, so third-party content isn't kept forever.
const TTL_DAYS = 45
const OFFBOARD_GRACE_DAYS = 30

function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const now = new Date()
  const errors: string[] = []

  // 1) pending_no_project → attach on an explicit code/survey-ID match.
  let attached = 0
  const { data: pending, error: pendErr } = await supabase
    .from('email_inbox')
    .select('*')
    .eq('status', 'pending_no_project')
  if (pendErr) {
    errors.push(`pending fetch: ${pendErr.message}`)
  } else if (pending && pending.length) {
    const data = await loadEmailMatchData(supabase)
    for (const row of pending) {
      const res = matchEmail(
        { fromEmail: row.from_email, toEmails: row.to_emails ?? [], subject: row.subject ?? '', body: row.body ?? '' },
        data,
        { now, fuzzyAutoLog: false }
      )
      if (res.decision === 'auto-log' && res.projectId && (res.method === 'code' || res.method === 'survey_id')) {
        const r = await promoteEmail(supabase, row, res.projectId)
        if (r.error) errors.push(`attach ${row.id}: ${r.error.message}`)
        else attached++
      }
    }
  }

  // 2) Expire un-triaged queue rows past the TTL.
  const ttlCutoff = new Date(now.getTime() - TTL_DAYS * 86_400_000).toISOString()
  const { data: expired, error: expErr } = await supabase
    .from('email_inbox')
    .delete()
    .in('status', ['review', 'pending_no_project'])
    .lt('created_at', ttlCutoff)
    .select('id')
  if (expErr) errors.push(`expire: ${expErr.message}`)
  const expiredCount = expired?.length ?? 0

  // 3) Purge logged email rows for long-offboarded clients.
  let purged = 0
  const offCutoff = new Date(now.getTime() - OFFBOARD_GRACE_DAYS * 86_400_000).toISOString()
  const { data: goneClients } = await supabase
    .from('clients')
    .select('id')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', offCutoff)
  if (goneClients && goneClients.length) {
    const { data: projs } = await supabase
      .from('survey_projects')
      .select('id')
      .in('client_id', goneClients.map((c) => c.id))
    const projIds = (projs ?? []).map((p) => p.id)
    if (projIds.length) {
      const { data: purgedRows, error: purgeErr } = await supabase
        .from('project_activity')
        .update({ deleted_at: now.toISOString() })
        .eq('source', 'email-timeline')
        .is('deleted_at', null)
        .in('project_id', projIds)
        .select('id')
      if (purgeErr) errors.push(`purge: ${purgeErr.message}`)
      purged = purgedRows?.length ?? 0
    }
  }

  await logSystemEvent({
    source: 'email-retention',
    status: errors.length ? 'partial' : 'ok',
    detail: `attached ${attached}, expired ${expiredCount}, purged ${purged}`,
    meta: { attached, expired: expiredCount, purged, errors },
  })

  return Response.json({ attached, expired: expiredCount, purged, errors }, { status: errors.length ? 207 : 200 })
}

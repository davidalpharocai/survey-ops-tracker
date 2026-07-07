import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { sendAndLog } from '@/lib/email/send'
import { groupByUser, buildDigest, type ReminderRow } from '@/lib/email/reminderDigest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Reminders email: one message per analyst listing every reminder due today
// or earlier that hasn't been notified yet. Runs daily via Vercel Cron;
// manual trigger allowed with the webhook secret. Always returns 200 so
// Vercel Cron doesn't retry and double-send.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const today = todayEastern()

  const { data, error } = await supabase
    .from('reminders')
    .select('id, user_email, text, due_date, survey_projects(project_code, project_name)')
    .lte('due_date', today)
    .eq('done', false)
    .is('notified_at', null)

  if (error) {
    await logSystemEvent({ source: 'reminders-due', status: 'error', detail: `Query failed: ${error.message}` })
    return Response.json({ users: 0, sent: 0, failed: 0 })
  }

  const rows = (data ?? []) as unknown as ReminderRow[]
  const groups = groupByUser(rows)

  let sent = 0
  let failed = 0

  for (const [userEmail, userRows] of groups) {
    const digest = buildDigest(userEmail, userRows)
    const ok = await sendAndLog({
      to: userEmail,
      subject: digest.subject,
      html: digest.html,
      template: 'reminders_due',
      submissionId: null,
    })

    if (ok) {
      sent++
      await supabase
        .from('reminders')
        .update({ notified_at: new Date().toISOString() })
        .in('id', digest.ids)
    } else {
      failed++
      await logSystemEvent({
        source: 'reminders-due',
        status: 'error',
        detail: `Failed to send reminders digest to ${userEmail} (${digest.ids.length} reminder(s)); notified_at left null for retry.`,
      })
    }
  }

  const result = { users: groups.size, sent, failed }
  if (groups.size > 0 && failed === 0) {
    await logSystemEvent({ source: 'reminders-due', status: 'ok', detail: `Sent ${sent} reminder digest(s).` })
  }

  // Best-effort OAuth housekeeping (spec's 30-day rule), piggybacked on this daily
  // cron: expired auth codes and never-used registered clients accumulate otherwise.
  // Must never affect the reminders response — tables may not even exist pre-045.
  try {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
    await supabase.from('oauth_codes').delete().lt('expires_at', dayAgo)

    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
    const { data: staleClients } = await supabase
      .from('oauth_clients').select('id').lt('created_at', monthAgo)
    if (staleClients && staleClients.length > 0) {
      const ids = staleClients.map(c => c.id)
      const { data: used } = await supabase
        .from('oauth_tokens').select('client_id').in('client_id', ids)
      const usedIds = new Set((used ?? []).map(t => t.client_id))
      const orphans = ids.filter(id => !usedIds.has(id))
      if (orphans.length > 0) {
        await supabase.from('oauth_clients').delete().in('id', orphans)
      }
    }
  } catch {
    /* housekeeping is best-effort */
  }

  return Response.json(result)
}

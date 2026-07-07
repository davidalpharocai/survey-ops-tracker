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
  return Response.json(result)
}

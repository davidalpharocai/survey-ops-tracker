import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Morning digest: overdue, due-soon, and behind-pace projects, posted to
// Slack via an incoming-webhook URL (SLACK_WEBHOOK_URL env var).
// Runs daily via Vercel Cron; manual trigger allowed with the webhook secret.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function fmt(d: string | null): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('project_name, client, board_column, due_date, n_target, n_collected, status, phase, captain:team_members(initials)')
    .eq('status', 'Open')
    .eq('phase', 'Active')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')

  if (error) return new Response('Database error', { status: 500 })

  const today = new Date().toISOString().split('T')[0]
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString().split('T')[0]

  type Row = NonNullable<typeof projects>[number]
  const cap = (p: Row) =>
    (p.captain as { initials: string } | null)?.initials ?? '—'
  const line = (p: Row) =>
    `• *${p.project_name}* (${p.client}) — ${p.board_column}, due ${fmt(p.due_date)}, ${p.n_collected}/${p.n_target ?? '—'} collected, ${cap(p)}`

  const overdue = (projects ?? []).filter(p => p.due_date && p.due_date <= today)
  const dueSoon = (projects ?? []).filter(p => p.due_date && p.due_date > today && p.due_date <= soon)
  const behind = (projects ?? []).filter(
    p =>
      p.board_column === 'Fielding' &&
      p.n_target != null &&
      p.n_collected < p.n_target &&
      p.due_date != null &&
      p.due_date <= soon
  )

  const sections: string[] = [`☀️ *Survey Ops daily digest* — ${fmt(today)}`]
  if (overdue.length) sections.push(`🔴 *Due today or overdue (${overdue.length})*\n${overdue.map(line).join('\n')}`)
  if (dueSoon.length) sections.push(`🟠 *Due in the next 3 days (${dueSoon.length})*\n${dueSoon.map(line).join('\n')}`)
  if (behind.length) sections.push(`📉 *Fielding behind target with deadline near (${behind.length})*\n${behind.map(line).join('\n')}`)
  if (sections.length === 1) sections.push('✅ Nothing overdue, nothing due in the next 3 days. Clear skies.')
  sections.push(`<https://survey-ops-tracker.vercel.app|Open the Command Center>`)

  const text = sections.join('\n\n')

  const slackUrl = process.env.SLACK_WEBHOOK_URL
  if (!slackUrl) {
    return Response.json({ posted: false, reason: 'SLACK_WEBHOOK_URL not configured', preview: text })
  }

  // Always return 200 so Vercel Cron doesn't retry and double-post the digest;
  // a failed Slack POST is logged (and surfaced in the JSON) rather than thrown.
  try {
    const res = await fetch(slackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) console.error('daily-digest: Slack POST failed', res.status)
    return Response.json({ posted: res.ok, status: res.status })
  } catch (err) {
    console.error('daily-digest: Slack POST error', err)
    return Response.json({ posted: false, error: 'Slack post failed' })
  }
}

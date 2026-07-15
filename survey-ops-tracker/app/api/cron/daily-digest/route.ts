import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'

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

// Escape data fields before they enter the Slack `text` payload. Slack parses
// mrkdwn, so an unescaped sheet/analyst value like "<https://x|click>" renders
// as a live link. Escape the three control chars; leave our own literal markers.
function escSlack(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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
    `• *${escSlack(p.project_name)}* (${escSlack(p.client)}) — ${escSlack(p.board_column)}, due ${fmt(p.due_date)}, ${p.n_collected}/${p.n_target ?? '—'} collected, ${escSlack(cap(p))}`

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

  // Reruns (the rerun_status view: mirror + cadence layer → computed due date),
  // so slipped recurring studies surface in the digest — including ones the sheet
  // marks "Done" but a cadence says are due again. Best-effort — a hiccup never
  // blocks the project digest.
  const week = new Date(Date.now() + 7 * 86400_000).toISOString().split('T')[0]
  const { data: reruns } = await supabase
    .from('rerun_status')
    .select('client, cadence, effective_due, is_overdue, needs_definition, owner_email, synced_at')
  const list = reruns ?? []
  const rerunOverdue = list.filter(r => r.is_overdue)
  const rerunSoon = list.filter(r => !r.is_overdue && r.effective_due && r.effective_due >= today && r.effective_due <= week)
  const rerunUndefined = list.filter(r => r.needs_definition)
  const rerunLine = (r: (typeof list)[number]) =>
    `• *${escSlack(r.client || r.cadence || 'Rerun')}*${r.client && r.cadence ? ` — ${escSlack(r.cadence)}` : ''} (due ${fmt(r.effective_due)})`
  // Group by owner (named owners A-Z, unassigned last) so each person sees their
  // name and their list. Empty owner is keyed to '' (an impossible email) rather
  // than a printable sentinel, so no real owner_email can spoof the unassigned bucket.
  const byOwner = (rows: typeof list): string => {
    const map = new Map<string, typeof list>()
    for (const r of rows) {
      const key = (r.owner_email ?? '').trim() // '' = unassigned
      const l = map.get(key) ?? []
      l.push(r)
      map.set(key, l)
    }
    return [...map.entries()]
      .sort((a, b) => {
        const au = a[0] === ''
        const bu = b[0] === ''
        if (au !== bu) return au ? 1 : -1 // unassigned last
        return a[0].localeCompare(b[0])
      })
      .map(([owner, rs]) => `_${owner === '' ? '(unassigned)' : escSlack(owner)}_ (${rs.length})\n${rs.map(rerunLine).join('\n')}`)
      .join('\n')
  }
  // Mirror-staleness: if the sync froze, the whole radar is quietly out of date.
  const lastSync = list.reduce((m, r) => (r.synced_at && r.synced_at > m ? r.synced_at : m), '')
  const rerunStale = lastSync !== '' && Date.now() - new Date(lastSync).getTime() > 36 * 3600_000

  // System-health line: surface any backend job that failed in the last ~26h
  // (a window slightly over a day so a once-daily run never slips through a gap)
  // right in the digest the team already reads.
  const healthSince = new Date(Date.now() - 26 * 3600_000).toISOString()
  const { data: badEvents } = await supabase
    .from('system_events')
    .select('source, status, detail, created_at')
    .neq('status', 'ok')
    .gte('created_at', healthSince)
    .order('created_at', { ascending: false })
    .limit(8)

  const sections: string[] = [`☀️ *Survey Ops daily digest* — ${fmt(today)}`]
  if (badEvents && badEvents.length) {
    const lines = badEvents.map(e => `• \`${escSlack(e.source)}\` ${escSlack(e.status)} — ${escSlack(e.detail ?? '')}`.trim())
    sections.push(`⚠️ *Backend issues in the last day (${badEvents.length})*\n${lines.join('\n')}`)
  }
  if (overdue.length) sections.push(`🔴 *Due today or overdue (${overdue.length})*\n${overdue.map(line).join('\n')}`)
  if (dueSoon.length) sections.push(`🟠 *Due in the next 3 days (${dueSoon.length})*\n${dueSoon.map(line).join('\n')}`)
  if (behind.length) sections.push(`📉 *Fielding behind target with deadline near (${behind.length})*\n${behind.map(line).join('\n')}`)
  if (rerunOverdue.length) sections.push(`🔁 *Reruns overdue (${rerunOverdue.length})* — by owner\n${byOwner(rerunOverdue)}`)
  if (rerunSoon.length) sections.push(`🔁 *Reruns due in the next 7 days (${rerunSoon.length})* — by owner\n${byOwner(rerunSoon)}`)
  if (rerunUndefined.length) sections.push(`🔧 *Reruns needing a cadence/date (${rerunUndefined.length})* — define them on /reruns so they can be tracked.`)
  if (rerunStale) sections.push(`⚠️ *Rerun mirror looks stale* — last synced ${fmt(lastSync.slice(0, 10))}. Run a sync from /reruns.`)
  if (sections.length === 1) sections.push('✅ Nothing overdue, nothing due in the next 3 days. Clear skies.')
  sections.push(`<https://survey-ops-tracker.vercel.app|Open the Command Center>`)

  const text = sections.join('\n\n')

  const slackUrl = process.env.SLACK_WEBHOOK_URL
  if (!slackUrl) {
    await logSystemEvent({ source: 'daily-digest', status: 'error', detail: 'SLACK_WEBHOOK_URL not configured' })
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
    await logSystemEvent({
      source: 'daily-digest',
      status: res.ok ? 'ok' : 'error',
      detail: res.ok ? 'Digest posted to Slack.' : `Slack POST failed (${res.status}).`,
    })
    return Response.json({ posted: res.ok, status: res.status })
  } catch (err) {
    console.error('daily-digest: Slack POST error', err)
    await logSystemEvent({ source: 'daily-digest', status: 'error', detail: 'Slack post threw (timeout or network).' })
    return Response.json({ posted: false, error: 'Slack post failed' })
  }
}

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { buildQaReport, renderQaReportText, renderQaReportHtml, DEFAULT_QA_CONFIG, type QaDeliverable, type QaProject } from '@/lib/deliverables/qa-report'
import { sendAndLog } from '@/lib/email/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Weekly deliverables QA digest → email (QA_REPORT_EMAIL, default david@alpharoc.ai; also posts to Slack
// if SLACK_QA_WEBHOOK_URL is set). Runs Mondays via Vercel Cron; manual trigger via CRON_SECRET/WEBHOOK_SECRET.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const admin = createAdminClient()
  let html = '', text = '', subject = ''
  try {
    const now = new Date()
    const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString()
    const [{ data: deliverables }, { data: projects }, { count: authRejections7d }] = await Promise.all([
      admin
        .from('deliverables')
        .select('id, status, match_method, match_confidence, match_candidates, source, file_hash, project_id, file_name, original_file_name, forwarded_by, created_at, filed_at, deleted_at')
        .is('deleted_at', null)
        .limit(2000),
      admin
        .from('survey_projects')
        .select('id, project_code, project_name, client, deliver_date, project_type, deleted_at')
        .is('deleted_at', null)
        .limit(2000),
      // Rejected forwards (ingest 401s) in the last 7 days — the silent-outage signal.
      admin
        .from('system_events')
        .select('*', { count: 'exact', head: true })
        .eq('source', 'deliverables-ingest')
        .eq('status', 'error')
        .gte('created_at', since7d),
    ])
    const report = buildQaReport(
      { deliverables: (deliverables ?? []) as QaDeliverable[], projects: (projects ?? []) as QaProject[], authRejections7d: authRejections7d ?? 0 },
      { ...DEFAULT_QA_CONFIG, now },
    )
    html = renderQaReportHtml(report)
    text = renderQaReportText(report)
    subject = `Deliverables QA — ${report.generatedAt.slice(0, 10)}${report.clean ? ' — all clear' : ''}`
  } catch (err) {
    console.error('deliverables-qa: build failed', err)
    await logSystemEvent({ source: 'deliverables-qa', status: 'error', detail: 'Failed to build QA report.' })
    return Response.json({ ok: false, error: 'build failed' })
  }

  // Deliver. Email is the primary channel (no Slack dependency); if a Slack webhook is also set, post there
  // too. Always return 200 so Vercel Cron doesn't retry and double-send.
  const emailTo = process.env.QA_REPORT_EMAIL ?? 'david@alpharoc.ai'
  const emailed = await sendAndLog({ to: emailTo, subject, html, template: 'deliverables_qa_report', submissionId: null })

  let slackPosted = false
  const slackUrl = process.env.SLACK_QA_WEBHOOK_URL
  if (slackUrl) {
    try {
      const res = await fetch(slackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(10_000) })
      slackPosted = res.ok
      if (!res.ok) console.error('deliverables-qa: Slack POST failed', res.status)
    } catch (err) {
      console.error('deliverables-qa: Slack POST error', err)
    }
  }

  await logSystemEvent({
    source: 'deliverables-qa',
    status: emailed || slackPosted ? 'ok' : 'error',
    detail: `QA report — emailed=${emailed} (${emailTo}), slack=${slackPosted}`,
  })
  return Response.json({ emailed, slackPosted, emailTo })
}

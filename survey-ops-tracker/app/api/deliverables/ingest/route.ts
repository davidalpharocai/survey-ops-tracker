import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { safeEqual } from '@/lib/utils/secureCompare'
import { ingestEmail, type IngestDeps, type EmailDeliverableRow } from '@/lib/deliverables/email-ingest'
import Anthropic from '@anthropic-ai/sdk'
import { loadMatchData, loadFilingHistory } from '@/lib/deliverables/load'
import { aiMatch } from '@/lib/deliverables/ai-matcher'
import { findDuplicateAnywhere } from '@/lib/deliverables/persist'
import { ensureClientFolder } from '@/lib/deliverables/folders'
import { sendAndLog } from '@/lib/email/send'
import { logSystemEvent } from '@/lib/server/observability'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): { ok: boolean; provided: boolean } {
  const header = req.headers.get('x-webhook-secret') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return { ok: safeEqual(header, process.env.WEBHOOK_SECRET), provided: !!header }
}

export async function POST(req: Request) {
  const auth = authorized(req)
  if (!auth.ok) {
    // A caller that SENT a secret but was rejected is a misconfigured legitimate client — almost always
    // the Gmail Apps Script forwarder running a stale WEBHOOK_SECRET. Log it so a silent forwarding
    // outage surfaces (daily digest + weekly QA report) instead of failing invisibly. Bare scans with no
    // secret header are ignored so we don't create noise.
    if (auth.provided) {
      await logSystemEvent({ source: 'deliverables-ingest', status: 'error', detail: 'Rejected a forward: wrong/stale WEBHOOK_SECRET (401). The email forwarder cannot post — re-sync the Apps Script secret with Vercel.' })
    }
    return new Response('Unauthorized', { status: 401 })
  }
  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID
  if (!sharedDriveId) return NextResponse.json({ error: 'Deliverables drive not configured' }, { status: 500 })

  let payload: { from?: string; messageId?: string } & Record<string, unknown>
  try { payload = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }
  if (!payload?.from || !payload?.messageId) return new Response('from and messageId required', { status: 400 })

  const admin = createAdminClient()
  const drive = new GoogleDrive()
  const anthropic = new Anthropic()
  const matchData = await loadMatchData(admin)
  const filingHistory = await loadFilingHistory(admin, matchData.clients, matchData.projects)

  const deps: IngestDeps = {
    drive,
    sharedDriveId,
    matchData,
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin,
    now: new Date(),
    isProcessed: async (mid) => {
      const { data } = await admin.from('deliverables').select('id').eq('gmail_message_id', mid).limit(1)
      return (data?.length ?? 0) > 0
    },
    clientFolderId: (clientId) => ensureClientFolder(admin, drive, sharedDriveId, clientId),
    findDup: (opts) => findDuplicateAnywhere(admin, opts),
    aiMatch: (input) => aiMatch(input, anthropic),
    filingHistory,
    persist: async (row: EmailDeliverableRow) => {
      // Boundary cast: row is structurally the deliverables Insert; only match_candidates (LabeledCandidate[]) needs widening to Json.
      const { data: inserted, error } = await admin
        .from('deliverables')
        .insert(row as unknown as Database['public']['Tables']['deliverables']['Insert'])
        .select('id').single()
      if (error) { console.error('[deliverables/ingest] insert failed', { drive_file_id: row.drive_file_id, error }); return }
      if (row.project_id) {
        await admin.from('project_activity').insert({
          project_id: row.project_id, type: 'deliverable', direction: 'outbound',
          subject: row.file_name, snippet: `Filed deliverable (email): ${row.file_name}`,
          source: 'deliverables', external_id: `deliverable:${inserted!.id}`,
          occurred_at: new Date().toISOString(),
        })
      }
    },
    reply: async (to, subject, html) => {
      await sendAndLog({ to, subject, html, template: 'deliverable_email_receipt', submissionId: null })
    },
  }

  const outcome = await ingestEmail(payload as Parameters<typeof ingestEmail>[0], deps)

  /* WHAT THE FORWARDER COULD NOT SEND. Vercel rejects a request body over
     4.5 MB, so the Apps Script now spends a 3 MB budget across a message's
     attachments smallest-first and reports the rest here rather than posting a
     body that 413s — which is what a 9.2 MB Bain forward did every two hours on
     2026-09-09, filing nothing at all.
     A skipped file is a MISSING DELIVERABLE, so it is logged where the daily
     digest and the weekly QA report will show it. Filing three of four
     attachments silently would be worse than the 413 was: at least a 413 was
     noisy. */
  const skipped = Array.isArray((payload as { skippedAttachments?: unknown }).skippedAttachments)
    ? ((payload as { skippedAttachments: { filename?: string; bytes?: number }[] }).skippedAttachments)
    : []
  if (skipped.length) {
    const mb = (n: number) => (n / 1_048_576).toFixed(1) + ' MB'
    await logSystemEvent({
      // NOT 'deliverables-ingest'. app/api/cron/deliverables-qa counts
      // source='deliverables-ingest' AND status='error' as authRejections7d —
      // "rejected forwards (ingest 401s), the silent-outage signal" — and
      // qa-report gates pipelineHealth.healthy on that count being zero. Logging
      // an oversized attachment under the same pair made a routine too-big file
      // indistinguishable from the forwarder losing its secret, and pinned the
      // weekly report to unhealthy for a week. A skipped attachment is a
      // completeness problem, not an auth outage; it gets its own source so each
      // alarm keeps meaning one thing.
      source: 'deliverables-skipped-attachment',
      status: 'error',
      detail:
        `"${String(payload.subject ?? '(no subject)')}" from ${String(payload.from)} was filed WITHOUT ` +
        `${skipped.length} attachment${skipped.length === 1 ? '' : 's'} too large to forward: ` +
        skipped.map(a => `${a.filename ?? 'unnamed'} (${mb(Number(a.bytes ?? 0))})`).join(', ') +
        `. Vercel caps a request body at 4.5 MB. Retrieve these from the original email and upload them by hand.`,
    })
  }

  return NextResponse.json({ ok: true, ...outcome, skippedAttachments: skipped.length })
}

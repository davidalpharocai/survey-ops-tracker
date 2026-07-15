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
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: Request): boolean {
  const header = req.headers.get('x-webhook-secret') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return safeEqual(header, process.env.WEBHOOK_SECRET)
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
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
  return NextResponse.json({ ok: true, ...outcome })
}

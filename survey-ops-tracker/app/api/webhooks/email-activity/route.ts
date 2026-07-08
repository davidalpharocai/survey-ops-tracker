import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { extractMessageId, parseParticipants, parseForwardedHeaders, stripQuotedHistory } from '@/lib/email-activity/parse'
import { loadEmailMatchData } from '@/lib/email-activity/load'
import { matchEmail } from '@/lib/email-activity/match'
import { promoteEmail } from '@/lib/email-activity/promote'
import type { Json } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

// This endpoint's own storage caps. The promote path stores the FULL body
// un-clipped (see promote.ts) — only the email_inbox review-queue copy is capped
// here so an abusive payload can't bloat rows or the assistant's prompt context.
const MAX_BODY = 100_000
const MAX_FIELD = 1_000
const MAX_SNIPPET = 200

function authorized(req: NextRequest): boolean {
  const header =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return safeEqual(header, process.env.WEBHOOK_SECRET)
}

const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

// POST: capture one inbound (or CC'd outbound) client email, route it precision-first.
// Body: { raw_headers, from, to, subject, body, occurred_at, gmail_message_id }
//   - auto-log            → promote into project_activity (no queue row)
//   - review              → land in email_inbox for triage
//   - pending_no_project  → land in email_inbox (explicit code but project absent)
// Dedup key is external_id ('email:<RFC-822 Message-ID>', with a stable fallback
// when the Message-ID header didn't survive transport). Duplicates never 500 —
// they no-op to { ok, deduplicated }. This route stays AGNOSTIC to the matcher's
// tiering: it acts only on result.decision.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const rawHeaders = asString(b.raw_headers)
  const fromHeader = asString(b.from)
  const toHeader = asString(b.to)
  const subject = clip(b.subject, MAX_FIELD)
  const bodyText = clip(b.body, MAX_BODY)
  const gmailMessageId = clip(b.gmail_message_id, MAX_FIELD)
  const occurredAt =
    typeof b.occurred_at === 'string' ? b.occurred_at : new Date().toISOString()

  // external_id = 'email:' + RFC-822 Message-ID (shared across CC'd copies, the
  // dedup key). If the header didn't survive transport we do NOT drop the mail —
  // it still gets stored (as review) under a stable per-mailbox fallback id.
  const messageId = extractMessageId(rawHeaders)
  const externalId = messageId
    ? `email:${messageId}`
    : `email-noid:${gmailMessageId ?? 'unknown'}`

  const supabase = createAdminClient()

  // Early dedup: if this external_id already exists in either pipeline table,
  // no-op. (The unique index is the real guarantee — 23505 below is also success.)
  const [inboxDup, activityDup] = await Promise.all([
    supabase.from('email_inbox').select('id').eq('external_id', externalId).limit(1),
    supabase.from('project_activity').select('id').eq('external_id', externalId).limit(1),
  ])
  if ((inboxDup.data?.length ?? 0) > 0 || (activityDup.data?.length ?? 0) > 0) {
    return Response.json({ ok: true, deduplicated: true })
  }

  const { from_email, to_emails } = parseParticipants(fromHeader, toHeader)

  // Manual "Fwd:" recovery: a teammate forwarding a client email arrives with the
  // forwarder as From and activity@ as To — the real client is buried in the body.
  // When an INTERNAL sender forwards something that looks forwarded, recover the
  // original From/To so it matches (and displays) like the client email it is. The
  // internal+looks-forwarded gate keeps a normal outbound email (analyst → client,
  // cc activity@) using its real recipients.
  let effFrom = from_email
  let effTo = to_emails
  const INTERNAL_RE = /@(?:alpharoc\.ai|alpharoc\.com)$/i
  const looksForwarded =
    /^\s*(?:fwd?|fw):/i.test(subject ?? '') || /forwarded message|original message/i.test(bodyText ?? '')
  if (from_email && INTERNAL_RE.test(from_email) && looksForwarded) {
    const fwd = parseForwardedHeaders(bodyText ?? '')
    if (fwd?.from_email) {
      effFrom = fwd.from_email
      if (fwd.to_emails.length) effTo = fwd.to_emails
    }
  }

  const data = await loadEmailMatchData(supabase)
  const result = matchEmail(
    {
      fromEmail: effFrom,
      toEmails: effTo,
      subject: subject ?? '',
      body: bodyText ?? '',
    },
    data,
    { fuzzyAutoLog: false, now: new Date() }
  )

  const snippet = bodyText
    ? stripQuotedHistory(bodyText).replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET)
    : null

  // ---- auto-log: promote straight into the project timeline (no queue row) ----
  if (result.decision === 'auto-log' && result.projectId) {
    const r = await promoteEmail(
      supabase,
      {
        external_id: externalId,
        direction: result.direction,
        from_email: effFrom,
        to_emails: effTo,
        subject,
        snippet,
        body: bodyText, // promote stores it un-clipped; this is our capped copy
        occurred_at: occurredAt,
      },
      result.projectId
    )
    // promote swallows 23505 internally (returns deduplicated, error=null); any
    // remaining error is a hard failure.
    if (r.error) {
      console.error('email-activity promote error:', r.error)
      return new Response('Promote failed', { status: 500 })
    }
    return Response.json({
      ok: true,
      decision: 'auto-log',
      projectId: result.projectId,
      deduplicated: r.deduplicated,
    })
  }

  // ---- review / pending_no_project (+ any degenerate auto-log w/o project) ----
  const status = result.decision === 'pending_no_project' ? 'pending_no_project' : 'review'
  const { error } = await supabase.from('email_inbox').insert({
    external_id: externalId,
    status,
    direction: result.direction,
    from_email: effFrom,
    to_emails: effTo,
    subject,
    snippet,
    body: bodyText,
    occurred_at: occurredAt,
    gmail_message_id: gmailMessageId,
    source: 'email-timeline',
    // Boundary cast: candidates are a structurally-JSON object array; only the
    // widening to the column's Json type is needed (matches writes.ts convention).
    match_candidates: result.candidates as unknown as Json,
    matched_confidence: result.confidence,
    client_id: result.clientId,
    project_id: result.projectId,
  })

  if (error) {
    // Concurrent CC'd forward racing the same external_id — treat as success.
    if (error.code === '23505') {
      return Response.json({ ok: true, deduplicated: true })
    }
    console.error('email_inbox insert error:', error)
    return new Response('Insert failed', { status: 500 })
  }

  return Response.json({ ok: true, decision: status })
}

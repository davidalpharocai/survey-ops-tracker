import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'

export const dynamic = 'force-dynamic'

// Cap stored text so a runaway/abusive payload can't bloat rows or the
// assistant's prompt context downstream.
const MAX_BODY = 20_000
const MAX_FIELD = 1_000

function authorized(req: NextRequest): boolean {
  const header =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return safeEqual(header, process.env.WEBHOOK_SECRET)
}

const clip = (v: unknown, max: number): string | null =>
  typeof v === 'string' ? v.slice(0, max) : null

// POST: log an activity entry (email etc.) against a project.
// Body: { project_id, type?, direction?, sender?, recipients?, subject?,
//         body?, occurred_at?, external_id? }
// Snippet is derived server-side. Duplicate external_ids are ignored (200).
export async function POST(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  let b: Record<string, unknown>
  try {
    b = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!b.project_id) return new Response('project_id required', { status: 400 })

  const bodyText = clip(b.body, MAX_BODY)
  const snippet = bodyText
    ? bodyText.replace(/\s+/g, ' ').trim().slice(0, 200)
    : null

  const supabase = createAdminClient()
  const { error } = await supabase.from('project_activity').insert({
    project_id: String(b.project_id),
    type: clip(b.type, MAX_FIELD) ?? 'email',
    direction: clip(b.direction, MAX_FIELD),
    sender: clip(b.sender, MAX_FIELD),
    recipients: clip(b.recipients, MAX_FIELD),
    subject: clip(b.subject, MAX_FIELD),
    snippet,
    body: bodyText,
    occurred_at:
      typeof b.occurred_at === 'string' ? b.occurred_at : new Date().toISOString(),
    source: typeof b.source === 'string' ? b.source : 'make.com',
    external_id: typeof b.external_id === 'string' ? b.external_id : null,
  })

  if (error) {
    // unique violation on external_id = already logged; treat as success
    if (error.code === '23505') {
      return Response.json({ ok: true, deduplicated: true })
    }
    if (error.code === '23503') {
      return new Response('Project not found', { status: 404 })
    }
    console.error('activity insert error:', error)
    return new Response('Insert failed', { status: 500 })
  }
  return Response.json({ ok: true })
}

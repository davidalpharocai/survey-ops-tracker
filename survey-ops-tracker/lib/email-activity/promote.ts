// lib/email-activity/promote.ts
// Crash-safe promotion of a captured email into a project's activity timeline.
//
// Two steps, each idempotent:
//   1. Insert a `project_activity` row (type='email', source='email-timeline',
//      external_id='email:<Message-ID>', FULL body — no 20k clip). First checks
//      for an existing row with the same Message-ID (cross-pipeline dedup); a
//      23505 on the insert itself (concurrent CC'd forward) is treated the same
//      way — already promoted.
//   2. Flip the originating `email_inbox` row to `filed` (skipped for the direct
//      auto-log path, which has no queue row).
//
// A row that is already promoted still flips the queue row to `filed`, so a
// retried/duplicate call converges instead of leaving a stuck `review` item.

import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

/** The subset of an email_inbox row promote needs. `id` is absent on the direct
 *  auto-log path (nothing to flip to `filed`). */
export type PromotableEmail = {
  id?: string | null
  external_id: string
  direction?: string | null
  from_email?: string | null
  to_emails?: string[] | null
  subject?: string | null
  snippet?: string | null
  body?: string | null
  occurred_at?: string | null
}

export type PromoteResult = {
  /** A new project_activity row was inserted. */
  promoted: boolean
  /** The email_inbox row was set to `filed` (false when there was no queue row). */
  filed: boolean
  /** The email was already logged (pre-existing row or a 23505 race). */
  deduplicated: boolean
  error: { code?: string; message?: string } | null
}

export async function promoteEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: PromotableEmail,
  projectId: string
): Promise<PromoteResult> {
  const extId = email.external_id

  // Cross-pipeline / idempotency dedup on the Message-ID-derived external_id.
  const { data: existing } = await admin
    .from('project_activity')
    .select('id')
    .eq('external_id', extId)
    .limit(1)

  let promoted = false
  let deduplicated = (existing?.length ?? 0) > 0

  if (!deduplicated) {
    const { error } = await admin.from('project_activity').insert({
      project_id: projectId,
      type: 'email',
      direction: email.direction ?? null,
      sender: email.from_email ?? null,
      recipients: email.to_emails && email.to_emails.length ? email.to_emails.join(', ') : null,
      subject: email.subject ?? null,
      snippet: email.snippet ?? null,
      body: email.body ?? null, // full body — the timeline stores it un-clipped
      occurred_at: email.occurred_at ?? new Date().toISOString(),
      source: 'email-timeline',
      external_id: extId,
    })
    if (error) {
      if (error.code === '23505') {
        deduplicated = true // already promoted (concurrent forward) — still file below
      } else {
        return { promoted: false, filed: false, deduplicated: false, error }
      }
    } else {
      promoted = true
    }
  }

  // Flip the queue row to filed (idempotent). Skipped on the auto-log path.
  if (email.id) {
    const { error: upErr } = await admin
      .from('email_inbox')
      .update({ status: 'filed', project_id: projectId })
      .eq('id', email.id)
    if (upErr) return { promoted, filed: false, deduplicated, error: upErr }
    return { promoted, filed: true, deduplicated, error: null }
  }

  return { promoted, filed: false, deduplicated, error: null }
}

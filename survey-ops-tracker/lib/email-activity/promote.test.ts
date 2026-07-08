import { describe, it, expect } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { promoteEmail, type PromotableEmail } from './promote'

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/**
 * Minimal chainable admin stub covering promote's call pattern:
 *   from('project_activity').select('id').eq(..).limit(1)      → { data }
 *   from('project_activity').insert(payload)                    → { error }
 *   from('email_inbox').update(payload).eq('id', ..)            → { error }
 */
function makeAdmin(opts: {
  existing?: { id: string }[]
  insertError?: { code?: string; message?: string } | null
  updateError?: { code?: string; message?: string } | null
}) {
  const calls = {
    activityInserts: [] as Record<string, unknown>[],
    emailUpdates: [] as Record<string, unknown>[],
  }
  const thenable = (result: Result) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit', 'is', 'order', 'neq'] as const) b[m] = () => b
    b.then = (resolve: (v: Result) => void) => resolve(result)
    return b
  }
  const admin = {
    from(table: string) {
      return {
        select: () => thenable({ data: opts.existing ?? [], error: null }),
        insert: (payload: Record<string, unknown>) => {
          if (table === 'project_activity') calls.activityInserts.push(payload)
          return thenable({ error: opts.insertError ?? null })
        },
        update: (payload: Record<string, unknown>) => {
          if (table === 'email_inbox') calls.emailUpdates.push(payload)
          return thenable({ error: opts.updateError ?? null })
        },
      }
    },
  }
  return { admin: admin as unknown as ReturnType<typeof createAdminClient>, calls }
}

const emailRow = (o: Partial<PromotableEmail> = {}): PromotableEmail => ({
  id: 'e1',
  external_id: 'email:<mid@x>',
  direction: 'inbound',
  from_email: 'jane@acme.com',
  to_emails: ['ops@alpharoc.ai', 'x@y.com'],
  subject: 'Hi',
  snippet: 'hi there',
  body: 'body text',
  occurred_at: '2026-07-07T00:00:00Z',
  ...o,
})

describe('promoteEmail', () => {
  it('inserts a project_activity row (type=email, source=email-timeline, FULL body) and files the queue row', async () => {
    const { admin, calls } = makeAdmin({ existing: [] })
    const bigBody = 'B'.repeat(50_000)
    const r = await promoteEmail(admin, emailRow({ body: bigBody }), 'p1')

    expect(r.promoted).toBe(true)
    expect(r.filed).toBe(true)
    expect(r.deduplicated).toBe(false)
    expect(r.error).toBeNull()

    const ins = calls.activityInserts[0]
    expect(ins.type).toBe('email')
    expect(ins.source).toBe('email-timeline')
    expect(ins.external_id).toBe('email:<mid@x>')
    expect(ins.project_id).toBe('p1')
    expect(ins.sender).toBe('jane@acme.com')
    expect(ins.recipients).toBe('ops@alpharoc.ai, x@y.com')
    expect(String(ins.body).length).toBe(50_000) // no 20k clip
    expect(calls.emailUpdates[0].status).toBe('filed')
    expect(calls.emailUpdates[0].project_id).toBe('p1')
  })

  it('cross-pipeline dedup: skips the insert when a row already exists for the Message-ID, still files', async () => {
    const { admin, calls } = makeAdmin({ existing: [{ id: 'existing-1' }] })
    const r = await promoteEmail(admin, emailRow(), 'p1')

    expect(r.promoted).toBe(false)
    expect(r.deduplicated).toBe(true)
    expect(r.filed).toBe(true)
    expect(calls.activityInserts.length).toBe(0)
    expect(calls.emailUpdates[0].status).toBe('filed')
  })

  it('treats a 23505 on the activity insert as already-promoted and still files', async () => {
    const { admin, calls } = makeAdmin({ existing: [], insertError: { code: '23505', message: 'dup' } })
    const r = await promoteEmail(admin, emailRow(), 'p1')

    expect(r.promoted).toBe(false)
    expect(r.deduplicated).toBe(true)
    expect(r.filed).toBe(true)
    expect(calls.activityInserts.length).toBe(1)
    expect(calls.emailUpdates.length).toBe(1)
  })

  it('surfaces a hard insert error and does NOT file the queue row', async () => {
    const { admin, calls } = makeAdmin({ existing: [], insertError: { code: '23503', message: 'fk violation' } })
    const r = await promoteEmail(admin, emailRow(), 'missing-project')

    expect(r.promoted).toBe(false)
    expect(r.filed).toBe(false)
    expect(r.error?.code).toBe('23503')
    expect(calls.emailUpdates.length).toBe(0)
  })

  it('auto-log path (no queue-row id): inserts activity, skips the email_inbox update', async () => {
    const { admin, calls } = makeAdmin({ existing: [] })
    const r = await promoteEmail(admin, emailRow({ id: null, external_id: 'email:<mid2@x>' }), 'p9')

    expect(r.promoted).toBe(true)
    expect(r.filed).toBe(false)
    expect(calls.activityInserts.length).toBe(1)
    expect(calls.emailUpdates.length).toBe(0)
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { EmailMatchResult } from '@/lib/email-activity/match'

// --- Mocks (parse.ts is intentionally REAL so external_id / participant / snippet
//     derivation is exercised end-to-end). --------------------------------------
const { loadMock, matchMock, promoteMock, adminRef } = vi.hoisted(() => ({
  loadMock: vi.fn(),
  matchMock: vi.fn(),
  promoteMock: vi.fn(),
  adminRef: { current: undefined as unknown },
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminRef.current }))
vi.mock('@/lib/email-activity/load', () => ({ loadEmailMatchData: loadMock }))
vi.mock('@/lib/email-activity/match', () => ({ matchEmail: matchMock }))
vi.mock('@/lib/email-activity/promote', () => ({ promoteEmail: promoteMock }))

import { POST } from './route'

const SECRET = 'test-webhook-secret'
process.env.WEBHOOK_SECRET = SECRET

type Result = { data?: unknown; error?: { code?: string; message?: string } | null }

/**
 * Minimal chainable admin stub covering the route's call pattern:
 *   from('email_inbox').select('id').eq(..).limit(1)      → dedup (inbox)
 *   from('project_activity').select('id').eq(..).limit(1) → dedup (activity)
 *   from('email_inbox').insert(payload)                   → { error }
 */
function makeAdmin(opts: {
  inboxDup?: { id: string }[]
  activityDup?: { id: string }[]
  insertError?: { code?: string; message?: string } | null
}) {
  const calls = { inboxInserts: [] as Record<string, unknown>[] }
  const thenable = (result: Result) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'limit', 'is', 'order', 'neq'] as const) b[m] = () => b
    b.then = (resolve: (v: Result) => void) => resolve(result)
    return b
  }
  const admin = {
    from(table: string) {
      return {
        select: () =>
          thenable({
            data: table === 'email_inbox' ? (opts.inboxDup ?? []) : (opts.activityDup ?? []),
            error: null,
          }),
        insert: (payload: Record<string, unknown>) => {
          if (table === 'email_inbox') calls.inboxInserts.push(payload)
          return thenable({ error: opts.insertError ?? null })
        },
      }
    },
  }
  return { admin: admin as unknown as ReturnType<typeof createAdminClient>, calls }
}

function makeReq(
  body: unknown,
  headers: Record<string, string> = { 'x-webhook-secret': SECRET }
): NextRequest {
  return {
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as NextRequest
}

const RAW_HEADERS = 'From: Jane <jane@acme.com>\r\nMessage-ID: <abc123@mail.acme.com>\r\nSubject: Hi\r\n'

const payload = (o: Partial<Record<string, unknown>> = {}) => ({
  raw_headers: RAW_HEADERS,
  from: 'Jane <jane@acme.com>',
  to: 'ops@alpharoc.ai',
  subject: 'Topline results',
  body: 'Here is the update.\n\nOn Mon wrote:\n> old quoted stuff',
  occurred_at: '2026-07-07T00:00:00Z',
  gmail_message_id: 'gmail-xyz',
  ...o,
})

function matchResult(o: Partial<EmailMatchResult> = {}): EmailMatchResult {
  return {
    decision: o.decision ?? 'review',
    projectId: o.projectId ?? null,
    clientId: o.clientId ?? null,
    confidence: o.confidence ?? 0,
    direction: o.direction ?? 'inbound',
    method: o.method ?? 'none',
    candidates: o.candidates ?? [],
  }
}

beforeEach(() => {
  loadMock.mockReset().mockResolvedValue({ projects: [], contacts: [], surveyIdMap: new Map() })
  matchMock.mockReset()
  promoteMock.mockReset()
})

describe('POST /api/webhooks/email-activity — auth', () => {
  it('401s without a valid webhook secret', async () => {
    const { admin } = makeAdmin({})
    adminRef.current = admin
    const res = await POST(makeReq(payload(), {}))
    expect(res.status).toBe(401)
    expect(matchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/email-activity — routing', () => {
  it('auto-log → promotes into project_activity, no queue row', async () => {
    const { admin, calls } = makeAdmin({})
    adminRef.current = admin
    matchMock.mockReturnValue(
      matchResult({ decision: 'auto-log', projectId: 'p1', clientId: 'c1', confidence: 0.99, method: 'code' })
    )
    promoteMock.mockResolvedValue({ promoted: true, filed: false, deduplicated: false, error: null })

    const res = await POST(makeReq(payload()))
    const json = await res.json()

    expect(json).toEqual({ ok: true, decision: 'auto-log', projectId: 'p1', deduplicated: false })
    expect(promoteMock).toHaveBeenCalledTimes(1)
    expect(promoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        external_id: 'email:abc123@mail.acme.com',
        direction: 'inbound',
        from_email: 'jane@acme.com',
        subject: 'Topline results',
      }),
      'p1'
    )
    // snippet is quoted-history-stripped
    expect(promoteMock.mock.calls[0][1].snippet).toBe('Here is the update.')
    expect(calls.inboxInserts.length).toBe(0)
  })

  it('review → inserts an email_inbox row (status=review) with candidates, no promote', async () => {
    const { admin, calls } = makeAdmin({})
    adminRef.current = admin
    const candidates = [
      { clientId: 'c1', projectId: 'p1', confidence: 0.9, reason: 'contact_email', method: 'contact_email' as const },
    ]
    matchMock.mockReturnValue(
      matchResult({ decision: 'review', clientId: 'c1', confidence: 0.9, method: 'contact_email', candidates })
    )

    const res = await POST(makeReq(payload()))
    const json = await res.json()

    expect(json).toEqual({ ok: true, decision: 'review' })
    expect(promoteMock).not.toHaveBeenCalled()
    expect(calls.inboxInserts.length).toBe(1)
    const row = calls.inboxInserts[0]
    expect(row.status).toBe('review')
    expect(row.external_id).toBe('email:abc123@mail.acme.com')
    expect(row.from_email).toBe('jane@acme.com')
    expect(row.to_emails).toEqual(['ops@alpharoc.ai'])
    expect(row.client_id).toBe('c1')
    expect(row.matched_confidence).toBe(0.9)
    expect(row.match_candidates).toEqual(candidates)
    expect(row.source).toBe('email-timeline')
    expect(row.snippet).toBe('Here is the update.')
  })

  it('pending_no_project → inserts an email_inbox row with status=pending_no_project', async () => {
    const { admin, calls } = makeAdmin({})
    adminRef.current = admin
    matchMock.mockReturnValue(matchResult({ decision: 'pending_no_project', method: 'code' }))

    const res = await POST(makeReq(payload()))
    const json = await res.json()

    expect(json).toEqual({ ok: true, decision: 'pending_no_project' })
    expect(calls.inboxInserts[0].status).toBe('pending_no_project')
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it('duplicate external_id (early check) → no-op, does not match/promote/insert', async () => {
    const { admin, calls } = makeAdmin({ inboxDup: [{ id: 'seen-1' }] })
    adminRef.current = admin

    const res = await POST(makeReq(payload()))
    const json = await res.json()

    expect(json).toEqual({ ok: true, deduplicated: true })
    expect(matchMock).not.toHaveBeenCalled()
    expect(promoteMock).not.toHaveBeenCalled()
    expect(calls.inboxInserts.length).toBe(0)
  })

  it('duplicate seen in project_activity (cross-pipeline) → no-op', async () => {
    const { admin } = makeAdmin({ activityDup: [{ id: 'act-1' }] })
    adminRef.current = admin

    const res = await POST(makeReq(payload()))
    expect(await res.json()).toEqual({ ok: true, deduplicated: true })
    expect(matchMock).not.toHaveBeenCalled()
  })

  it('23505 on the email_inbox insert → success no-op (never 500)', async () => {
    const { admin } = makeAdmin({ insertError: { code: '23505', message: 'dup' } })
    adminRef.current = admin
    matchMock.mockReturnValue(matchResult({ decision: 'review' }))

    const res = await POST(makeReq(payload()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deduplicated: true })
  })

  it('missing Message-ID → still stored (review) under a stable fallback external_id', async () => {
    const { admin, calls } = makeAdmin({})
    adminRef.current = admin
    matchMock.mockReturnValue(matchResult({ decision: 'review' }))

    const res = await POST(
      makeReq(payload({ raw_headers: 'From: x@y.com\r\nSubject: no id\r\n', gmail_message_id: 'g-777' }))
    )
    expect(res.status).toBe(200)
    expect(calls.inboxInserts[0].external_id).toBe('email-noid:g-777')
  })
})

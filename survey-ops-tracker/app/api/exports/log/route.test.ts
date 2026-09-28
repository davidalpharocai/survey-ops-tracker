import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The export audit route. For weeks it was never deployed and every export
 * answered 404 without anyone noticing, because the browser never read the
 * answer. So what must be proved here is that the answer now MEANS something:
 * the inserted row's id when the row was written, and a 500 when it was not,
 * and that the parts the browser is not trusted with (who ran it, and
 * "no restricted columns") are decided on the server.
 */

const { getUserMock, canViewMock, insertMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  canViewMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}))
vi.mock('@/lib/auth/capabilities', () => ({ canViewFinancials: canViewMock }))
// The service-role client, down to the one chain the log writer uses:
// insert(row).select('id').single().
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: unknown) => ({ select: () => ({ single: async () => insertMock(row) }) }),
    }),
  }),
}))

import { POST } from './route'

const req = (body: unknown) => new Request('http://socc.test/api/exports/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'shanu@alpharoc.ai' } } })
  canViewMock.mockReset().mockResolvedValue(false)
  insertMock.mockReset().mockReturnValue({ data: { id: 'row-1' }, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/exports/log', () => {
  it('refuses a caller with no session, and writes nothing', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST(req({ route: 'finance-results', rowCount: 3 }))
    expect(res.status).toBe(401)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('answers with the inserted row id, so the page can say "Logged as export #…"', async () => {
    const res = await POST(req({ route: 'finance-results', rowCount: 6, filters: { tab: 'results', scoping_included: false }, includedRestricted: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, id: 'row-1' })
    const row = insertMock.mock.calls[0][0]
    expect(row).toMatchObject({ route: 'finance-results', row_count: 6, included_restricted: true })
    // "false" is recorded, not dropped: "scoping not included" is the fact.
    expect(row.filters).toEqual({ tab: 'results', scoping_included: false })
  })

  it('answers 500 when the insert fails, in plain words and without the database message', async () => {
    insertMock.mockReturnValue({ data: null, error: { message: 'relation "data_exports" violates row-level security' } })
    const res = await POST(req({ route: 'finance-results', rowCount: 6 }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'the audit row could not be written' })
    expect(JSON.stringify(body)).not.toContain('row-level')
  })

  it('answers 500 when the write succeeds but no id comes back', async () => {
    insertMock.mockReturnValue({ data: null, error: null })
    expect((await POST(req({ route: 'x', rowCount: 1 }))).status).toBe(500)
  })

  it('answers 500, not a crash, when the admin client throws', async () => {
    insertMock.mockImplementation(() => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set') })
    expect((await POST(req({ route: 'x', rowCount: 1 }))).status).toBe(500)
  })

  it('takes the actor from the session and ignores the body', async () => {
    await POST(req({ route: 'x', rowCount: 1, actorEmail: 'someone-else@alpharoc.ai', actor_email: 'someone-else@alpharoc.ai' }))
    expect(insertMock.mock.calls[0][0].actor_email).toBe('shanu@alpharoc.ai')
  })

  it('only ever revises "restricted" upwards: a finance holder claiming false is recorded as true', async () => {
    canViewMock.mockResolvedValue(true)
    await POST(req({ route: 'x', rowCount: 1, includedRestricted: false }))
    expect(insertMock.mock.calls[0][0].included_restricted).toBe(true)
  })

  it('treats a body that is not a JSON object as empty instead of failing on it', async () => {
    for (const body of ['null', '[1,2]', '7', 'not json']) {
      insertMock.mockClear()
      const res = await POST(req(body))
      expect(res.status).toBe(200)
      expect(insertMock.mock.calls[0][0]).toMatchObject({ route: 'unknown-csv', row_count: 0 })
    }
  })
})

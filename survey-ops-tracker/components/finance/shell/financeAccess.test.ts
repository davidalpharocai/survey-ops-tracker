import { beforeEach, describe, it, expect, vi } from 'vitest'

/**
 * The gate's READ, one level below layoutGate.test.tsx.
 *
 * `canViewFinancials()` collapses four different situations into one `false`:
 * the tables 404 while a migration is pending, RLS refused, the network
 * dropped, and this person really is not in finance. That is the right answer
 * for a gate — money stays hidden in all four — but /finance then TELLS the
 * reader "Finance is limited to the finance team: David, Shanu and Vineet",
 * which is a fact about them and is not true of the first three. `financeAccess`
 * exists to keep those apart. Lives here because /finance is the one gate that
 * asks it; the read itself is lib/auth/capabilities.ts.
 */

const getUser = vi.fn()
const from = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from }),
}))

const { financeAccess, canViewFinancials } = await import('@/lib/auth/capabilities')

/** One query's answer, as PostgREST returns it: data or error, never both. */
const answers = (rows: {
  profile_capabilities?: unknown[] | Error
  profile_roles?: unknown[] | Error
  role_permissions?: unknown[] | Error
}) => {
  from.mockImplementation((table: string) => {
    const r = rows[table as keyof typeof rows]
    const result = r instanceof Error ? { data: null, error: { message: r.message } } : { data: r ?? [], error: null }
    // .select(...).eq(...) and .select(...) both resolve to the same answer.
    const thenable = { ...result, eq: () => Promise.resolve(result), then: (f: (v: unknown) => unknown) => Promise.resolve(f(result)) }
    return { select: () => thenable }
  })
}

beforeEach(() => {
  getUser.mockReset()
  from.mockReset()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})

describe('financeAccess', () => {
  it('says yes on a direct grant, and yes on a role that bundles it', async () => {
    answers({ profile_capabilities: [{ capability: 'view_financials' }] })
    expect(await financeAccess()).toBe('yes')

    answers({
      profile_roles: [{ role: 'finance' }],
      role_permissions: [{ role: 'finance', permission: 'view_financials' }],
    })
    expect(await financeAccess()).toBe('yes')
  })

  it('says a definite no only when every read answered', async () => {
    answers({
      profile_capabilities: [{ capability: 'export_data' }],
      profile_roles: [],
      role_permissions: [{ role: 'finance', permission: 'view_financials' }],
    })
    expect(await financeAccess()).toBe('no')
    expect(await canViewFinancials()).toBe(false)
  })

  it('says unknown when any query that could hold the answer did not come back', async () => {
    // The direct grant lives in the query that failed.
    answers({ profile_capabilities: new Error('permission denied'), profile_roles: [], role_permissions: [] })
    expect(await financeAccess()).toBe('unknown')
    // The role path is the one that failed (a pending migration 404s here).
    answers({ profile_capabilities: [], profile_roles: new Error('relation does not exist'), role_permissions: [] })
    expect(await financeAccess()).toBe('unknown')
    answers({ profile_capabilities: [], profile_roles: [], role_permissions: new Error('timeout') })
    expect(await financeAccess()).toBe('unknown')
    // The gate itself is unchanged by any of it: still closed.
    expect(await canViewFinancials()).toBe(false)
  })

  it('a found permission beats a failure — a positive is a positive', async () => {
    answers({
      profile_capabilities: [{ capability: 'view_financials' }],
      profile_roles: new Error('relation does not exist'),
      role_permissions: new Error('relation does not exist'),
    })
    expect(await financeAccess()).toBe('yes')
  })

  it('says unknown when the session could not be read, and no when nobody is signed in', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'network' } })
    expect(await financeAccess()).toBe('unknown')
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect(await financeAccess()).toBe('no')
  })

  it('says unknown when the client itself throws', async () => {
    getUser.mockRejectedValue(new Error('cookies() outside a request'))
    expect(await financeAccess()).toBe('unknown')
    expect(await canViewFinancials()).toBe(false)
  })
})

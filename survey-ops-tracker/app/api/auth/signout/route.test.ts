import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Guards the only exit in the app.
 *
 * The tests that matter here are the FAILURE ones. A sign-out that works when
 * everything else works is not the interesting case — the bug this route was
 * written for was someone holding a session they could not end, so what must be
 * proved is that the cookies are cleared even when Supabase is unreachable, and
 * that the response still points somewhere they can go.
 */

const { signOutMock, cookieJar } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  // Whatever the browser sent. @supabase/ssr chunks a large session across
  // sb-<ref>-auth-token.0/.1, which is why the deletion is a prefix sweep and
  // why this fixture includes chunks rather than a single tidy cookie.
  cookieJar: {
    current: [
      { name: 'sb-abc-auth-token.0', value: 'chunk0' },
      { name: 'sb-abc-auth-token.1', value: 'chunk1' },
      { name: 'socc_impersonator', value: 'signed.payload' },
      { name: 'theme', value: 'dark' },
    ],
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signOut: signOutMock } }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => cookieJar.current }),
}))

import { POST } from './route'

/** Names the response asked the browser to drop. NextResponse expresses a
 *  deletion as a set with an empty value and Max-Age=0. */
async function deleted(res: Response): Promise<string[]> {
  return res.headers
    .getSetCookie()
    .filter(c => /(?:^|;\s*)(?:max-age=0|expires=Thu, 01 Jan 1970)/i.test(c))
    .map(c => c.split('=')[0].trim())
}

beforeEach(() => {
  signOutMock.mockReset().mockResolvedValue({ error: null })
})

describe('POST /api/auth/signout', () => {
  it('clears every auth cookie, the chunks included', async () => {
    const gone = await deleted(await POST())
    expect(gone).toContain('sb-abc-auth-token.0')
    expect(gone).toContain('sb-abc-auth-token.1')
  })

  it('clears the impersonation cookie too', async () => {
    // The one the browser cannot clear itself — it is httpOnly and server-set.
    // Leaving it behind means the next person to sign in on this browser gets an
    // amber "Viewing as someone" banner over their own ordinary session.
    expect(await deleted(await POST())).toContain('socc_impersonator')
  })

  it('leaves cookies that are not ours alone', async () => {
    expect(await deleted(await POST())).not.toContain('theme')
  })

  it('still clears the cookies when Supabase is unreachable', async () => {
    // THE POINT OF THE ROUTE. A sign-out that gives up halfway because the auth
    // service is down leaves the user holding the session they were trying to
    // drop — which is the stranding this whole change exists to remove.
    signOutMock.mockRejectedValue(new Error('network'))
    const res = await POST()
    const gone = await deleted(res)
    expect(gone).toContain('sb-abc-auth-token.0')
    expect(gone).toContain('socc_impersonator')
    expect(res.status).toBe(200)
  })

  it('always names somewhere to go', async () => {
    signOutMock.mockRejectedValue(new Error('network'))
    expect(await (await POST()).json()).toMatchObject({ ok: true, next: '/login' })
  })

  it('is harmless when there is nothing to clear', async () => {
    // A double-click, or a stale tab posting twice.
    const saved = cookieJar.current
    cookieJar.current = []
    try {
      const res = await POST()
      expect(res.status).toBe(200)
      expect(await deleted(res)).toEqual(['socc_impersonator'])
    } finally {
      cookieJar.current = saved
    }
  })
})

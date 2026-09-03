import { describe, it, expect } from 'vitest'
import { decideImpersonation, IMPERSONATABLE_ROLES } from './impersonationRules'

const DAVID = { id: 'admin-1', email: 'david@alpharoc.ai' }

const req = (o: Partial<Parameters<typeof decideImpersonation>[0]> = {}) =>
  decideImpersonation({
    caller: DAVID,
    callerRoles: ['admin', 'finance'],
    requestedEmail: 'alex@alpharoc.ai',
    target: { id: 'sales-1', email: 'alex@alpharoc.ai', role: 'sales' },
    ...o,
  })

describe('decideImpersonation', () => {
  it('lets an admin view as a salesperson', () => {
    expect(req()).toEqual({ ok: true })
  })

  it('lets an admin view as a compliance reviewer', () => {
    expect(req({
      requestedEmail: 'eric.albert@holoceneadvisors.com',
      target: { id: 'c-1', email: 'eric.albert@holoceneadvisors.com', role: 'compliance' },
    })).toEqual({ ok: true })
  })

  it('refuses when nobody is signed in', () => {
    const r = req({ caller: null })
    expect(r).toMatchObject({ ok: false, status: 401 })
  })

  // The authority check. callerRoles is read SERVER-side from profile_roles and
  // is never taken from the request, so this is the whole gate.
  it('refuses a non-admin, however many other roles they hold', () => {
    expect(req({ callerRoles: [] })).toMatchObject({ ok: false, status: 403 })
    expect(req({ callerRoles: ['finance'] })).toMatchObject({ ok: false, status: 403 })
    expect(req({ callerRoles: ['sales', 'finance'] })).toMatchObject({ ok: false, status: 403 })
  })

  // ── THE LOAD-BEARING RULE ────────────────────────────────────────────────
  // Only tiers whose RLS is SELECT-only are legal targets. That is what makes
  // the feature read-only in the DATABASE rather than in the interface, and it
  // is the reason no write-blocking guard was added to the 46 browser write
  // paths. If this ever passes for an analyst, the feature silently becomes
  // "write as another person with no record of who really did it".
  it('refuses an ANALYST target — this is what keeps the session read-only', () => {
    const r = req({
      requestedEmail: 'bryan@alpharoc.ai',
      target: { id: 'a-1', email: 'bryan@alpharoc.ai', role: 'analyst' },
    })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect((r as { error: string }).error).toContain('analyst')
    // The refusal has to explain itself: a bare 403 sends an admin hunting for
    // a permissions problem when the answer is "that tier can write".
    expect((r as { error: string }).error).toMatch(/read-only|attributed/)
  })

  // "Never impersonate up." An admin is not a legal target either, so one admin
  // cannot borrow another's identity, and nobody can reach finance access they
  // do not already hold — because the only reachable tiers hold none.
  it('refuses an admin target, so nobody can impersonate sideways or up', () => {
    expect(req({
      requestedEmail: 'shanu@alpharoc.ai',
      target: { id: 'admin-2', email: 'shanu@alpharoc.ai', role: 'analyst' },
    })).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses a profile with no role at all', () => {
    const r = req({ target: { id: 'x', email: 'alex@alpharoc.ai', role: null } })
    expect(r).toMatchObject({ ok: false, status: 403 })
    expect((r as { error: string }).error).toContain('un-roled')
  })

  it('refuses an account that does not exist', () => {
    expect(req({ target: null })).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses an empty email before looking anything up', () => {
    expect(req({ requestedEmail: '' })).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses viewing as yourself', () => {
    const r = req({
      requestedEmail: 'david@alpharoc.ai',
      target: { id: 'admin-1', email: 'david@alpharoc.ai', role: 'analyst' },
    })
    expect(r).toMatchObject({ ok: false, status: 400 })
  })

  // Case is normalised by the caller, but self-detection must not depend on the
  // stored casing matching.
  it('detects self even when the stored email is capitalised differently', () => {
    expect(req({
      caller: { id: 'admin-1', email: 'David@AlphaROC.ai' },
      requestedEmail: 'david@alpharoc.ai',
      target: { id: 'admin-1', email: 'David@AlphaROC.ai', role: 'analyst' },
    })).toMatchObject({ ok: false, status: 400 })
  })

  // Order matters: identity before authority before existence before legality.
  // An unauthenticated request must not be able to probe which accounts exist.
  it('checks identity before it reveals whether an account exists', () => {
    expect(req({ caller: null, target: null })).toMatchObject({ ok: false, status: 401 })
    expect(req({ callerRoles: [], target: null })).toMatchObject({ ok: false, status: 403 })
  })

  it('the allowed tiers are exactly sales and compliance', () => {
    // Pinned deliberately. Adding to this list is a decision to allow writes as
    // another person, and it should fail a test rather than pass quietly.
    expect([...IMPERSONATABLE_ROLES]).toEqual(['sales', 'compliance'])
  })
})

import { describe, it, expect } from 'vitest'
import {
  signWithSecret,
  verifyWithSecret,
  DEFAULT_TTL_MS,
  type PendingAction,
} from './token'

const SECRET = 'test-secret-abc123'

function action(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    tool: 'advance_project',
    args: { project: 'PR00228', to_column: 'Fielding' },
    userEmail: 'david@alpharoc.ai',
    exp: Date.now() + DEFAULT_TTL_MS,
    ...overrides,
  }
}

describe('token sign/verify', () => {
  it('round-trips a valid token', () => {
    const a = action()
    const token = signWithSecret(a, SECRET)
    const res = verifyWithSecret(token, SECRET)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.action.tool).toBe('advance_project')
      expect(res.action.args).toEqual({ project: 'PR00228', to_column: 'Fielding' })
      expect(res.action.userEmail).toBe('david@alpharoc.ai')
    }
  })

  it('rejects a tampered payload', () => {
    const token = signWithSecret(action(), SECRET)
    const [payload, sig] = token.split('.')
    // Flip a byte in the payload but keep the old signature.
    const tampered = payload.slice(0, -2) + (payload.slice(-2) === 'AA' ? 'AB' : 'AA')
    const res = verifyWithSecret(`${tampered}.${sig}`, SECRET)
    expect(res).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a token signed with a different secret', () => {
    const token = signWithSecret(action(), SECRET)
    const res = verifyWithSecret(token, 'a-different-secret')
    expect(res).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects an expired token', () => {
    const token = signWithSecret(action({ exp: Date.now() - 1000 }), SECRET)
    const res = verifyWithSecret(token, SECRET)
    expect(res).toEqual({ ok: false, reason: 'expired' })
  })

  it('honors an explicit now for expiry', () => {
    const exp = 10_000
    const token = signWithSecret(action({ exp }), SECRET)
    expect(verifyWithSecret(token, SECRET, { now: 9_999 }).ok).toBe(true)
    expect(verifyWithSecret(token, SECRET, { now: exp })).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a wrong-user redemption', () => {
    const token = signWithSecret(action({ userEmail: 'alden@alpharoc.ai' }), SECRET)
    const res = verifyWithSecret(token, SECRET, { expectedUserEmail: 'david@alpharoc.ai' })
    expect(res).toEqual({ ok: false, reason: 'wrong_user' })
  })

  it('matches the bound user case-insensitively', () => {
    const token = signWithSecret(action({ userEmail: 'David@AlphaRoc.ai' }), SECRET)
    const res = verifyWithSecret(token, SECRET, { expectedUserEmail: 'david@alpharoc.ai' })
    expect(res.ok).toBe(true)
  })

  it('rejects a malformed token', () => {
    expect(verifyWithSecret('not-a-token', SECRET)).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyWithSecret('', SECRET)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a well-signed payload that is not a valid action shape', () => {
    // Sign an arbitrary (non-action) payload with the real secret; verify must
    // reject it on shape, not accept it.
    const bogus = { hello: 'world' } as unknown as PendingAction
    const token = signWithSecret(bogus, SECRET)
    expect(verifyWithSecret(token, SECRET)).toEqual({ ok: false, reason: 'malformed' })
  })
})

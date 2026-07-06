import { describe, it, expect } from 'vitest'
import { newSecret, sha256, verifyPkce } from './crypto'
import { createHash } from 'crypto'

describe('crypto', () => {
  it('generates prefixed 43+ char url-safe secrets', () => {
    const s = newSecret('sot_')
    expect(s.startsWith('sot_')).toBe(true)
    expect(s.length).toBeGreaterThanOrEqual(47)
    expect(/^[A-Za-z0-9_-]+$/.test(s.slice(4))).toBe(true)
    expect(newSecret('sot_')).not.toBe(s)
  })
  it('sha256 is stable hex', () => {
    expect(sha256('abc')).toBe(createHash('sha256').update('abc').digest('hex'))
  })
  it('verifyPkce S256 round-trips', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    expect(verifyPkce(verifier, challenge)).toBe(true)
    expect(verifyPkce(verifier + 'x', challenge)).toBe(false)
  })
})

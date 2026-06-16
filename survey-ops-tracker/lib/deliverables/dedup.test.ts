import { describe, it, expect } from 'vitest'
import { sha256 } from './dedup'

describe('deliverables/dedup', () => {
  it('hashes bytes deterministically', () => {
    const a = sha256(Buffer.from('hello'))
    expect(a).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
    expect(sha256(Buffer.from('hello'))).toBe(a)
    expect(sha256(Buffer.from('world'))).not.toBe(a)
  })
})

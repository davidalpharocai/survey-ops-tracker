import { describe, it, expect } from 'vitest'
import { isAllowedRedirect } from './redirects'

describe('isAllowedRedirect', () => {
  it('allows the Claude callbacks', () => {
    expect(isAllowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(isAllowedRedirect('https://claude.com/api/mcp/auth_callback')).toBe(true)
  })
  it('allows loopback on any port and path', () => {
    expect(isAllowedRedirect('http://localhost:53682/callback')).toBe(true)
    expect(isAllowedRedirect('http://127.0.0.1:8976/oauth/cb')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(isAllowedRedirect('https://attacker.example/cb')).toBe(false)
    expect(isAllowedRedirect('https://claude.ai.evil.com/api/mcp/auth_callback')).toBe(false)
    expect(isAllowedRedirect('https://claude.ai/other/path')).toBe(false)
    expect(isAllowedRedirect('http://localhost.evil.com/cb')).toBe(false)
    expect(isAllowedRedirect('javascript:alert(1)')).toBe(false)
    expect(isAllowedRedirect('not a url')).toBe(false)
  })
})

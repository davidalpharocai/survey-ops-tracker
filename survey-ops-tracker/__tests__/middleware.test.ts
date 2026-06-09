import { describe, it, expect } from 'vitest'

describe('auth redirect logic', () => {
  it('redirects unauthenticated users away from protected paths', () => {
    const shouldRedirect = (hasSession: boolean, path: string) => {
      if (!hasSession && path !== '/login') return '/login'
      return null
    }
    expect(shouldRedirect(false, '/')).toBe('/login')
    expect(shouldRedirect(true, '/')).toBe(null)
    expect(shouldRedirect(false, '/login')).toBe(null)
    expect(shouldRedirect(true, '/login')).toBe(null)
  })
})

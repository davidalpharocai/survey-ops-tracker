import { describe, it, expect } from 'vitest'
import { signedInDestination } from './signedInDestination'

describe('signedInDestination', () => {
  it('sends a signed-in salesperson to the sales view, not the form', () => {
    expect(signedInDestination('sales', 'alex@alpharoc.ai', null)).toBe('/sales')
    expect(signedInDestination('sales', 'alex@alpharoc.ai', '/')).toBe('/sales')
  })

  it('keeps a salesperson on the sales page they were heading for', () => {
    expect(signedInDestination('sales', 'alex@alpharoc.ai', '/sales/accounts/abc')).toBe('/sales/accounts/abc')
  })

  it('does not send a salesperson into the analyst app', () => {
    expect(signedInDestination('sales', 'alex@alpharoc.ai', '/finance')).toBe('/sales')
  })

  it('sends an analyst where they were going', () => {
    expect(signedInDestination('analyst', 'david@alpharoc.ai', '/projects/1')).toBe('/projects/1')
    expect(signedInDestination('analyst', 'david@alpharoc.ai', null)).toBe('/')
  })

  it('never redirects back to /login', () => {
    expect(signedInDestination('analyst', 'david@alpharoc.ai', '/login?next=/x')).toBe('/')
  })

  it('refuses off-site and protocol-relative destinations', () => {
    expect(signedInDestination('analyst', 'david@alpharoc.ai', '//evil.example')).toBe('/')
    expect(signedInDestination('analyst', 'david@alpharoc.ai', 'https://evil.example')).toBe('/')
    expect(signedInDestination('analyst', 'david@alpharoc.ai', '/\\evil.example')).toBe('/')
  })

  it('sends a compliance reviewer to the portal', () => {
    expect(signedInDestination('compliance', 'eric@holoceneadvisors.com', '/')).toBe('/portal')
  })

  it('shows the form for anything it cannot place', () => {
    expect(signedInDestination(null, 'new@alpharoc.ai', '/')).toBeNull()
    expect(signedInDestination('analyst', 'someone@gmail.com', '/')).toBeNull()
    expect(signedInDestination('sales', null, '/')).toBeNull()
  })
})

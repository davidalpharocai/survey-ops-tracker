import { describe, it, expect, vi } from 'vitest'
import { buildDomainMap } from './load'

describe('buildDomainMap', () => {
  it('maps each contact domain to its client, skipping shared providers', () => {
    const map = buildDomainMap([
      { email: 'a@airlines.org', client_id: 'c1', project_id: null },
      { email: 'b@gmail.com', client_id: 'c2', project_id: null },
      { email: 'c@balyasny.com', client_id: 'c3', project_id: null },
    ])
    expect(map).toEqual({ 'airlines.org': 'c1', 'balyasny.com': 'c3' })
  })
})

import { describe, it, expect, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { buildDomainMap, loadFilingHistory } from './load'
import type { ClientRec, ProjectRec } from './types'

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

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Chainable admin stub whose query resolves to `{ data: rows }`. */
function adminReturning(rows: { project_id: string }[]) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit']) chain[m] = vi.fn(() => chain)
  chain.then = (resolve: (v: { data: unknown }) => void) => resolve({ data: rows })
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof createAdminClient>
}

const histClients: ClientRec[] = [
  { id: 'c1', name: 'Wellington', code: 'Cl1' },
  { id: 'c2', name: 'AARP', code: 'Cl2' },
]
const histProjects: ProjectRec[] = [
  { id: 'p1', client_id: 'c1', project_code: 'PR001', project_name: 'Harvey Study' },
  { id: 'p2', client_id: 'c2', project_code: 'PR002', project_name: 'AARP Membership' },
]

describe('loadFilingHistory', () => {
  it('dedupes by project and joins client names', async () => {
    const admin = adminReturning([{ project_id: 'p1' }, { project_id: 'p1' }, { project_id: 'p2' }])
    const hist = await loadFilingHistory(admin, histClients, histProjects)
    expect(hist).toHaveLength(2)
    expect(hist[0]).toMatchObject({ projectCode: 'PR001', clientName: 'Wellington', clientId: 'c1' })
    expect(hist[1]).toMatchObject({ projectCode: 'PR002', clientName: 'AARP', clientId: 'c2' })
  })

  it('skips rows whose project is unknown', async () => {
    const admin = adminReturning([{ project_id: 'pX' }, { project_id: 'p1' }])
    const hist = await loadFilingHistory(admin, histClients, histProjects)
    expect(hist).toHaveLength(1)
    expect(hist[0].projectCode).toBe('PR001')
  })
})

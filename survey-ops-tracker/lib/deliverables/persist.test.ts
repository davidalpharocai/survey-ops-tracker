import { describe, it, expect, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { findDuplicate, findDuplicateAnywhere } from './persist'

/** Minimal chainable query stub that satisfies findDuplicate's Supabase call pattern. */
interface QueryChain {
  select: (col: string) => QueryChain
  eq: (col: string, val: unknown) => QueryChain
  neq: (col: string, val: unknown) => QueryChain
  is: (col: string, val: unknown) => QueryChain
  limit: (n: number) => QueryChain
  then: (resolve: (v: { data: { id: string }[] }) => void) => void
}

function adminReturning(rows: { id: string }[]) {
  const chain = {} as QueryChain
  for (const m of ['select', 'eq', 'neq', 'is', 'limit'] as const) {
    (chain as Record<string, unknown>)[m] = vi.fn(() => chain)
  }
  chain.then = (res) => res({ data: rows })
  return { from: vi.fn(() => chain) } as unknown as ReturnType<typeof createAdminClient>
}

describe('findDuplicate', () => {
  it('returns the existing id when a row matches', async () => {
    expect(await findDuplicate(adminReturning([{ id: 'dup-1' }]), 'folder-1', { fileHash: 'abc' })).toBe('dup-1')
  })
  it('returns null when none match', async () => {
    expect(await findDuplicate(adminReturning([]), 'folder-1', { sourceUrl: 'https://x' })).toBeNull()
  })
})

/** Columns passed to `.eq(col, …)` on the query the admin stub produced (to assert which filters were applied). */
function eqColumns(admin: ReturnType<typeof createAdminClient>): string[] {
  const fromMock = admin.from as unknown as { mock: { results: { value: Record<string, { mock: { calls: unknown[][] } }> }[] } }
  return fromMock.mock.results[0].value.eq.mock.calls.map((c) => String(c[0]))
}

describe('findDuplicateAnywhere', () => {
  it('matches by content across every folder, without a drive_folder_id filter', async () => {
    const admin = adminReturning([{ id: 'dup-2' }])
    expect(await findDuplicateAnywhere(admin, { fileHash: 'abc' })).toBe('dup-2')
    const cols = eqColumns(admin)
    expect(cols).toContain('file_hash')
    expect(cols).not.toContain('drive_folder_id')
  })
  it('returns null when nothing matches', async () => {
    expect(await findDuplicateAnywhere(adminReturning([]), { fileHash: 'zzz' })).toBeNull()
  })
})

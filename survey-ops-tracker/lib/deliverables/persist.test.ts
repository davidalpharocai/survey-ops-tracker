import { describe, it, expect, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { findDuplicate } from './persist'

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

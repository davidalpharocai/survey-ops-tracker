import { describe, it, expect, vi } from 'vitest'
import { findDuplicate } from './persist'

function adminReturning(rows: { id: string }[]) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'neq', 'is', 'limit']) chain[m] = vi.fn(() => chain)
  chain.then = (res: (v: { data: { id: string }[] }) => void) => res({ data: rows })
  return { from: vi.fn(() => chain) } as any
}

describe('findDuplicate', () => {
  it('returns the existing id when a row matches', async () => {
    expect(await findDuplicate(adminReturning([{ id: 'dup-1' }]), 'folder-1', { fileHash: 'abc' })).toBe('dup-1')
  })
  it('returns null when none match', async () => {
    expect(await findDuplicate(adminReturning([]), 'folder-1', { sourceUrl: 'https://x' })).toBeNull()
  })
})

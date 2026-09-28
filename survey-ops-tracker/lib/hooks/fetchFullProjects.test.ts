import { describe, it, expect, vi, beforeEach } from 'vitest'

// A fake PostgREST that behaves like the real one where it matters here: it
// answers 400 Bad Request when a URL carries too many ids (probed on 27 Sep:
// 600 ids answered, 800 did not), and it returns rows in its own order, not the
// caller's. Every `.in('id', …)` call is recorded so the chunking can be checked.
const h = vi.hoisted(() => ({
  calls: [] as string[][],
  rows: new Map<string, { id: string; deleted_at: string | null }>(),
  failOnCall: null as number | null,
  URL_LIMIT_IDS: 600,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => {
      let ids: string[] = []
      const q = {
        select: () => q,
        in: (_col: string, list: string[]) => {
          ids = list
          return q
        },
        is: () => q,
        then: (resolve: (v: unknown) => void) => {
          const n = h.calls.push(ids)
          if (ids.length > h.URL_LIMIT_IDS || h.failOnCall === n) {
            resolve({ data: null, error: { message: 'Bad Request' } })
            return
          }
          const found = ids
            .map(id => h.rows.get(id))
            .filter((r): r is { id: string; deleted_at: string | null } => !!r && r.deleted_at === null)
            .reverse()
          resolve({ data: found, error: null })
        },
      }
      return q
    },
  }),
}))

import { fetchFullProjects, FULL_FETCH_CHUNK } from './useProjects'

const idsOf = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(4, '0')}`)

beforeEach(() => {
  h.calls = []
  h.failOnCall = null
  h.rows = new Map()
})

describe('fetchFullProjects — the CSV export’s full read', () => {
  it('reads 1,000 ids (past the URL limit that broke a single request) in small requests, in the caller’s order', async () => {
    const ids = idsOf(1000)
    for (const id of ids) h.rows.set(id, { id, deleted_at: null })
    // The order the board shows, which is not the database's.
    const asked = [...ids].sort().reverse()
    const got = await fetchFullProjects(asked)
    expect(got.map(p => p.id)).toEqual(asked)
    expect(h.calls.length).toBe(Math.ceil(1000 / FULL_FETCH_CHUNK))
    for (const c of h.calls) expect(c.length).toBeLessThanOrEqual(FULL_FETCH_CHUNK)
    expect(h.calls.flat().sort()).toEqual([...ids].sort())
  })

  it('throws when any request fails, so no file is written with a hole in it', async () => {
    const ids = idsOf(450)
    for (const id of ids) h.rows.set(id, { id, deleted_at: null })
    h.failOnCall = 2
    await expect(fetchFullProjects(ids)).rejects.toMatchObject({ message: 'Bad Request' })
  })

  it('leaves out a row deleted since the board loaded, so the caller can see the file is short', async () => {
    const ids = idsOf(3)
    h.rows.set(ids[0], { id: ids[0], deleted_at: null })
    h.rows.set(ids[1], { id: ids[1], deleted_at: '2026-09-27T12:00:00Z' })
    h.rows.set(ids[2], { id: ids[2], deleted_at: null })
    const got = await fetchFullProjects(ids)
    expect(got.map(p => p.id)).toEqual([ids[0], ids[2]])
  })

  it('makes no request for an empty list', async () => {
    expect(await fetchFullProjects([])).toEqual([])
    expect(h.calls).toHaveLength(0)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The connector's half of "Name as printed on client documents"
 * (clients.display_name, migration 122): update_client and create_client.
 *
 * 122 is applied by hand, so the property that matters most is the one a
 * happy-path test would never see — a write attempted BEFORE the column
 * exists is refused with a sentence that says so, and nothing is sent to the
 * database. Not a schema-cache error, and never a silent success.
 */
const h = vi.hoisted(() => {
  const state = {
    /** What resolveClient returns: the row as select('*') would read it. */
    client: null as Record<string, unknown> | null,
    /** The create_client probe's result (select('display_name')). */
    probeError: null as { code?: string; message?: string } | null,
    /** The commit's result, for update and insert alike. */
    writeResult: { data: { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000' } as unknown, error: null as unknown },
    /** What create_client's "already exists?" lookup (maybeSingle) finds. */
    existing: null as Record<string, unknown> | null,
    writes: [] as { op: string; payload: unknown }[],
  }
  const builder = () => {
    const b: Record<string, unknown> = {}
    let terminal: 'probe' | 'existing' | 'write' = 'existing'
    b.select = (cols?: string) => { if (cols === 'display_name') terminal = 'probe'; return b }
    b.update = (payload: unknown) => { state.writes.push({ op: 'update', payload }); terminal = 'write'; return b }
    b.insert = (payload: unknown) => { state.writes.push({ op: 'insert', payload }); terminal = 'write'; return b }
    for (const m of ['eq', 'ilike', 'neq', 'is', 'order']) b[m] = () => b
    b.limit = () => b
    b.maybeSingle = () => Promise.resolve({ data: state.existing, error: null })
    b.single = () => Promise.resolve(state.writeResult)
    ;(b as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
      resolve(terminal === 'probe' ? { data: [], error: state.probeError } : { data: null, error: null })
    return b
  }
  return { state, builder }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => h.builder() }),
}))
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./data')>()),
  resolveClient: vi.fn(async () => h.state.client),
}))

import { TOOLS } from './registry'

const tool = (name: string) => TOOLS.find(t => t.name === name)!
const run = (name: string, args: Record<string, unknown>) =>
  tool(name).handler(args, {} as never, {} as never) as Promise<Record<string, unknown>>

beforeEach(() => {
  h.state.client = null
  h.state.probeError = null
  h.state.writeResult = { data: { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000' }, error: null }
  h.state.writes = []
  h.state.existing = null
})

describe('update_client — display_name', () => {
  it('refuses before 122, at preview, and writes nothing', async () => {
    // select('*') on a database without the column: the key is simply absent.
    h.state.client = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000' }
    const r = await run('update_client', { client: 'Cl00000', fields: { display_name: 'The Fixture Group' } })
    expect(r.error).toMatch(/migration 122/)
    expect(r.error).toMatch(/Nothing was changed/)
    expect(h.state.writes).toHaveLength(0)
  })

  it('previews the change once 122 is in', async () => {
    h.state.client = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000', display_name: null }
    const r = await run('update_client', { client: 'Cl00000', fields: { display_name: '  The Fixture Group ' } })
    expect(r.preview).toMatchObject({ changed: { display_name: [null, 'The Fixture Group'] } })
    expect(h.state.writes).toHaveLength(0)
  })

  it('treats blank as "clear it", so the internal name prints again', async () => {
    h.state.client = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000', display_name: 'Old Name' }
    const r = await run('update_client', { client: 'Cl00000', fields: { display_name: '   ' } })
    expect(r.preview).toMatchObject({ changed: { display_name: ['Old Name', null] } })
  })

  it('holds the 200-character limit the database enforces', async () => {
    h.state.client = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000', display_name: null }
    const r = await run('update_client', { client: 'Cl00000', fields: { display_name: 'x'.repeat(201) } })
    expect(r.error).toMatch(/200 characters/)
  })

  it('commits, and says so plainly if the column vanished between preview and confirm', async () => {
    h.state.client = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000', display_name: null }
    const ok = await run('update_client', { client: 'Cl00000', fields: { display_name: 'The Fixture Group' }, confirm: true })
    expect(ok.ok).toBe(true)
    expect(h.state.writes).toEqual([{ op: 'update', payload: { display_name: 'The Fixture Group' } }])

    h.state.writeResult = {
      data: null,
      error: { code: 'PGRST204', message: "Could not find the 'display_name' column of 'clients' in the schema cache" },
    }
    const gone = await run('update_client', { client: 'Cl00000', fields: { display_name: 'The Fixture Group' }, confirm: true })
    expect(gone.error).toMatch(/migration 122/)
  })
})

describe('create_client — display_name', () => {
  it('refuses before 122, before any preview, when the column probe fails', async () => {
    h.state.probeError = { code: '42703', message: 'column clients.display_name does not exist' }
    const r = await run('create_client', { name: 'Fixture Capital', display_name: 'The Fixture Group' })
    expect(r.error).toMatch(/migration 122/)
    expect(r.preview).toBeUndefined()
    expect(h.state.writes).toHaveLength(0)
  })

  it('names the printed name in the preview, and inserts it on confirm', async () => {
    const p = await run('create_client', { name: 'Fixture Capital', display_name: 'The Fixture Group' })
    expect((p.preview as { summary: string }).summary)
      .toBe('Create client "Fixture Capital" (printed on client documents as "The Fixture Group")')
    const c = await run('create_client', { name: 'Fixture Capital', display_name: 'The Fixture Group', confirm: true })
    expect(c.ok).toBe(true)
    expect(h.state.writes).toEqual([{ op: 'insert', payload: { name: 'Fixture Capital', display_name: 'The Fixture Group' } }])
  })

  it('says display_name was NOT applied when the client already exists, in preview and on confirm', async () => {
    h.state.existing = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000', display_name: null }
    const p = await run('create_client', { name: 'Fixture Capital', display_name: 'The Fixture Group' })
    const preview = p.preview as { summary: string; existing: boolean; display_name_applied?: boolean }
    expect(preview.existing).toBe(true)
    expect(preview.summary).toMatch(/already exists/)
    expect(preview.summary).toMatch(/display_name was not applied: use update_client/)
    expect(preview.display_name_applied).toBe(false)

    const c = await run('create_client', { name: 'Fixture Capital', display_name: 'The Fixture Group', confirm: true })
    expect(c).toMatchObject({ ok: true, existing: true, display_name_applied: false })
    expect(c.note).toMatch(/use update_client/)
    expect(h.state.writes).toHaveLength(0)
  })

  it('stays quiet about display_name when none was asked for on an existing client', async () => {
    h.state.existing = { id: 'cl-1', name: 'Fixture Capital', code: 'Cl00000' }
    const p = await run('create_client', { name: 'Fixture Capital' })
    expect((p.preview as { summary: string }).summary).not.toMatch(/display_name/)
    const c = await run('create_client', { name: 'Fixture Capital', confirm: true })
    expect(c).not.toHaveProperty('display_name_applied')
  })

  it('does not probe or touch the column when no display_name is given', async () => {
    h.state.probeError = { code: '42703', message: 'column clients.display_name does not exist' }
    const c = await run('create_client', { name: 'Fixture Capital', confirm: true })
    expect(c.ok).toBe(true)
    expect(h.state.writes).toEqual([{ op: 'insert', payload: { name: 'Fixture Capital' } }])
  })
})

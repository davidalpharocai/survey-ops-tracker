import { describe, it, expect, vi } from 'vitest'
import type { createAdminClient } from '@/lib/supabase/admin'
import { FakeDrive } from '@/lib/drive/fake'
import { ensureChildFolder, ensureClientFolder, ensureProjectFolder } from './folders'
import type { FolderResolver } from './ingest'

function resolver(drive: FakeDrive): FolderResolver {
  return {
    sharedDriveId: 'root',
    clientFolderId: async () => drive.createFolderIfMissing('root', 'Coatue'),
    projectFolderName: () => 'B2B Tracker_PR00003_2026.06.10',
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }
}

/** Minimal admin stub for ensureClientFolder: select(...).eq(...).single() + update(...).eq(...). */
function fakeAdmin(client: { drive_folder_id: string | null; name: string; code: string | null } | null, onUpdate?: (patch: Record<string, unknown>) => void) {
  const selectChain = { eq: () => selectChain, single: async () => ({ data: client, error: null }) }
  return {
    from: vi.fn(() => ({
      select: () => selectChain,
      update: (patch: Record<string, unknown>) => { onUpdate?.(patch); return { eq: async () => ({ error: null }) } },
    })),
  } as unknown as ReturnType<typeof createAdminClient>
}

describe('ensureChildFolder', () => {
  it('creates a child folder once, then finds the existing one', async () => {
    const drive = new FakeDrive('root')
    const a = await ensureChildFolder(drive, 'root', '00_Needs Review')
    const b = await ensureChildFolder(drive, 'root', '00_Needs Review')
    expect(a).toBe(b)
  })
})

describe('ensureProjectFolder', () => {
  it('creates Client/Project and is idempotent', async () => {
    const drive = new FakeDrive('root')
    const first = await ensureProjectFolder(drive, resolver(drive))
    const second = await ensureProjectFolder(drive, resolver(drive))
    expect(first).toBe(second)
    const clientFolder = await drive.findChildFolder('root', 'Coatue')
    expect(await drive.findChildFolder(clientFolder!, 'B2B Tracker_PR00003_2026.06.10')).toBe(first)
  })
})

describe('ensureClientFolder', () => {
  it('returns the stored drive_folder_id without touching Drive', async () => {
    const drive = new FakeDrive('root')
    const spy = vi.spyOn(drive, 'createFolder')
    const id = await ensureClientFolder(fakeAdmin({ drive_folder_id: 'existing-folder', name: 'Coatue', code: 'CL001' }), drive, 'root', 'c1')
    expect(id).toBe('existing-folder')
    expect(spy).not.toHaveBeenCalled()
  })

  it('creates "Name (CODE)" under the shared drive and writes it back when unmapped', async () => {
    const drive = new FakeDrive('root')
    let written: Record<string, unknown> | undefined
    const id = await ensureClientFolder(fakeAdmin({ drive_folder_id: null, name: 'Coatue', code: 'CL001' }, (p) => { written = p }), drive, 'root', 'c1')
    expect(await drive.findChildFolder('root', 'Coatue (CL001)')).toBe(id)
    expect(written).toEqual({ drive_folder_id: id })
  })
})

import { describe, it, expect, vi } from 'vitest'
import { resolveDeliverable, dismissDeliverable, type ResolveDeps, type DeliverableForResolve, type ProjectForResolve } from './resolve'

const queued: DeliverableForResolve = { id: 'd1', file_name: '2026.06.15 — x.pdf', drive_file_id: 'f1', status: 'review', deleted_at: null }
const project: ProjectForResolve = { id: 'p1', client_id: 'c1', project_code: 'PR00003', project_name: 'B2B Tracker', deliver_date: '2026-06-15' }

function makeDeps(over: Partial<ResolveDeps> = {}) {
  const calls = { move: [] as [string, string][], update: [] as [string, Record<string, unknown>][], activity: [] as string[] }
  const deps: ResolveDeps = {
    getDeliverable: async () => queued,
    getProject: async () => project,
    projectFolderId: async () => 'project-folder',
    moveFile: async (fileId, folderId) => { calls.move.push([fileId, folderId]) },
    updateDeliverable: async (id, patch) => { calls.update.push([id, patch]) },
    logActivity: async (pid) => { calls.activity.push(pid) },
    now: new Date('2026-06-24T12:00:00Z'),
    ...over,
  }
  return { deps, calls }
}

describe('resolveDeliverable', () => {
  it('moves the file and flips the row to filed/manual', async () => {
    const { deps, calls } = makeDeps()
    const res = await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })
    expect(res.ok).toBe(true)
    expect(calls.move).toEqual([['f1', 'project-folder']])
    expect(calls.update[0][1]).toMatchObject({ client_id: 'c1', project_id: 'p1', drive_folder_id: 'project-folder', status: 'filed', match_method: 'manual', match_confidence: 1, filed_by: 'u1' })
    expect(calls.activity).toEqual(['p1'])
  })

  it('404s when the deliverable is missing or deleted', async () => {
    const { deps } = makeDeps({ getDeliverable: async () => null })
    expect(await resolveDeliverable(deps, { id: 'x', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 404 })
  })

  it('409s when the deliverable is already filed', async () => {
    const { deps } = makeDeps({ getDeliverable: async () => ({ ...queued, status: 'filed' }) })
    expect(await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 409 })
  })

  it('422s when the chosen project lacks a client or code', async () => {
    const { deps } = makeDeps({ getProject: async () => ({ ...project, client_id: null }) })
    expect(await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })).toMatchObject({ ok: false, status: 422 })
  })

  it('also resolves an unsorted deliverable', async () => {
    const { deps, calls } = makeDeps({ getDeliverable: async () => ({ ...queued, status: 'unsorted' }) })
    const res = await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })
    expect(res.ok).toBe(true)
    expect(calls.update[0][1]).toMatchObject({ status: 'filed' })
  })

  it('skips the file move when there is no drive_file_id', async () => {
    const { deps, calls } = makeDeps({ getDeliverable: async () => ({ ...queued, drive_file_id: null }) })
    const res = await resolveDeliverable(deps, { id: 'd1', projectId: 'p1', userId: 'u1' })
    expect(res.ok).toBe(true)
    expect(calls.move).toEqual([])
  })
})

describe('dismissDeliverable', () => {
  it('soft-deletes the row', async () => {
    const update = vi.fn(async () => {})
    const res = await dismissDeliverable({ updateDeliverable: update, now: new Date('2026-06-24T12:00:00Z') }, { id: 'd1' })
    expect(res.ok).toBe(true)
    expect(update).toHaveBeenCalledWith('d1', { deleted_at: '2026-06-24T12:00:00.000Z' })
  })
})

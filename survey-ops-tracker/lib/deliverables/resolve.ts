// lib/deliverables/resolve.ts
export type DeliverableForResolve = { id: string; file_name: string | null; drive_file_id: string | null; status: string; deleted_at: string | null }
export type ProjectForResolve = { id: string; client_id: string | null; project_code: string | null; project_name: string; deliver_date: string | null }

export type ResolveDeps = {
  getDeliverable: (id: string) => Promise<DeliverableForResolve | null>
  getProject: (id: string) => Promise<ProjectForResolve | null>
  projectFolderId: (project: ProjectForResolve) => Promise<string>
  moveFile: (fileId: string, folderId: string) => Promise<void>
  updateDeliverable: (id: string, patch: Record<string, unknown>) => Promise<void>
  logActivity: (projectId: string, fileName: string, deliverableId: string) => Promise<void>
  now: Date
}

export type ResolveResult = { ok: true } | { ok: false; error: string; status: number }

export async function resolveDeliverable(deps: ResolveDeps, input: { id: string; projectId: string; userId: string }): Promise<ResolveResult> {
  const d = await deps.getDeliverable(input.id)
  if (!d || d.deleted_at) return { ok: false, error: 'Deliverable not found', status: 404 }
  if (d.status !== 'review' && d.status !== 'unsorted') return { ok: false, error: 'Deliverable is already filed', status: 409 }

  const p = await deps.getProject(input.projectId)
  if (!p || !p.client_id || !p.project_code) return { ok: false, error: 'Project must have a client and code', status: 422 }

  // v1 known gap: if moveFile succeeds but updateDeliverable then throws, the file is moved while
  // the row still reads its prior status. A retry re-moves to the same folder (harmless) and re-updates.
  const folderId = await deps.projectFolderId(p)
  if (d.drive_file_id) await deps.moveFile(d.drive_file_id, folderId)
  await deps.updateDeliverable(input.id, {
    client_id: p.client_id, project_id: p.id, drive_folder_id: folderId,
    status: 'filed', match_method: 'manual', match_confidence: 1,
    filed_by: input.userId, filed_at: deps.now.toISOString(),
  })
  await deps.logActivity(p.id, d.file_name ?? 'deliverable', input.id)
  return { ok: true }
}

export async function dismissDeliverable(deps: { updateDeliverable: (id: string, patch: Record<string, unknown>) => Promise<void>; now: Date }, input: { id: string }): Promise<{ ok: true }> {
  await deps.updateDeliverable(input.id, { deleted_at: deps.now.toISOString() })
  return { ok: true }
}

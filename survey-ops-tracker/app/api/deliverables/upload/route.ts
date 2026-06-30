import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { fileDeliverable, type FolderResolver } from '@/lib/deliverables/ingest'
import { findDuplicate } from '@/lib/deliverables/persist'
import { sha256 } from '@/lib/deliverables/dedup'
import { projectFolderName } from '@/lib/deliverables/naming'
import { normalizeUrl } from '@/lib/deliverables/links'
import { ensureClientFolder, ensureProjectFolder } from '@/lib/deliverables/folders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Inline auth helper — same pattern as app/api/parse-questionnaire/route.ts
async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

export async function POST(req: Request) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const projectId = form.get('projectId') as string | null
  const file = form.get('file') as File | null
  const link = form.get('link') as string | null
  if (!projectId || (!file && !link)) return NextResponse.json({ error: 'projectId and a file or link are required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: project } = await admin
    .from('survey_projects')
    .select('id, client_id, project_code, project_name, deliver_date')
    .eq('id', projectId).is('deleted_at', null).single()
  if (!project?.client_id || !project.project_code) {
    return NextResponse.json({ error: 'Project must have a client and code before filing deliverables' }, { status: 422 })
  }

  if (!process.env.DELIVERABLES_SHARED_DRIVE_ID) {
    return NextResponse.json({ error: 'Deliverables drive not configured' }, { status: 500 })
  }
  const drive = new GoogleDrive()
  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID
  const dateISO = (project.deliver_date as string | null) ?? new Date().toISOString().slice(0, 10)

  const resolver: FolderResolver = {
    sharedDriveId,
    clientFolderId: () => ensureClientFolder(admin, drive, sharedDriveId, project.client_id!),
    projectFolderName: () => projectFolderName(project.project_name, project.project_code!, dateISO),
    needsReviewFolderName: '00_Needs Review',
    unsortedFolderName: '_Unsorted',
  }

  const normalizedLink = link ? normalizeUrl(link) : null
  const bytes = file ? Buffer.from(await file.arrayBuffer()) : undefined
  const fileHash = bytes ? sha256(bytes) : null
  const folderId = await resolver.clientFolderId().then((cid) => drive.findChildFolder(cid, resolver.projectFolderName())) // may be null pre-create
  // Dedup check against the resolved project folder (create-or-find happens in fileDeliverable).
  const targetFolderId = folderId ?? (await ensureProjectFolder(drive, resolver))
  const dup = await findDuplicate(admin, targetFolderId, { fileHash, sourceUrl: normalizedLink })
  if (dup) {
    return NextResponse.json({ status: 'duplicate', duplicate_of: dup })
  }

  const rec = await fileDeliverable(drive, resolver, {
    kind: file ? 'file' : 'link',
    confident: true,
    hasProject: true,
    original_file_name: file?.name ?? normalizedLink ?? 'link',
    dateISO,
    mimeType: file?.type,
    bytes,
    source_url: normalizedLink ?? undefined,
  })

  const { data: inserted, error } = await admin.from('deliverables').insert({
    client_id: project.client_id,
    project_id: project.id,
    kind: rec.kind,
    drive_file_id: rec.drive_file_id,
    drive_folder_id: rec.drive_folder_id,
    file_name: rec.file_name,
    original_file_name: file?.name ?? null,
    file_hash: fileHash,
    source_url: normalizedLink,
    mime_type: file?.type ?? null,
    size_bytes: bytes?.length ?? null,
    source: 'upload',
    status: rec.status,
    match_confidence: 1,
    match_method: 'upload_context',
    filed_by: user.id,
    filed_at: new Date().toISOString(),
  }).select('id').single()
  if (error) {
    console.error('[deliverables/upload] DB insert failed after Drive write', { drive_file_id: rec.drive_file_id, error })
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  // Audit: log to project_activity (project is known here).
  await admin.from('project_activity').insert({
    project_id: project.id, type: 'deliverable', direction: 'outbound',
    subject: rec.file_name, snippet: `Filed deliverable: ${rec.file_name}`,
    source: 'deliverables', external_id: `deliverable:${inserted!.id}`,
    occurred_at: new Date().toISOString(),
  })

  return NextResponse.json({ status: rec.status, id: inserted!.id, drive_file_id: rec.drive_file_id })
}

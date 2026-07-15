import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { GoogleDrive } from '@/lib/drive/google'
import { resolveDeliverable, dismissDeliverable, type ResolveDeps } from '@/lib/deliverables/resolve'
import { ensureClientFolder, ensureProjectFolder } from '@/lib/deliverables/folders'
import { projectFolderName } from '@/lib/deliverables/naming'
import type { FolderResolver } from '@/lib/deliverables/ingest'
import type { TablesUpdate } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'analyst' ? user : null
}

// ResolveDeps.updateDeliverable types patch as Record<string, unknown> for
// library portability; we cast to the concrete Supabase row type here.
function dbUpdate(admin: ReturnType<typeof createAdminClient>, table: 'deliverables', rid: string, patch: Record<string, unknown>) {
  return admin.from(table).update(patch as TablesUpdate<typeof table>).eq('id', rid)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnalyst()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { projectId?: string; dismiss?: boolean }
  const admin = createAdminClient()

  if (body.dismiss) {
    await dismissDeliverable({
      updateDeliverable: async (rid, patch) => { await dbUpdate(admin, 'deliverables', rid, patch) },
      now: new Date(),
    }, { id })
    return NextResponse.json({ ok: true, dismissed: true })
  }

  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const sharedDriveId = process.env.DELIVERABLES_SHARED_DRIVE_ID
  if (!sharedDriveId) return NextResponse.json({ error: 'Deliverables drive not configured' }, { status: 500 })

  const drive = new GoogleDrive()

  const deps: ResolveDeps = {
    getDeliverable: async (rid) =>
      (await admin.from('deliverables').select('id, file_name, drive_file_id, status, deleted_at').eq('id', rid).single()).data,
    getProject: async (pid) =>
      (await admin.from('survey_projects').select('id, client_id, project_code, project_name, deliver_date, longitudinal').eq('id', pid).is('deleted_at', null).single()).data,
    projectFolderId: async (p) => {
      const dateISO = p.deliver_date ?? new Date().toISOString().slice(0, 10)
      const resolver: FolderResolver = {
        sharedDriveId,
        clientFolderId: () => ensureClientFolder(admin, drive, sharedDriveId, p.client_id!),
        projectFolderName: () => projectFolderName(p.project_name, p.project_code!, dateISO, p.longitudinal ?? false),
        needsReviewFolderName: '00_Needs Review',
        unsortedFolderName: '_Unsorted',
      }
      return ensureProjectFolder(drive, resolver)
    },
    moveFile: (fileId, folderId) => drive.moveFile(fileId, folderId),
    updateDeliverable: async (rid, patch) => { await dbUpdate(admin, 'deliverables', rid, patch) },
    logActivity: async (pid, fileName, did) => {
      await admin.from('project_activity').insert({
        project_id: pid,
        type: 'deliverable',
        direction: 'outbound',
        subject: fileName,
        snippet: `Filed deliverable (resolved): ${fileName}`,
        source: 'deliverables',
        external_id: `deliverable:${did}`,
        occurred_at: new Date().toISOString(),
      })
    },
    now: new Date(),
  }

  const result = await resolveDeliverable(deps, { id, projectId: body.projectId, userId: user.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}

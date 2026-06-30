// lib/deliverables/folders.ts
import type { createAdminClient } from '@/lib/supabase/admin'
import type { DriveClient } from '@/lib/drive/types'
import type { FolderResolver } from './ingest'

export async function ensureChildFolder(drive: DriveClient, parentId: string, name: string): Promise<string> {
  return (await drive.findChildFolder(parentId, name)) ?? (await drive.createFolder(parentId, name))
}

export async function ensureClientFolder(
  admin: ReturnType<typeof createAdminClient>,
  drive: DriveClient,
  sharedDriveId: string,
  clientId: string,
): Promise<string> {
  const { data: client } = await admin.from('clients').select('drive_folder_id, name, code').eq('id', clientId).single()
  if (client?.drive_folder_id) return client.drive_folder_id
  const name = client?.code ? `${client.name} (${client.code})` : (client?.name ?? clientId)
  const created = await ensureChildFolder(drive, sharedDriveId, name)
  await admin.from('clients').update({ drive_folder_id: created }).eq('id', clientId)
  return created
}

export async function ensureProjectFolder(drive: DriveClient, r: FolderResolver): Promise<string> {
  const clientFolder = await r.clientFolderId()
  return ensureChildFolder(drive, clientFolder, r.projectFolderName())
}

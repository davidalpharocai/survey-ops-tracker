import 'server-only'
import type { DriveClient } from '@/lib/drive/types'
import { ensureChildFolder } from './folders'
import { deliverableFileName } from './naming'
import { isGoogleNative } from './links'
import type { Enums } from '@/lib/supabase/types'

export type FolderResolver = {
  sharedDriveId: string
  /** ensure + return the client's top-level folder id */
  clientFolderId: () => Promise<string>
  /** name of the project subfolder, e.g. "Q2 Consumer Tracker_PR00112_2026.06.10" */
  projectFolderName: () => string
  needsReviewFolderName: string // "00_Needs Review"
  unsortedFolderName: string    // "_Unsorted"
}

export type FileInput = {
  kind: Enums<'deliverable_kind'>
  confident: boolean
  hasProject: boolean
  original_file_name: string
  dateISO: string
  // file
  mimeType?: string
  bytes?: Buffer
  // link
  source_url?: string
}

export type FiledRecord = {
  status: Enums<'deliverable_status'>
  kind: Enums<'deliverable_kind'>
  drive_file_id: string
  drive_folder_id: string
  file_name: string
}

/** Decide the destination folder, then file the item there. */
export async function fileDeliverable(drive: DriveClient, r: FolderResolver, input: FileInput): Promise<FiledRecord> {
  let folderId: string
  let status: Enums<'deliverable_status'>

  if (!input.confident) {
    folderId = await ensureChildFolder(drive, r.sharedDriveId, r.needsReviewFolderName)
    status = 'review'
  } else {
    const clientId = await r.clientFolderId()
    if (input.hasProject) {
      folderId = await ensureChildFolder(drive, clientId, r.projectFolderName())
      status = 'filed'
    } else {
      folderId = await ensureChildFolder(drive, clientId, r.unsortedFolderName)
      status = 'unsorted'
    }
  }

  const name = deliverableFileName(input.dateISO, input.original_file_name)
  let driveFileId: string
  if (input.kind === 'link') {
    const url = input.source_url!
    if (isGoogleNative(url)) {
      const targetId = googleFileId(url)
      driveFileId = targetId
        ? await drive.createShortcut(folderId, name, targetId)
        : await drive.createBookmark(folderId, name, url)
    } else {
      driveFileId = await drive.createBookmark(folderId, name, url)
    }
  } else {
    driveFileId = await drive.uploadFile(folderId, name, input.mimeType ?? 'application/octet-stream', input.bytes!)
  }

  return { status, kind: input.kind, drive_file_id: driveFileId, drive_folder_id: folderId, file_name: name }
}

/** Extract a Google Drive/Docs file id from a share URL, if present. */
export function googleFileId(url: string): string | null {
  return url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? url.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ?? null
}

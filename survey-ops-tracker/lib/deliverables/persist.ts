import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

/** Returns the existing deliverable id if this (hash|url, folder) already filed, else null. */
export async function findDuplicate(
  admin: ReturnType<typeof createAdminClient>,
  folderId: string,
  opts: { fileHash?: string | null; sourceUrl?: string | null }
): Promise<string | null> {
  let q = admin.from('deliverables').select('id').eq('drive_folder_id', folderId).neq('status', 'duplicate').is('deleted_at', null).limit(1)
  q = opts.fileHash ? q.eq('file_hash', opts.fileHash) : q.eq('source_url', opts.sourceUrl ?? '')
  const { data } = await q
  return data?.[0]?.id ?? null
}

/**
 * Returns an existing deliverable id if this exact content (file hash, or source url for links) is already
 * present ANYWHERE in the depository (any folder; excludes soft-deleted rows and prior duplicates), else null.
 *
 * The email path uses this instead of the folder-scoped {@link findDuplicate}: a deliverable already filed to a
 * project must be recognised as a duplicate even when the incoming email would route it to a different folder
 * (e.g. 00_Needs Review), so an already-filed file is never re-staged as a redundant review-queue copy.
 */
export async function findDuplicateAnywhere(
  admin: ReturnType<typeof createAdminClient>,
  opts: { fileHash?: string | null; sourceUrl?: string | null }
): Promise<string | null> {
  let q = admin.from('deliverables').select('id').neq('status', 'duplicate').is('deleted_at', null).limit(1)
  q = opts.fileHash ? q.eq('file_hash', opts.fileHash) : q.eq('source_url', opts.sourceUrl ?? '')
  const { data } = await q
  return data?.[0]?.id ?? null
}

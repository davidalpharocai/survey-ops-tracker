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

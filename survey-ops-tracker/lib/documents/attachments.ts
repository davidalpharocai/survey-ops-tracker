/**
 * Files attached to a survey record, as opposed to links pasted onto it.
 *
 * David, 2026-09-23: "for linking docs on a survey record, can we make it so one
 * can attach something as well?"
 *
 * ── AN ATTACHMENT IS AN ORDINARY LINKED-DOCUMENT ENTRY ──────────────────────
 * It is stored in `survey_projects.linked_documents` exactly like a pasted
 * Google Doc -- `{name, url, fmt}` -- with a url that points at this app instead
 * of at Google. That is a deliberate choice and it buys two things:
 *
 *   1. Rename, remove and reorder already work. LinkedDocuments.saveRename
 *      rebuilds an entry from exactly those three fields, so ANY extra field an
 *      attachment carried -- a storage path, a size, an uploader -- would be
 *      silently destroyed the first time someone renamed it. Carrying no extra
 *      fields means there is nothing to lose.
 *   2. Nothing else in the app has to learn a new shape. lib/mcp/data.ts and
 *      lib/utils/edwin.ts parse these entries too, and neither needed a change.
 *
 * ── WHY NOT public.deliverables ─────────────────────────────────────────────
 * Because deliverables are the CLIENT-FACING register, and since migration 118
 * a filed deliverable is readable by the salesperson who owns the account. An
 * internal working file -- a questionnaire draft, a screenshot, a half-finished
 * tab plan -- filed there would be visible to sales the moment it was uploaded.
 * These bytes live in a private bucket this app alone can read.
 *
 * ── WHY THE URL IS A ROUTE AND NOT A SIGNED LINK ────────────────────────────
 * A signed storage URL expires. Storing one in the array would leave a dead link
 * behind an hour later, with nothing on screen to say why. The route signs on
 * demand, every time, so the entry stays valid for as long as the file does.
 */

/** Every attachment url begins with this, which is how they are told apart from
 *  a pasted link without storing a type field. */
export const ATTACHMENT_ROUTE = '/api/project-files'

/** The private bucket. Created out of band -- see migration 120. */
export const ATTACHMENT_BUCKET = 'project-files'

/**
 * Vercel refuses a request body larger than about 4.5 MB on a serverless
 * function, and it does so with an opaque 413 the route never sees. Capping
 * below it lets the route give a real reason instead.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024

export function attachmentUrl(path: string): string {
  return `${ATTACHMENT_ROUTE}?path=${encodeURIComponent(path)}`
}

/**
 * Is this entry a file held by SOCC rather than a link to somewhere else?
 *
 * This is what keeps an internal file out of anything client-facing. The
 * after-fielding compliance review pre-suggests the FIRST linked document as the
 * results link it sends to an external reviewer at the client firm
 * (components/compliance/CompliancePanel.tsx) -- and an attachment sitting in
 * position one would be offered up as that link. It is an app route requiring an
 * analyst session, so an outside reviewer would get a login page rather than the
 * file; that is a broken promise rather than a leak, and it should not happen
 * either.
 */
export function isInternalAttachment(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.startsWith(ATTACHMENT_ROUTE)
}

/** The storage path out of an attachment url, or null if it is not one. */
export function attachmentPath(url: string | null | undefined): string | null {
  if (!isInternalAttachment(url)) return null
  const q = (url as string).indexOf('?')
  if (q < 0) return null
  return new URLSearchParams((url as string).slice(q + 1)).get('path')
}

/**
 * `{project}/{timestamp}-{safe name}`, matching the convention the questionnaire
 * bucket already uses (migration 008). The timestamp is passed in rather than
 * read from the clock so this stays a pure function and can be tested.
 */
export function attachmentStoragePath(projectId: string, fileName: string, now: number): string {
  // Strip anything that could climb out of the folder or confuse the storage
  // API, and keep the extension, which is what the fmt label is read from.
  const safe = fileName.replace(/[^\w.\- ]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file'
  return `${projectId}/${now}-${safe}`
}

/** The short format label, from the file name. Null when there is no extension
 *  -- which is different from an empty one. */
export function formatOf(fileName: string): string | null {
  const m = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return m ? m[1] : null
}

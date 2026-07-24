// Who can see the ✦ Summary while it's in limited preview. The AI narrative can
// still phrase things imprecisely (e.g. it once read a delivered/archived
// project as "rerun in progress"), so for now the strip is shown to a small
// allowlist only — David — until the accuracy pass lands and the team is opted
// in. Both the client strip and the /api/project-summary endpoint gate on this,
// so non-preview users neither see the strip nor trigger a paid model call.
//
// To roll it out to everyone later: add '*' to the list (or list more emails).
export const SUMMARY_PREVIEW_EMAILS: readonly string[] = ['david@alpharoc.ai']

/** True when this email may see the ✦ Summary preview. '*' in the allowlist
 *  means everyone (the GA switch). Case-insensitive; false for null/empty. */
export function canSeeSummaryPreview(email?: string | null): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  return SUMMARY_PREVIEW_EMAILS.some((a) => a === '*' || a.toLowerCase() === e)
}

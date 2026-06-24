// lib/deliverables/email.ts
import { sha256 } from './dedup'

export const ALPHAROC_DOMAIN = 'alpharoc.ai'
/** Inline images below this size are treated as signatures/logos, not deliverables. */
export const SKIP_IMAGE_MAX_BYTES = 10_000

export type AttachmentInput = { filename?: string; mimeType?: string; base64: string }
export type IngestPayload = {
  from: string
  to?: string | string[]
  cc?: string | string[]
  subject?: string
  date?: string
  messageId: string
  body?: string
  attachments?: AttachmentInput[]
}
export type FileItem = { filename: string; mimeType: string; bytes: Buffer; hash: string }

const EMAIL_RE = /[^\s<>,;"]+@[^\s<>,;"]+/g

/** Lowercased domain after the @, or '' if there is no address. */
export function emailDomain(addr: string): string {
  // A display name never contains '@', so the first EMAIL_RE match is always the real address.
  const m = addr.match(EMAIL_RE)
  const email = m?.[0]?.toLowerCase() ?? ''
  return email.split('@')[1] ?? ''
}

export function isInternalSender(from: string): boolean {
  return emailDomain(from) === ALPHAROC_DOMAIN
}

/** Extract every address from a header value (string or array), lowercased + de-duped, robust to display-name commas. */
export function parseAddressList(v: string | string[] | undefined): string[] {
  if (!v) return []
  const text = Array.isArray(v) ? v.join(',') : v
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(EMAIL_RE)) {
    const a = m[0].toLowerCase()
    if (!seen.has(a)) { seen.add(a); out.push(a) }
  }
  return out
}

/** First non-alpharoc address across To then Cc — i.e. the client you sent to. */
export function externalRecipient(to: string | string[] | undefined, cc: string | string[] | undefined): string | null {
  for (const a of [...parseAddressList(to), ...parseAddressList(cc)]) {
    if (!a.endsWith(`@${ALPHAROC_DOMAIN}`)) return a
  }
  return null
}

/** For a forward, the original recipient parsed from the forwarded-message header block. */
export function forwardedOriginalRecipient(body: string): string | null {
  // Capture the To: line within ~1000 chars of the marker; a very long Subject could push it
  // out of range, in which case we return null and the message lands in the review queue.
  const m = body.match(/Forwarded message[\s\S]{0,1000}?\n\s*To:\s*(.+)/i)
  if (!m) return null
  for (const a of parseAddressList(m[1])) {
    if (!a.endsWith(`@${ALPHAROC_DOMAIN}`)) return a
  }
  return null
}

/** The email the matcher should resolve the client from. */
export function clientSignalEmail(input: { to?: string | string[]; cc?: string | string[]; body?: string }): string | null {
  return externalRecipient(input.to, input.cc) ?? forwardedOriginalRecipient(input.body ?? '')
}

export function emailDateISO(date: string | undefined, fallback: Date): string {
  if (date) {
    const d = new Date(date)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return fallback.toISOString()
}

export function itemizeAttachments(attachments: AttachmentInput[] | undefined): FileItem[] {
  const out: FileItem[] = []
  for (const a of attachments ?? []) {
    const bytes = Buffer.from(a.base64 ?? '', 'base64')
    if (bytes.length === 0) continue
    const mimeType = a.mimeType ?? 'application/octet-stream'
    if (mimeType.startsWith('image/') && bytes.length < SKIP_IMAGE_MAX_BYTES) continue
    out.push({ filename: a.filename || 'attachment', mimeType, bytes, hash: sha256(bytes) })
  }
  return out
}

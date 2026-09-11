// lib/deliverables/email.ts
import addressparser from 'nodemailer/lib/addressparser'
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

/**
 * Lowercased domain of the ONE mailbox in an address header, or '' when the
 * header does not unambiguously name exactly one.
 *
 * DO NOT HAND-ROLL THIS. It gates the deliverables ingest — isInternalSender()
 * is the only check that a forward came from inside the company — and it was
 * got wrong twice in a row by regex:
 *
 *   1. "take the first @"      — the comment said "a display name never
 *      contains '@'". RFC 5322 permits a quoted display name to contain
 *      anything, so  "david@alpharoc.ai" <attacker@evil.com>  read as ours.
 *   2. "take the first <…>"    — same mistake one character over: qtext
 *      includes '<' and '>', so  "<david@alpharoc.ai>" <attacker@evil.com>
 *      read as ours too. And a quoted LOCAL-PART may contain '@', so
 *      "david@alpharoc.ai"@evil.com  did as well.
 *
 * In every one of those the attacker spoofs nothing: their own SPF and DKIM
 * pass, because our address is only ever a display name.
 *
 * So this defers to nodemailer's RFC 5322 parser — deliberately THE SAME parser
 * that lib/email/send.ts hands the reply to. That is the point: whatever this
 * function calls internal is, by construction, the address the receipt is
 * actually delivered to. The gate and the delivery cannot disagree.
 *
 * FAILS CLOSED. Zero mailboxes, several mailboxes, or a display name posing as
 * an address all return '' — read as external, so the mail is ignored. A header
 * we cannot read one way is not a header we should trust.
 */
export function emailDomain(addr: string): string {
  const parsed = addressparser(String(addr ?? ''), { flatten: true })
  if (parsed.length !== 1) return ''
  const { address, name } = parsed[0]
  if (!address) return ''
  // `<a@ours> <b@theirs>` (no comma) parses as ONE mailbox whose display name
  // is the second address. nodemailer would deliver to a@ours, so this is not a
  // disclosure — but it is a header with two addresses in it, and we decline to
  // rule on those rather than let one file into the depository.
  if (name && name.includes('@')) return ''
  const email = address.toLowerCase()
  // lastIndexOf, not split: a quoted local-part may itself contain '@'.
  const at = email.lastIndexOf('@')
  return at === -1 ? '' : email.slice(at + 1)
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

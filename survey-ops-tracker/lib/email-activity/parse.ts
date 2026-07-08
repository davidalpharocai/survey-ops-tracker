// lib/email-activity/parse.ts
// Pure parsing helpers for the email→activity pipeline. No I/O, no `any`.

const EMAIL_RE = /[^\s<>,;"]+@[^\s<>,;"]+/g

/** Parse the RFC-822 Message-ID from raw headers. Returns the id WITHOUT the
 *  angle brackets, or null if the header is absent. This is the dedup key
 *  (external_id = 'email:' + Message-ID) and must be the RFC-822 id, not a
 *  per-mailbox id (a CC'd mail shares one Message-ID across mailboxes). */
export function extractMessageId(rawHeaders: string): string | null {
  const m = rawHeaders.match(/^Message-ID:\s*<([^>]+)>/im)
  return m?.[1]?.trim() || null
}

/** A line that opens a quoted-history block: a Gmail "On … wrote:" attribution
 *  (possibly wrapped across two lines) or an Outlook "-----Original Message-----". */
function isQuoteBoundary(line: string, next: string): boolean {
  const t = line.trim()
  if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) return true
  if (/^_{5,}$/.test(t)) return true // Outlook divider
  // Gmail attribution, on one line…
  if (/^On\b.*\bwrote:\s*$/.test(t)) return true
  // …or wrapped: "On …" here, "wrote:" trailing on the next line.
  if (/^On\b/.test(t) && /\bwrote:\s*$/.test(`${t} ${next.trim()}`)) return true
  return false
}

/** Strip quoted reply history, quoted (`>`) lines, and the signature below a
 *  `-- ` delimiter, leaving only the author's top reply (trimmed). Used to build
 *  the de-noised snippet + search text; the full raw body is stored separately. */
export function stripQuotedHistory(body: string): string {
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1] ?? ''
    if (isQuoteBoundary(line, next)) break
    if (/^--\s*$/.test(line)) break // signature delimiter
    if (/^\s*>/.test(line)) continue // quoted line
    out.push(line)
  }
  return out.join('\n').trim()
}

/** Split a free-text survey-ID field on comma/whitespace/newline, trim, upper-case,
 *  drop blanks, and de-dupe (order-preserving). Blanks yield no signal. */
export function tokenizeSurveyIds(raw: string | null): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tok of raw.split(/[\s,]+/)) {
    const t = tok.trim().toUpperCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** Lowercased addr-spec of the first address in `s`, or null. Robust to a
 *  "Display Name <addr>" wrapper (a display name never contains '@'). */
function firstAddress(s: string): string | null {
  return s.match(EMAIL_RE)?.[0]?.toLowerCase() ?? null
}

/** Extract every address from a header value, lowercased + de-duped, robust to
 *  display-name commas (e.g. `"Doe, Jane" <jane@x>`). */
function addressList(v: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of v.matchAll(EMAIL_RE)) {
    const a = m[0].toLowerCase()
    if (!seen.has(a)) {
      seen.add(a)
      out.push(a)
    }
  }
  return out
}

/** Direction-agnostic participant parse: the From addr-spec and the full To list. */
export function parseParticipants(
  from: string,
  to: string
): { from_email: string | null; to_emails: string[] } {
  return { from_email: firstAddress(from), to_emails: addressList(to) }
}

// lib/drive/url.ts
// Validation for URLs that get written into Windows .url (InternetShortcut)
// files by createBookmark. Kept dependency-free (no server-only / googleapis)
// so both the real GoogleDrive and the in-memory FakeDrive share one contract.

export class InvalidUrlError extends Error {
  constructor(public readonly url: string, public readonly reason: string) {
    super(`Invalid bookmark URL (${reason})`)
    this.name = 'InvalidUrlError'
  }
}

// C0 control chars (0x00-0x1F) + DEL (0x7F). A CR/LF here would let an attacker
// inject extra INI keys (e.g. IconFile=\\host\share -> NTLM leak) into the .url
// file body; any control char signals tampering.
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * Validate a URL destined for a .url bookmark and return its normalized href.
 * Throws InvalidUrlError (rather than silently sanitizing) so callers can route
 * a bad link to manual review instead of writing a misleading/dangerous file.
 *
 * Rejects: embedded control characters (incl. CR/LF), non-http(s) schemes
 * (file:, javascript:, data:, ...), and anything unparseable. Leading/trailing
 * whitespace is tolerated. The returned href is guaranteed single-line.
 */
export function assertHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  if (hasControlChar(trimmed)) throw new InvalidUrlError(raw, 'control characters')

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new InvalidUrlError(raw, 'unparseable')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError(raw, `disallowed protocol "${parsed.protocol}"`)
  }
  return parsed.href
}

/**
 * Pull the Drive file/folder ID out of a Google Docs/Drive URL, or null if the
 * URL isn't a recognizable Google Drive link. Used to look up a document's real
 * title via the authenticated Drive API — an anonymous fetch can't read docs
 * shared only within the org (Google bounces it to a sign-in page).
 *
 * Handles: /document|spreadsheets|presentation|forms/d/<id>, /file/d/<id>,
 * /drive/folders/<id>, and ?id=<id> (open?id=, uc?id=). Host-anchored so a
 * lookalike like docs.google.com.evil.com is rejected.
 */
export function extractDriveFileId(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/(?:^|\.)(?:docs|drive)\.google\.com$/.test(url.hostname.toLowerCase())) return null

  const byPath = url.pathname.match(/\/(?:d|folders)\/([A-Za-z0-9_-]+)/)
  if (byPath) return byPath[1]

  const byQuery = url.searchParams.get('id')
  if (byQuery && /^[A-Za-z0-9_-]+$/.test(byQuery)) return byQuery

  return null
}

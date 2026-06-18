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

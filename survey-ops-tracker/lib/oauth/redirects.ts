// The load-bearing security control: only genuine Claude callbacks (or local
// loopback for Desktop/Code) may ever receive an authorization code.
const EXACT_ALLOWED = new Set([
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
])

export function isAllowedRedirect(uri: string): boolean {
  let u: URL
  try { u = new URL(uri) } catch { return false }
  if (EXACT_ALLOWED.has(u.origin + u.pathname)) return true
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true
  return false
}

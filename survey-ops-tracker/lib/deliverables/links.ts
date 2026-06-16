// lib/deliverables/links.ts
const DELIVERABLE_HOST_RE = [/(^|\.)occam/i, /edwin\.alpharoc\.ai$/i, /(^|\.)drive\.google\.com$/i, /(^|\.)docs\.google\.com$/i]

function host(u: string): string | null {
  try { return new URL(u).host.toLowerCase() } catch { return null }
}

export function isGoogleNative(u: string): boolean {
  const h = host(u) ?? ''
  return /(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(h)
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u.trim())
    url.hash = ''
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) url.searchParams.delete(p)
    return url.toString().replace(/\/$/, '')
  } catch {
    return u.trim()
  }
}

export function extractDeliverableLinks(body: string): string[] {
  const urls = body.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const h = host(raw)
    if (!h || !DELIVERABLE_HOST_RE.some((re) => re.test(h))) continue
    const key = normalizeUrl(raw)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
  }
  return out
}

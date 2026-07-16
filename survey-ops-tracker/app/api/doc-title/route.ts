import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { extractDriveFileId } from '@/lib/drive/url'
import { GoogleDrive } from '@/lib/drive/google'

export const dynamic = 'force-dynamic'

// Hosts we are willing to fetch titles from (avoid SSRF on arbitrary URLs)
const ALLOWED_HOSTS = new Set([
  'docs.google.com',
  'drive.google.com',
  'sheets.google.com',
  'slides.google.com',
  'forms.google.com',
])

// Suffixes Google appends to page titles
const TITLE_SUFFIX = / - Google (Docs|Sheets|Slides|Forms|Drive)\s*$/i

// Map a Drive MIME type to a short, familiar format label for the doc chip.
function mimeToFormat(mime: string | null): string | null {
  if (!mime) return null
  const map: Record<string, string> = {
    'application/vnd.google-apps.document': 'doc',
    'application/vnd.google-apps.spreadsheet': 'xlsx',
    'application/vnd.google-apps.presentation': 'pptx',
    'application/vnd.google-apps.form': 'form',
    'application/pdf': 'pdf',
    'text/csv': 'csv',
    'text/plain': 'txt',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  }
  if (map[mime]) return map[mime]
  const sub = mime.split('/')[1]
  return sub ? sub.split('.').pop()!.slice(0, 5) : null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return new Response('Unauthorized', { status: 401 })

  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new Response('url required', { status: 400 })

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return Response.json({ title: null })
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return Response.json({ title: null })
  }

  // 1) Preferred: the authenticated Drive API. Our OAuth identity is an AlphaRoc
  //    member, so it can read docs shared only within the org — which the
  //    anonymous scrape (step 2) can't, since Google bounces it to a sign-in page.
  const fileId = extractDriveFileId(parsed.toString())
  if (fileId) {
    try {
      const { name, mimeType } = await new GoogleDrive().getMeta(fileId)
      if (name) return Response.json({ title: name, format: mimeToFormat(mimeType) })
    } catch {
      // Drive API not configured, or our identity lacks access — fall through.
    }
  }

  // 2) Fallback: scrape the public <title>. Works only for "anyone with the link"
  //    docs; private/org-restricted ones return a sign-in page (-> null).
  try {
    const res = await fetch(parsed.toString(), {
      // Don't follow redirects — a 3xx could bounce to an internal host (SSRF).
      // A real Google doc title page responds 200 directly.
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SurveyOpsTracker/1.0)' },
    })
    if (!res.ok) return Response.json({ title: null })
    const html = (await res.text()).slice(0, 50_000)
    const m = html.match(/<title[^>]*>([^<]*)<\/title>/i)
    if (!m) return Response.json({ title: null })
    const raw = m[1]
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .trim()
    // A sign-in redirect means the doc is private — no usable title
    if (/sign in|google accounts/i.test(raw)) return Response.json({ title: null })
    const title = raw.replace(TITLE_SUFFIX, '').trim()
    return Response.json({ title: title || null })
  } catch {
    return Response.json({ title: null })
  }
}

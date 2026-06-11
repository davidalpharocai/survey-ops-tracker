import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

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

  try {
    const res = await fetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SurveyOpsTracker/1.0)' },
    })
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

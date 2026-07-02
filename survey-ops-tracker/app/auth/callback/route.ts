import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Default to the Command Center; portal flows pass an explicit next=/portal….
  const next = searchParams.get('next') ?? '/'
  // Only allow same-origin relative redirects
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  const loginPath = safeNext.startsWith('/portal') ? '/portal/login' : '/login'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`)
    }
  }
  // Expired/used link: fall back to the matching login flow, preserving the destination
  return NextResponse.redirect(
    `${origin}${loginPath}?error=link&next=${encodeURIComponent(safeNext)}`
  )
}

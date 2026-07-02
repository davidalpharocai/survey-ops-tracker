import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // Default to the Command Center. Portal flows (login + reviewer dispatch) pass
  // an explicit next=/portal…, so only main-app links (invite/reset/magic) hit
  // this default — and those belong in the app, not the compliance portal.
  const next = searchParams.get('next') ?? '/'
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'
  const loginPath = safeNext.startsWith('/portal') ? '/portal/login' : '/login'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`)
  }
  // Expired/used link: fall back to the matching login flow, preserving the destination
  return NextResponse.redirect(
    `${origin}${loginPath}?error=link&next=${encodeURIComponent(safeNext)}`
  )
}

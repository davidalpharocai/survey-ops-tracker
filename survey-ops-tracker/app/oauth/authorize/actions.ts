'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getClient, issueCode } from '@/lib/oauth/store'

// Next.js server actions carry built-in same-origin/CSRF protection for POSTs
// (the Origin header is checked against the deployment host), so no separate
// anti-CSRF token is threaded through these forms.

type AuthorizeParams = {
  client_id: string; redirect_uri: string; state?: string; code_challenge: string
}

async function requireAnalyst() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) return null
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles')
    .select('role').eq('id', user.id).maybeSingle()
  if (!profile || profile.role !== 'analyst') return null
  return user
}

export async function allowAction(params: AuthorizeParams) {
  const user = await requireAnalyst()
  if (!user) redirect('/login')
  const client = await getClient(params.client_id)
  const uris = (client?.redirect_uris ?? []) as string[]
  if (!client || !uris.includes(params.redirect_uri)) {
    redirect('/oauth/authorize?error=bad_client') // error page render, never redirect out
  }
  const code = await issueCode({
    clientId: params.client_id, userId: user!.id,
    redirectUri: params.redirect_uri, codeChallenge: params.code_challenge,
  })
  const url = new URL(params.redirect_uri)
  url.searchParams.set('code', code)
  if (params.state) url.searchParams.set('state', params.state)
  redirect(url.toString())
}

// Shown on the "not an analyst" refusal: sign the current (wrong-role) account
// out and send the user to the login page, returning to this exact authorize
// request afterward — so someone stuck on the wrong session (e.g. a compliance
// login) can switch to their analyst account without a manual logout.
export async function reauthAction(nextUrl: string) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  const safe = nextUrl.startsWith('/') && !nextUrl.startsWith('//') && !nextUrl.includes('\\')
    ? nextUrl : '/'
  redirect(`/login?next=${encodeURIComponent(safe)}`)
}

export async function denyAction(params: Pick<AuthorizeParams, 'client_id' | 'redirect_uri' | 'state'>) {
  const client = await getClient(params.client_id)
  const uris = (client?.redirect_uris ?? []) as string[]
  if (!client || !uris.includes(params.redirect_uri)) redirect('/')
  const url = new URL(params.redirect_uri)
  url.searchParams.set('error', 'access_denied')
  if (params.state) url.searchParams.set('state', params.state)
  redirect(url.toString())
}

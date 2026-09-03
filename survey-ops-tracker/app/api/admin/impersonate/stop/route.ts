import { NextResponse } from 'next/server'
import { createClient as createUserClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createRawClient } from '@supabase/supabase-js'
import { IMPERSONATION_COOKIE, readImpersonation } from '@/lib/auth/impersonation'

export const dynamic = 'force-dynamic'

/**
 * Hand the session back to the admin.
 *
 * THE AUTHORITY HERE IS THE SIGNED COOKIE, not the current session — and it has
 * to be, because the current session belongs to the person being impersonated,
 * who has no right to mint anything. That is precisely why the cookie is HMAC
 * signed with a server-only secret: without the signature this endpoint would
 * mint an admin session for whoever could write a cookie, which is everyone.
 *
 * It re-verifies the admin's role before restoring rather than trusting the
 * cookie's word for it. The cookie proves WHO started this; whether that person
 * is still an admin is a separate question, and a role revoked mid-session
 * should not be handed back.
 */
export async function POST() {
  const imp = await readImpersonation()
  if (!imp) {
    // Not an error worth failing on: a Stop with no impersonation in flight is
    // what a stale tab or a double-click looks like. Clear the cookie and say so.
    const res = NextResponse.json({ ok: true, note: 'Not viewing as anyone.' })
    res.cookies.delete(IMPERSONATION_COOKIE)
    return res
  }

  const admin = createAdminClient()

  // Still an admin? Checked fresh, because the cookie only proves who began.
  const { data: roles } = await admin
    .from('profile_roles').select('role').eq('profile_id', imp.adminId)
  if (!(roles ?? []).some(r => r.role === 'admin')) {
    // Do NOT restore, and do not leave them stranded in someone else's session
    // either: clear both and make them sign in as themselves.
    const userClient = await createUserClient()
    await userClient.auth.signOut()
    const res = NextResponse.json({
      ok: false,
      error: `${imp.adminEmail} no longer holds the admin role, so the session was not restored. Signed out — please sign in again.`,
      next: '/login',
    }, { status: 403 })
    res.cookies.delete(IMPERSONATION_COOKIE)
    return res
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: imp.adminEmail,
  })
  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json({
      error: `Could not restore ${imp.adminEmail}'s session: ${linkError?.message ?? 'no token'}. Sign out and back in.`,
    }, { status: 500 })
  }

  const raw = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data: session, error: otpError } = await raw.auth.verifyOtp({
    token_hash: link.properties.hashed_token, type: 'magiclink',
  })
  if (otpError || !session?.session) {
    return NextResponse.json({
      error: `Could not restore ${imp.adminEmail}'s session: ${otpError?.message ?? 'no session'}. Sign out and back in.`,
    }, { status: 500 })
  }

  const swap = await createUserClient()
  await swap.auth.setSession({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  })

  // Logged AFTER the restore succeeded, the mirror of start logging before.
  // Both orderings are deliberate: never impersonate without a record, and never
  // record a return that did not happen.
  await admin.from('permission_audit').insert({
    actor: imp.adminEmail,
    action: 'impersonate_stop',
    subject: imp.subjectEmail,
    target: imp.subjectRole,
    reason: 'Stopped viewing as this user.',
  })

  const res = NextResponse.json({ ok: true, restored: imp.adminEmail, next: '/' })
  res.cookies.delete(IMPERSONATION_COOKIE)
  return res
}

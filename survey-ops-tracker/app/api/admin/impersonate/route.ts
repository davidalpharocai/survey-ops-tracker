import { NextResponse } from 'next/server'
import { createClient as createUserClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient as createRawClient } from '@supabase/supabase-js'
import {
  IMPERSONATION_COOKIE,
  encodeImpersonator,
  decideImpersonation,
} from '@/lib/auth/impersonation'

export const dynamic = 'force-dynamic'

/**
 * Start viewing the app as someone else.
 *
 * Every check here runs on the SERVER against the caller's verified session.
 * Nothing is taken from the request body except which email to view as, and
 * that is validated against the profiles table before anything is minted.
 *
 * The order matters and is not cosmetic: identity, then authority, then target
 * legality, then audit, and only then is a session created. An impersonation
 * that is going to be refused must never reach the point of existing.
 */
export async function POST(req: Request) {
  // 1. WHO IS ASKING — from the session cookie, via getUser() so the token is
  //    verified against the auth server rather than merely decoded.
  const userClient = await createUserClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const admin = createAdminClient()

  // 2. ARE THEY AN ADMIN — read through the ADMIN client keyed on the verified
  //    user id. Deliberately not the user's own client: profile_roles is
  //    readable by analysts, so this would work either way, but authority checks
  //    should never depend on the subject's own read policy.
  const { data: roles } = await admin
    .from('profile_roles').select('role').eq('profile_id', user.id)
  let email = ''
  try {
    const body = (await req.json()) as { email?: string }
    email = (body.email ?? '').trim().toLowerCase()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with an email.' }, { status: 400 })
  }

  const { data: target } = await admin
    .from('profiles').select('id, email, role').ilike('email', email).maybeSingle()

  // 3. IS THIS ALLOWED. Every rule lives in decideImpersonation, which is pure
  //    and unit-tested (impersonationRules.test.ts) — including the one that
  //    makes the whole feature read-only: only tiers whose RLS is SELECT-only
  //    are legal targets, so the minted session cannot write, and an admin can
  //    never impersonate up into another admin or into finance access they do
  //    not hold. This route's job is to gather facts and obey.
  const verdict = decideImpersonation({
    caller: { id: user.id, email: user.email },
    callerRoles: (roles ?? []).map(r => r.role as string),
    requestedEmail: email,
    target: target ?? null,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status })
  }
  if (!target) {
    // Unreachable — decideImpersonation returns 404 for a missing target — but
    // it narrows the type for everything below rather than asserting non-null.
    return NextResponse.json({ error: `No account for ${email}.` }, { status: 404 })
  }

  // 4. RECORD IT BEFORE DOING IT. If the audit insert fails the impersonation
  //    does not happen: an unlogged one is worse than none.
  const { error: auditError } = await admin.from('permission_audit').insert({
    actor: user.email,
    action: 'impersonate_start',
    subject_id: target.id,
    subject: target.email ?? email,
    target: target.role ?? 'unknown',
    reason: 'Viewing the app as this user (read-only).',
  })
  if (auditError) {
    return NextResponse.json({
      error: `Could not record the impersonation, so it was not started: ${auditError.message}`,
    }, { status: 500 })
  }

  // 5. MINT THE TARGET'S SESSION. generateLink gives a one-time token; verifyOtp
  //    exchanges it for real tokens. Done with a throwaway ANON client that
  //    persists nothing, so the exchange cannot disturb this request's own
  //    cookie jar before step 6 writes it deliberately.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink', email: target.email ?? email,
  })
  if (linkError || !link?.properties?.hashed_token) {
    return NextResponse.json(
      { error: `Could not create a session for ${email}: ${linkError?.message ?? 'no token returned'}` },
      { status: 500 })
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
    return NextResponse.json(
      { error: `Could not sign in as ${email}: ${otpError?.message ?? 'no session'}` },
      { status: 500 })
  }

  // 6. SWAP THE COOKIES. setSession on a request-scoped server client writes the
  //    auth cookies through the same @supabase/ssr adapter the rest of the app
  //    reads, so nothing has to know the cookie names.
  const swap = await createUserClient()
  await swap.auth.setSession({
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  })

  // 7. Remember who to hand it back to. httpOnly because nothing in the browser
  //    reads it — the banner is server-rendered — and signed so a forged one
  //    cannot make /stop mint a session for an admin of the forger's choosing.
  const res = NextResponse.json({
    ok: true,
    viewing_as: target.email,
    role: target.role,
    // Where to land. The (app) layout would bounce a sales session to /sales
    // anyway, but saying so explicitly means the client does not have to guess.
    next: target.role === 'compliance' ? '/portal' : '/sales',
  })
  res.cookies.set(IMPERSONATION_COOKIE, encodeImpersonator({
    adminId: user.id,
    adminEmail: user.email,
    subjectEmail: target.email ?? email,
    subjectRole: target.role ?? 'unknown',
  }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Matched to a Supabase session's life rather than something shorter: a
    // cookie that expires while the session it explains is still live is the
    // one failure mode here (a read-only session with no banner and no way out).
    maxAge: 60 * 60 * 12,
  })
  return res
}

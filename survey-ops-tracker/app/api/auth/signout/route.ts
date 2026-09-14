import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { IMPERSONATION_COOKIE } from '@/lib/auth/impersonation'

export const dynamic = 'force-dynamic'

/**
 * End the session. The only one of these in the app.
 *
 * WHY THIS EXISTS AT ALL: until now nothing in SOCC could sign a user out. The
 * closest thing was app/(auth)/login/login-form.tsx, which calls signOut() as a
 * SIDE EFFECT of two error branches (?unauthorized and ?pending) — so the only
 * way to end a session was to talk your way into an error state. That left every
 * tier without an exit, and it stranded an admin whose "view as" cookie expired
 * while the target's session outlived it: a read-only session, no banner to
 * explain it, and no button anywhere on the page.
 *
 * WHY SERVER-SIDE rather than just calling supabase.auth.signOut() in the
 * browser: the impersonation cookie is httpOnly and server-set, so the browser
 * client cannot clear it. A client-only sign-out leaves it behind, and the next
 * person to sign in on that browser gets an amber "Viewing as <someone>" banner
 * over their own perfectly normal session. Both cookies have to die together,
 * and only the server can kill the second one.
 *
 * POST, NOT GET, and that is the whole reason /signout is a page with a button
 * rather than a link that acts on load. A GET that ends a session is triggerable
 * by any third party that can get the user to load an <img src="…/signout">.
 * Being logged out is not dangerous, but it is not something a stranger should
 * get to do to you, and the cost of avoiding it is one click.
 */
export async function POST() {
  // Best-effort, deliberately. If Supabase is unreachable the local cookies must
  // STILL be cleared — a sign-out that fails halfway and leaves the session cookie
  // in place is the exact trap this route was written to remove. The worst case
  // here is a refresh token that stays valid server-side until it expires; the
  // browser no longer holds anything that can present it.
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch {
    // Swallowed on purpose — see above. Never let this throw the user back into
    // a shell they cannot leave.
  }

  const res = NextResponse.json({ ok: true, next: '/login' })

  // Clear the auth cookies ON THE RESPONSE as well, rather than trusting
  // signOut()'s writes to reach it. Two reasons, both real:
  //
  // 1. lib/supabase/server.ts swallows every cookie write in a try/catch, so a
  //    failed set is indistinguishable from a successful one from in here.
  // 2. This handler builds its own NextResponse. Relying on next/headers cookie
  //    mutations to merge into a hand-built response is a behaviour I would
  //    rather not have a sign-out depend on.
  //
  // Prefix match because @supabase/ssr chunks a large session across
  // sb-<ref>-auth-token.0, .1, … — deleting only the unsuffixed name would leave
  // the chunks behind and the session reconstructible.
  const jar = await cookies()
  for (const c of jar.getAll()) if (c.name.startsWith('sb-')) res.cookies.delete(c.name)

  // Same name and path the start route set it with, so this actually removes it
  // rather than shadowing it with a second cookie on a different path.
  res.cookies.delete(IMPERSONATION_COOKIE)
  return res
}

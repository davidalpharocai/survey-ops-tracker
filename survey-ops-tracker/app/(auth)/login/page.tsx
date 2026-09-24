import { redirect } from 'next/navigation'
import LoginForm from './login-form'
import { createClient } from '@/lib/supabase/server'
import { signedInDestination } from '@/lib/auth/signedInDestination'

export const dynamic = 'force-dynamic'

/** Query flags that mean "end this session". The form handles them by signing
 *  out; skipping past them to the app would undo the reason we were sent here. */
const ENDING = ['unauthorized', 'pending', 'signout-failed'] as const

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  // Already signed in on this device? Go straight in. See
  // lib/auth/signedInDestination for why the form must not greet a live session.
  if (!ENDING.some(k => sp[k] != null)) {
    let dest: string | null = null
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile, error } = await supabase
          .from('profiles').select('role').eq('id', user.id).single()
        // A failed profile read shows the form rather than guessing: the (app)
        // layout sends a profile error HERE, so redirecting on one would loop.
        if (!error) dest = signedInDestination(profile?.role, user.email, one(sp.next))
      }
    } catch {
      // Auth unreachable: the form is the honest fallback.
    }
    // Outside the try: redirect() works by throwing, and the catch above would
    // swallow it.
    if (dest) redirect(dest)
  }

  return <LoginForm />
}

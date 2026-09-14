import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { readImpersonation } from '@/lib/auth/impersonation'
import { SignOutButton } from '@/components/shared/SignOutButton'
import { StopImpersonatingButton } from '@/components/shared/StopImpersonatingButton'

export const dynamic = 'force-dynamic'

/**
 * The escape hatch. `/signout`, typeable, reachable from every tier.
 *
 * DELIBERATELY AT THE TOP LEVEL of app/ rather than inside (app), (sales) or
 * (portal). Each of those shells gates, and the whole point of this page is to
 * be reachable by someone the gates are working against — a salesperson who has
 * no analyst rows, an admin holding a session that is not theirs, anyone whose
 * tier has no surface yet. A page that lives inside a gate cannot rescue you
 * from that gate.
 *
 * IT ALSO ANSWERS "WHY AM I SEEING THIS?", which is the more useful half. The
 * failure that prompted this page was an admin looking at a salesperson's book
 * with no indication of whose session it was. Naming the account before offering
 * the button turns a confusing screen into a legible one.
 *
 * NOTHING HERE MAY THROW. It is the last thing that works when other things are
 * broken, so every lookup is wrapped and every failure degrades to "we could not
 * read this" with the button still on screen.
 */
export default async function SignOutPage() {
  let email: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    email = data.user?.email ?? null
  } catch {
    // Leave it null — "we could not read your session" below is a true and
    // useful thing to say, and the button still works without it.
  }

  // readImpersonation() throws if the signing secret is absent. On any other
  // page that is a loud, correct failure; here it would break the exit.
  let imp = null
  try {
    imp = await readImpersonation()
  } catch {
    imp = null
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Sign out of SOCC</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {email ? (
            <>
              You are signed in as <span className="font-medium text-foreground">{email}</span>.
            </>
          ) : (
            <>We could not read your session. Signing out will clear it anyway.</>
          )}
        </p>
      </div>

      {imp && (
        /* The better action, offered first. Signing out works too, but it costs
           the admin a fresh sign-in for something that is one click to undo. */
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5 text-[13px] text-amber-900 dark:text-amber-200">
          <p>
            You are viewing as <span className="font-semibold">{imp.subjectEmail}</span>. You are
            still <span className="font-semibold">{imp.adminEmail}</span> — hand the session back
            rather than signing out.
          </p>
          <StopImpersonatingButton className="mt-2.5" />
        </div>
      )}

      <div className="flex items-center gap-3">
        <SignOutButton className="rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50" />
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
      </div>

      <p className="text-xs text-muted-foreground">
        Signing out clears your session and, if one is set, the “viewing as” cookie. Bookmark{' '}
        <code className="rounded border border-border px-1 py-0.5 text-[11px]">/signout</code> — it
        works from every view, including ones that will not let you navigate anywhere else.
      </p>
    </main>
  )
}

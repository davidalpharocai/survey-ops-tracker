import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'
import { SalesNav } from '@/components/sales/SalesNav'
import { createClient } from '@/lib/supabase/server'
import { mySalespersonName } from '@/lib/sales-auth'

export const dynamic = 'force-dynamic'

/**
 * Shell for the sales tier — a sibling of (portal), not a variant of (app).
 *
 * Separate on purpose. (app)'s layout, nav and every page inside it assume an
 * analyst: the ribbon links to the board, Admin, the assistant, and a dozen
 * surfaces a salesperson has no rows for. Reusing it would mean auditing all of
 * them for what renders to a non-analyst, which is exactly the audit David
 * declined when he chose a hard boundary over narrowing the existing app.
 *
 * The ribbon used to be a static "AlphaROC / Sales" breadcrumb, with a comment
 * saying tabs would be "a promise of navigation that does not exist yet". The
 * navigation exists now — Surveys, Accounts, Contacts, What's new — so the
 * promise is kept rather than withdrawn.
 *
 * The name is resolved HERE rather than per page, because the ribbon shows it on
 * every screen and three pages each doing their own lookup is three round trips
 * for one string. Failure is silent: a missing name drops the label, it does not
 * break the shell.
 */
export default async function SalesShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // No gate here — each page calls requireSalesUser, which redirects. A layout
  // that also redirected would race with it and could bounce a legitimate user
  // mid-navigation.
  const name = user?.email ? await mySalespersonName(supabase, user.email) : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Above the nav, not inside it: an admin viewing as a salesperson must
          see it before they read a single number. Renders nothing when nobody
          is impersonating. */}
      <ImpersonationBanner />
      <SalesNav name={name} />
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}

import { ImpersonationBanner } from '@/components/shared/ImpersonationBanner'

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
 * Deliberately plain. There is one page behind it today, so a ribbon of tabs
 * would be a promise of navigation that does not exist yet.
 */
export default function SalesShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Above the nav, not inside it: an admin viewing as a salesperson must
          see it before they read a single number. Renders nothing when nobody
          is impersonating. */}
      <ImpersonationBanner />
      <nav className="flex items-center gap-3 border-b border-border bg-card px-6 py-3">
        <span className="text-sm font-bold">AlphaROC</span>
        <span className="text-sm text-muted-foreground/60">/</span>
        <span className="text-sm text-muted-foreground">Sales</span>
      </nav>
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  )
}

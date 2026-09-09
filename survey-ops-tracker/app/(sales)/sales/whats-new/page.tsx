import { requireSalesUser } from '@/lib/sales-auth'
import { changelogFor } from '@/lib/changelog/entries'

export const dynamic = 'force-dynamic'

/**
 * What's new, for the sales tier.
 *
 * Renders changelogFor('all'), NEVER the CHANGELOG array. That distinction is a
 * disclosure boundary, not a formatting choice: the full changelog contains our
 * spend figures ("understating what we actually spend by about $4,500"), what
 * clients pay and the resulting margin, the names of who holds the finance role,
 * a previously-disclosed vulnerability, and a bullet stating outright that an
 * internal target exists distinct from the client-facing one — the single fact
 * David asked to keep from sales. Tagging is default-deny, so an untagged bullet
 * added later stays internal without anyone having to remember.
 *
 * Deliberately NOT the (app) changelog component: that one renders the array
 * directly, and reusing it would be one import away from undoing all of the
 * above. lib/changelog/audience.test.ts asserts the boundary.
 */
export default async function SalesWhatsNewPage() {
  await requireSalesUser('/sales/whats-new')
  const entries = changelogFor('all')

  const KIND: Record<string, string> = {
    NEW: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    IMPROVED: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
    FIXED: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">What&apos;s new</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Changes to your workspace, newest first.
      </p>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          Nothing new yet.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {entries.map(e => (
            <section key={e.date}>
              <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {new Date(e.date + 'T12:00:00Z').toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                })}
              </h2>
              <ul className="flex flex-col gap-2.5">
                {e.changes.map((c, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide ${KIND[c.kind] ?? 'bg-muted text-muted-foreground'}`}
                    >
                      {c.kind}
                    </span>
                    <span className="text-sm leading-relaxed text-foreground">{c.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

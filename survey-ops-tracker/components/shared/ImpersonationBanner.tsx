import { readImpersonation } from '@/lib/auth/impersonation'
import { StopImpersonatingButton } from './StopImpersonatingButton'

/**
 * The bar that says you are not yourself.
 *
 * Server component, reading the httpOnly signed cookie directly — so it cannot
 * be suppressed by anything in the browser, and there is no window during
 * hydration where the app looks like a normal session.
 *
 * DELIBERATELY LOUD, and deliberately amber rather than red. The risk this
 * guards against is not damage — the session cannot write, because only the
 * read-only tiers can be impersonated — it is an admin reading someone else's
 * scoped data and mistaking it for the whole picture. "Alex sees 20 open
 * surveys" is a true and useful sentence; "there are only 20 open surveys" is
 * false, and one glance at the top of the page should be enough to tell them
 * apart. Red would say something is broken, which nothing is.
 *
 * Renders nothing at all when not impersonating, so it costs one cookie read on
 * pages that will never show it.
 */
export async function ImpersonationBanner() {
  const imp = await readImpersonation()
  if (!imp) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-[13px] text-amber-900 dark:text-amber-200"
    >
      <span aria-hidden className="text-base leading-none">👁</span>
      <span>
        Viewing as <span className="font-semibold">{imp.subjectEmail}</span>
        <span className="text-amber-800/70 dark:text-amber-300/70"> ({imp.subjectRole})</span>
      </span>
      {/* Says WHY it is read-only, not just that it is. An admin who reads
          "read-only" with no reason tends to assume it is a UI restriction they
          can click past; naming the database makes it clear there is nothing to
          click past. */}
      <span className="text-amber-800/70 dark:text-amber-300/70">
        · read-only — this tier can only read, enforced by the database
      </span>
      <span className="text-amber-800/70 dark:text-amber-300/70">
        · you are still {imp.adminEmail}
      </span>
      <StopImpersonatingButton className="ml-auto" />
    </div>
  )
}

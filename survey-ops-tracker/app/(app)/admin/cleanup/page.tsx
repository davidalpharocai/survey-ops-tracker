import { CleanupDashboard } from '@/components/admin/cleanup/CleanupDashboard'
import { loadCleanup } from './load'

/**
 * /admin/cleanup — the data-cleanup dashboard.
 *
 * ── WHY ITS OWN ROUTE, RATHER THAN A PANEL ON /admin ────────────────────────
 * Three reasons, and each one on its own would have been enough:
 *
 *   · It has a SCOPE and a DRILL. Everything else on /admin is a list you read;
 *     this is a view you change (the legacy-import toggle, the group filter, a
 *     modal per tile). A panel with its own filter state inside a page of five
 *     other panels is where "why does the admin page say something different
 *     from the cleanup card" starts.
 *   · It is a SERVER read of six tables — survey_projects twice, four child
 *     tables, plus the accounts list — and /admin is a client page that loads
 *     none of them. Inlining it would make every visit to Admin (roster,
 *     recently deleted, system status) pay for a read it does not use.
 *   · David will live in it while he drives the tiles to zero, so it deserves
 *     an address he can bookmark and send to someone.
 *
 * The admin area is not fragmented by this: /admin links to it from the
 * existing Data health card, which is the same question asked shallowly.
 *
 * ── THE GATE IS THE ONE THAT WAS ALREADY THERE ──────────────────────────────
 * app/(app)/layout.tsx: signed in, an @alpharoc.ai address, and the analyst
 * tier — sales is redirected to /sales before this file ever runs. No second
 * gate here, and none is needed: the one restricted column in the select
 * (`n_internal_target`, never rendered) is analyst-readable, and every figure
 * on the page is a count.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Data cleanup' }

export default async function AdminCleanupPage() {
  const data = await loadCleanup()
  return <CleanupDashboard data={data} />
}

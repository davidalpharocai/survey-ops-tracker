import Link from 'next/link'
import { Suspense } from 'react'
import { requireSalesUser, mySalesIdentity } from '@/lib/sales-auth'
import { salesHeaderLabel, bookOwner } from '@/lib/sales/identity'
import { todayET } from '@/lib/sales/dateRange'
import { SalesInsights } from '@/components/sales/SalesInsights'
import type { SalesProjectRow } from '@/lib/sales/insights'

export const dynamic = 'force-dynamic'

/**
 * /sales/insights — how the book is doing, as opposed to what needs doing.
 *
 * David, 2026-09-30: "in the sales view, they should be able to see an insights
 * type of dashboard catered to their book as well."
 *
 * It does not overlap /sales/home, deliberately. Home is today: what is late,
 * what is due, what needs a reply. This is the look back: what was delivered
 * over a period, for which accounts, how fast, and how much of it landed on
 * time. Same book, opposite direction in time.
 *
 * Reads `sales_projects` and `sales_clients`, NOT the base tables. That is the
 * whole security design and it is not interchangeable — see migration 102. The
 * view is a definer projection with an explicit column allowlist that does its
 * own scoping, and 102 dropped both sales policies on survey_projects, so it is
 * the only path a sales session has to a project row. There is no `.eq()` here
 * that a later edit could drop: the absence of a filter is the design.
 *
 * SELECT '*', NOT A COLUMN LIST. Migration 130 adds is_placeholder, greenlit_at
 * and cancelled_at to the view and is applied BY HAND. PostgREST rejects a
 * whole select that names a column the schema has not got, so naming them here
 * would take this page dark until the SQL ran, instead of degrading. `*` is
 * safe on this view in a way it would never be on survey_projects: the view IS
 * the allowlist, and the money columns are not in it.
 *
 * A FAILED READ IS NOT AN EMPTY BOOK. `?? []` on an unchecked error would draw
 * a dashboard reading "nothing delivered" — the worst possible lie to tell a
 * salesperson about their own year. Both reads are checked.
 */

function Blocked({ what }: { what: string[] }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <p>Blocked: {what.join(', ')} did not load, so no figures can be shown.</p>
      <p className="mt-1 text-xs">
        {/* force-dynamic, so following the link re-runs the reads. */}
        <Link href="/sales/insights" className="font-medium underline underline-offset-2 hover:opacity-80">Try again</Link>
        <span className="text-destructive/80"> · If it keeps happening, contact your AlphaROC administrator.</span>
      </p>
    </div>
  )
}

export default async function SalesInsightsPage() {
  const { supabase, user } = await requireSalesUser('/sales/insights')
  const identity = await mySalesIdentity(supabase, user.email)
  const name = salesHeaderLabel(identity)
  const owner = bookOwner(identity)

  const [projectsRes, accountsRes] = await Promise.all([
    supabase.from('sales_projects').select('*'),
    supabase.from('sales_clients').select('id, name'),
  ])

  const failed = [
    projectsRes.error && 'sales_projects',
    accountsRes.error && 'sales_clients',
  ].filter((x): x is string => !!x)

  const rows = (projectsRes.data ?? []) as unknown as SalesProjectRow[]
  const accounts = Object.fromEntries(
    ((accountsRes.data ?? []) as { id: string; name: string | null }[])
      .map(c => [c.id, c.name?.trim() || '(unnamed account)'] as const),
  )

  // Eastern time, decided here so every figure on the page and every date in
  // the rest of the sales shell agree. The server's clock is UTC, a day ahead
  // after 8pm ET.
  const today = todayET()

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Insights</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>

      {failed.length ? (
        <Blocked what={failed} />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          There are no studies on your book yet, so there is nothing to measure.
        </p>
      ) : (
        // The filter lives in the URL, and useSearchParams needs a Suspense
        // boundary in the app router.
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <SalesInsights rows={rows} accounts={accounts} owner={owner} today={today} />
        </Suspense>
      )}
    </div>
  )
}

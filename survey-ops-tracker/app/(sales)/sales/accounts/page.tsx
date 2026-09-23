import { Suspense } from 'react'
import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { countBuckets } from '@/lib/sales/buckets'
import { creditPosition, type Term } from '@/lib/sales/credits'
import { AccountsTable, type AccountRow } from '@/components/sales/AccountsTable'

export const dynamic = 'force-dynamic'

/**
 * The salesperson's accounts.
 *
 * Reads sales_clients and sales_projects (migrations 105 and 102), both
 * self-scoping, so there is no `.eq()` here that a later edit could drop.
 *
 * A LIST, NOT A TABLE OF NAMES. An account row that says only "Citadel" makes
 * the reader click through to learn anything, and with 27 accounts that is 27
 * clicks to answer "where is the work". So each row carries the counts that
 * decide whether it is worth opening, computed from the same bucketOf() the
 * surveys list uses so the two screens can never disagree.
 *
 * THE COUNTING IS countBuckets(), NOT A LOCAL REDUCE. The local version counted
 * into a `Record<string, number>`, which type-checks against any key at all, so
 * when the bucket ids were renamed this page kept reading `buckets.completed`
 * and every account's Delivered column silently read 0 for four days — 61 of 79
 * accounts, all 334 delivered surveys. `Record<BucketId, number>` makes the
 * wrong key a compile error instead of a wrong number on screen.
 */
export default async function SalesAccountsPage() {
  const { supabase, user } = await requireSalesUser('/sales/accounts')
  const name = await mySalespersonName(supabase, user.email)

  const [{ data: clients, error: cErr }, { data: projects, error: pErr }, { data: contacts }, terms] =
    await Promise.all([
      supabase.from('sales_clients').select('id, name, code, created_at').order('name'),
      // board_column, n_collected and n_actual are here for hasDrawn(): a credit
      // is consumed when the survey FIELDS (migration 100), so the stage is part
      // of the credit arithmetic, not decoration.
      supabase.from('sales_projects')
        .select('id, client_id, board_column, status, phase, delivered_at, deliver_date, credits, term_id, n_collected, n_actual'),
      supabase.from('sales_contacts').select('id, client_id'),
      // Terms are a separate, optional read: client_terms arrived in migration
      // 100 and carries only one row in production today, so a failure here must
      // cost the credit columns and nothing else.
      supabase.from('sales_terms').select('id, client_id, name, credits_total, starts_on, renews_on')
        .then(r => (r.error ? null : r.data), () => null),
    ])

  // Resolved once on the server, so every account's "current term" is decided
  // against the same date — two accounts evaluated either side of midnight would
  // otherwise disagree about which term is running.
  const today = new Date().toLocaleDateString('en-CA')

  const rows: AccountRow[] = (clients ?? []).map(c => {
    const own = (projects ?? []).filter(p => p.client_id === c.id)
    const b = countBuckets(own)
    const myTerms = ((terms ?? []) as (Term & { client_id: string })[]).filter(t => t.client_id === c.id)
    const cr = creditPosition(own, myTerms, today)
    return {
      id: c.id,
      name: c.name ?? '(unnamed)',
      code: c.code,
      total: own.length,
      active: b.active,
      scoping: b.scoping,
      delivered: b.delivered,
      hold: b.hold,
      cancelled: b.cancelled,
      contacts: (contacts ?? []).filter(x => x.client_id === c.id).length,
      creditsTerm: cr.usedThisTerm,
      creditsRemaining: cr.remaining,
      creditsAllTime: cr.usedAllTime,
      creditsCommitted: cr.committed,
      unpriced: cr.unpriced,
      termName: cr.term?.name ?? null,
    }
  })

  // sales_clients scopes on ACCOUNT ownership only (105), while sales_projects
  // has two arms — account-owned OR named as the project's salesperson (102).
  // So a survey can be visible to this reader while its account is not, and
  // filtering projects into account rows drops it silently. Measured today:
  // Alex 0, Jenna 3, Vineet 9, Shanu 1. Small, but the page's own total would
  // otherwise disagree with the surveys list for no visible reason. Adding an
  // account ROW for an account the reader does not own would be a scope change;
  // saying so is not.
  const owned = new Set((clients ?? []).map(c => c.id))
  const offBook = (projects ?? []).filter(p => !p.client_id || !owned.has(p.client_id)).length

  const failed = cErr || pErr

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Your accounts</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>

      {failed && (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your accounts. Try again, or tell David if it keeps happening.
        </p>
      )}

      {!failed && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {name
            ? `No accounts are assigned to ${name} yet — ask David to set the owner on your clients.`
            : 'Your account is not linked to a salesperson yet — ask David to finish setting it up.'}
        </p>
      )}

      {rows.length > 0 && (
        // useSearchParams needs a Suspense boundary in an App Router page that
        // is otherwise server-rendered.
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <AccountsTable rows={rows} offBook={offBook} />
        </Suspense>
      )}
    </div>
  )
}

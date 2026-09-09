import Link from 'next/link'
import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'
import { bucketOf } from '@/lib/sales/buckets'

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
 * decide whether it is worth opening: how much is live, how much is being
 * scoped, and what has been delivered. Those three are the same breakdown David
 * asked for on the surveys list, computed from the same bucketOf() so the two
 * screens can never disagree.
 */
export default async function SalesAccountsPage() {
  const { supabase, user } = await requireSalesUser('/sales/accounts')
  const name = await mySalespersonName(supabase, user.email)

  const [{ data: clients, error: cErr }, { data: projects, error: pErr }, { data: contacts }] =
    await Promise.all([
      supabase.from('sales_clients').select('id, name, code, created_at').order('name'),
      supabase.from('sales_projects').select('id, client_id, board_column, status, phase, delivered_at, deliver_date, credits'),
      supabase.from('sales_contacts').select('id, client_id'),
    ])

  const rows = (clients ?? []).map(c => {
    const own = (projects ?? []).filter(p => p.client_id === c.id)
    // bucketOf returns the BucketId — 'active' | 'scoping' | 'completed' |
    // 'hold' | 'closed' — and NOT the display label. Reading acc['Active'] here
    // would quietly count zero for every account.
    const buckets = own.reduce<Record<string, number>>((acc, x) => {
      const b = bucketOf({ status: x.status, phase: x.phase, board_column: x.board_column })
      acc[b] = (acc[b] ?? 0) + 1
      return acc
    }, {})
    return {
      ...c,
      total: own.length,
      active: buckets.active ?? 0,
      scoping: buckets.scoping ?? 0,
      delivered: buckets.completed ?? 0,
      // Σ over surveys that have a credit figure. NULL credits are skipped, not
      // read as 0 — "not priced yet" is not "free", and summing them as zero
      // would understate a client's consumption and make the number a lie in
      // the one place it is shown TO the client.
      credits: own.reduce((t, p) => t + (p.credits ?? 0), 0),
      creditsUnknown: own.filter(p => p.credits == null).length,
      contacts: (contacts ?? []).filter(x => x.client_id === c.id).length,
    }
  })

  const failed = cErr || pErr

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Your accounts</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {rows.length > 0
          ? `${rows.length} account${rows.length === 1 ? '' : 's'}, ${fmtNum(rows.reduce((t, r) => t + r.total, 0))} surveys between them.`
          : 'Every client whose account you own.'}
      </p>

      {failed && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 text-right font-medium">Surveys</th>
                <th className="px-3 py-2 text-right font-medium">Active</th>
                <th className="px-3 py-2 text-right font-medium">Scoping</th>
                <th className="px-3 py-2 text-right font-medium">Delivered</th>
                <th className="px-3 py-2 text-right font-medium">Credits</th>
                <th className="px-3 py-2 text-right font-medium">Contacts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/sales/accounts/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    {r.code && <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.active || <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.scoping || <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.delivered || <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.credits ? fmtNum(r.credits) : <span className="text-muted-foreground/40">—</span>}
                    {/* A total drawn from a partly-priced set is a FLOOR, and
                        saying so is the difference between a number and a
                        misleading number. */}
                    {r.creditsUnknown > 0 && r.total > 0 && (
                      <span className="ml-1 text-[10px] text-muted-foreground" title={`${r.creditsUnknown} of ${r.total} surveys have no credit figure yet, so this total is a floor.`}>
                        +?
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.contacts || <span className="text-muted-foreground/40">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

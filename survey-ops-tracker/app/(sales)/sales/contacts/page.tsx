import Link from 'next/link'
import { requireSalesUser } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'

export const dynamic = 'force-dynamic'

/**
 * Every contact on the salesperson's accounts.
 *
 * Reads sales_contacts (migration 105), which is scoped through the owning
 * account and already excludes archived contacts and the internal
 * occam_invited_* onboarding flags.
 *
 * WHY THIS IS A TOP-LEVEL PAGE at all, when contacts also live on the account
 * page: the two answer different questions. The account page answers "who do I
 * know at Citadel"; this answers "who is Jared and which account is he on" —
 * the question you have when a name lands in your inbox. That is the same reason
 * Salesforce and HubSpot both carry a Contacts object alongside the Account
 * record rather than folding one into the other.
 *
 * Sorted by account then surname, because the reader scans for a company first.
 */
export default async function SalesContactsPage() {
  const { supabase } = await requireSalesUser('/sales/contacts')

  const [{ data: contacts, error }, { data: clients }, { data: projects }] = await Promise.all([
    supabase.from('sales_contacts').select('id, client_id, first_name, last_name, email, title, phone'),
    supabase.from('sales_clients').select('id, name'),
    supabase.from('sales_projects').select('id, requested_by_contact_id'),
  ])

  const clientName = new Map((clients ?? []).map(c => [c.id, c.name]))
  const requestCount = new Map<string, number>()
  for (const p of projects ?? []) {
    if (p.requested_by_contact_id) {
      requestCount.set(p.requested_by_contact_id, (requestCount.get(p.requested_by_contact_id) ?? 0) + 1)
    }
  }

  const rows = (contacts ?? [])
    .map(c => ({
      ...c,
      account: clientName.get(c.client_id) ?? '—',
      // What earns a contact its place on this list beyond a name: how much
      // work they have actually asked for. That is the relationship, and it is
      // the one column here a CRM would call a signal.
      requested: requestCount.get(c.id) ?? 0,
    }))
    .sort((a, b) =>
      a.account.localeCompare(b.account) ||
      (a.last_name ?? '').localeCompare(b.last_name ?? '') ||
      (a.first_name ?? '').localeCompare(b.first_name ?? '')
    )

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Your contacts</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {rows.length > 0
          ? `${fmtNum(rows.length)} contact${rows.length === 1 ? '' : 's'} across ${new Set(rows.map(r => r.client_id)).size} accounts.`
          : 'Everyone we know at the clients you own.'}
      </p>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your contacts. Try again, or tell David if it keeps happening.
        </p>
      )}

      {!error && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No contacts recorded on your accounts yet.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 text-right font-medium">Surveys requested</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/sales/accounts/${c.client_id}`} className="hover:underline">
                      {c.account}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{c.title || '—'}</td>
                  <td className="px-3 py-2">
                    {c.email ? (
                      // A real mailto, because the reason you look a contact up
                      // is usually to write to them.
                      <a href={`mailto:${c.email}`} className="text-muted-foreground hover:text-foreground hover:underline">
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.requested || <span className="text-muted-foreground/40">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

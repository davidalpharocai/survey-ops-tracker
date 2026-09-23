import { Suspense } from 'react'
import { requireSalesUser } from '@/lib/sales-auth'
import { ContactsTable, type ContactRow } from '@/components/sales/ContactsTable'

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

  const rows: ContactRow[] = (contacts ?? [])
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
      <h1 className="mb-4 text-xl font-semibold">Your contacts</h1>

      {error && (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your contacts. Try again, or tell David if it keeps happening.
        </p>
      )}

      {!error && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No contacts recorded on your accounts yet.
        </p>
      )}

      {rows.length > 0 && (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <ContactsTable rows={rows} />
        </Suspense>
      )}
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { AccountDetail } from '@/components/sales/AccountDetail'

export const dynamic = 'force-dynamic'

/**
 * One account: its contacts, its surveys, and its credit position.
 *
 * The server half is deliberately thin — fetch through the self-scoping views
 * and hand the rows to a client component, because everything interesting here
 * (the date-range filter, the column picker, the export) is interaction, and
 * round-tripping a filter change to the server for ~40 rows would be slower and
 * would lose the user's place.
 *
 * All three reads go through sales_* views (102, 105). An account outside this
 * salesperson's book is not in sales_clients, so it 404s rather than rendering
 * with its fields blanked — and "not found" is the right answer, since
 * distinguishing it from "not yours" would confirm the account exists.
 */
export default async function SalesAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireSalesUser(`/sales/accounts/${id}`)

  const [{ data: client }, { data: projects }, { data: contacts }, { data: terms }] = await Promise.all([
    supabase.from('sales_clients').select('id, name, code, salesperson, created_at').eq('id', id).maybeSingle(),
    supabase
      .from('sales_projects')
      .select('id, project_code, project_name, board_column, status, phase, n_target, n_target_max, n_collected, n_actual, credits, submitted_date, launch_date, deliver_date, delivered_at, requested_by_name, longitudinal, rerun_number')
      .eq('client_id', id)
      .order('deliver_date', { ascending: false, nullsFirst: false }),
    supabase.from('sales_contacts').select('id, first_name, last_name, email, title, phone').eq('client_id', id),
    supabase.from('sales_terms').select('id, name, credits_total, starts_on, renews_on').eq('client_id', id),
  ])

  if (!client) notFound()

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/sales/accounts" className="hover:text-foreground hover:underline">Accounts</Link>
        <span>/</span>
        <span className="text-foreground">{client.name}</span>
      </nav>

      <AccountDetail
        client={client}
        projects={projects ?? []}
        contacts={contacts ?? []}
        terms={terms ?? []}
      />
    </div>
  )
}

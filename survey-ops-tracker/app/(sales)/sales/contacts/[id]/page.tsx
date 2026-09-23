import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'
import { stageOf, stageTone } from '@/lib/sales/stage'
import { countBuckets } from '@/lib/sales/buckets'

export const dynamic = 'force-dynamic'

/**
 * One contact, as a salesperson sees them.
 *
 * THIS ROUTE EXISTS BECAUSE THE ASK REQUIRED IT. David, 2026-09-17: "values
 * should be clickable or at the very least i click anywhere in the row and it
 * takes me to the contact." There was nowhere to take them — app/(sales) had
 * exactly two dynamic routes, accounts/[id] and surveys/[id], and no contact
 * page. The global sales search already conceded the gap: it classifies a hit as
 * a Contact and then navigates to the ACCOUNT, because that was the only
 * destination available.
 *
 * The analyst equivalent at app/(app)/contacts/[id] is the right SHAPE and
 * cannot be reused: the (app) layout redirects a sales role before rendering,
 * and migration 105 left the sales tier no access to the tables it reads.
 *
 * SCOPE: sales_contacts is reachable only through an account the reader owns
 * (105), which is a NARROWER rule than sales_projects, whose second arm also
 * matches a project naming you as salesperson (102). So a salesperson can see a
 * survey whose requester they cannot open. That asymmetry is the view's, not
 * this page's, and the honest handling is a 404 — the same answer "not yours"
 * and "does not exist" both get everywhere else in this tier.
 */
export default async function SalesContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireSalesUser(`/sales/contacts/${id}`)

  const { data: contact, error } = await supabase
    .from('sales_contacts')
    .select('id, client_id, first_name, last_name, email, title, phone, created_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !contact) notFound()

  const [{ data: account }, { data: projects }] = await Promise.all([
    supabase.from('sales_clients').select('id, name, code').eq('id', contact.client_id).maybeSingle(),
    // Attributed by requested_by_contact_id ONLY. requested_by_name is a free
    // text field and matching on it would attribute one person's work to
    // another who happens to share a name — measured, two rows share "Vance
    // Reavie" across different accounts.
    supabase
      .from('sales_projects')
      .select('id, project_code, project_name, board_column, status, phase, scoping_stage, n_target, n_collected, n_actual, credits, submitted_date, deliver_date, delivered_at')
      .eq('requested_by_contact_id', id)
      .order('deliver_date', { ascending: false, nullsFirst: false }),
  ])

  const rows = projects ?? []
  const b = countBuckets(rows)
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed contact'

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/sales/contacts" className="hover:text-foreground hover:underline">Contacts</Link>
        <span>/</span>
        <span className="text-foreground">{name}</span>
      </nav>

      <h1 className="mb-1 text-xl font-semibold">{name}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {contact.title && <>{contact.title} · </>}
        {account ? (
          <Link href={`/sales/accounts/${account.id}`} className="hover:text-foreground hover:underline">
            {account.name}
          </Link>
        ) : (
          '—'
        )}
      </p>

      <div className="mb-5 grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Contact</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Email</dt>
              <dd className="truncate text-sm">
                {contact.email
                  ? <a href={`mailto:${contact.email}`} className="hover:underline">{contact.email}</a>
                  : <span className="text-muted-foreground/50">—</span>}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Phone</dt>
              <dd className="truncate text-sm">
                {contact.phone
                  ? <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a>
                  : <span className="text-muted-foreground/50">—</span>}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            What they have asked for
          </h2>
          <p className="text-sm text-foreground">
            {rows.length === 0
              ? 'No survey on your book records this person as the requester.'
              : `${fmtNum(rows.length)} survey${rows.length === 1 ? '' : 's'} — ` +
                ([['delivered', 'delivered'], ['active', 'active'], ['scoping', 'scoping'],
                  ['hold', 'on hold'], ['cancelled', 'cancelled'], ['archived', 'archived']] as const)
                  .filter(([k]) => b[k]).map(([k, l]) => `${b[k]} ${l}`).join(', ')}
          </p>
          {rows.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Surveys are attributed by the Requested-by field, not by name — work
              logged against a free-text name rather than this record will not appear.
            </p>
          )}
        </section>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Survey</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 text-right font-medium">N Target</th>
                <th className="px-3 py-2 text-right font-medium">N Collected</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/sales/surveys/${p.id}`} className="font-medium hover:underline">
                      {p.project_code ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/sales/surveys/${p.id}`} className="hover:underline">{p.project_name}</Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${stageTone(p)}`}>
                      {stageOf(p)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.n_target == null ? <span className="text-muted-foreground/40">—</span> : fmtNum(p.n_target)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.n_actual ?? p.n_collected ?? <span className="text-muted-foreground/40">—</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {(p.delivered_at ?? '').slice(0, 10) || p.deliver_date || '—'}
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

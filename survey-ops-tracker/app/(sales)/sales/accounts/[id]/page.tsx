import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { AccountDetail, type AccountProject } from '@/components/sales/AccountDetail'

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
 * All reads go through sales_* views (102, 105, 111). An account outside this
 * salesperson's book is not in sales_clients, so it 404s rather than rendering
 * with its fields blanked — and "not found" is the right answer, since
 * distinguishing it from "not yours" would confirm the account exists.
 *
 * A FAILED READ IS NOT AN EMPTY ACCOUNT. This page used to take only `data`
 * from each read and default it to [], so a failed sales_terms read showed "No
 * term recorded" and a failed sales_projects read "0 surveys" — while the PDF
 * route, reading the same views, said "Blocked". Now it says what did not load,
 * the way the print route does. The one exception is freshness (111): losing
 * it only means no Collected cell is marked "never recorded", which is what
 * the PDF does too.
 *
 * No `.order()` on the surveys: AccountDetail sorts them with the statement's
 * own sortForStatement, so this table and the PDF list them the same way round.
 */
const PROJECT_COLS =
  'id, project_code, project_name, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, term_id, submitted_date, launch_date, deliver_date, delivered_at, requested_by_name, longitudinal, rerun_number'

function Blocked({ what, id }: { what: string[]; id: string }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      <p>Blocked: {what.join(', ')} did not load, so this account cannot be shown yet.</p>
      <p className="mt-1 text-xs">
        {/* The page is force-dynamic, so following the link re-runs the reads. */}
        <Link href={`/sales/accounts/${id}`} className="font-medium underline underline-offset-2 hover:opacity-80">Try again</Link>
        <span className="text-destructive/80"> · If it keeps happening, contact your AlphaROC administrator.</span>
      </p>
    </div>
  )
}

export default async function SalesAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireSalesUser(`/sales/accounts/${id}`)

  const [clientRes, projectsRes, contactsRes, termsRes] = await Promise.all([
    supabase.from('sales_clients').select('id, name, code, salesperson, created_at').eq('id', id).maybeSingle(),
    supabase.from('sales_projects').select(PROJECT_COLS).eq('client_id', id),
    supabase.from('sales_contacts').select('id, first_name, last_name, email, title, phone').eq('client_id', id),
    supabase.from('sales_terms').select('id, name, credits_total, starts_on, renews_on').eq('client_id', id),
  ])

  if (clientRes.error) return <Blocked what={['sales_clients']} id={id} />
  const client = clientRes.data
  if (!client) notFound()
  const failed = [
    projectsRes.error && 'sales_projects', contactsRes.error && 'sales_contacts', termsRes.error && 'sales_terms',
  ].filter((x): x is string => !!x)
  if (failed.length) return <Blocked what={failed} id={id} />

  const projects = (projectsRes.data ?? []) as unknown as AccountProject[]

  // N-collected freshness (migration 111), for this account's surveys: the
  // same read the PDF route makes, so a count that was never entered shows a
  // dash here exactly as it does on paper. Cast because 111 is applied by
  // hand and the generated types lag it.
  const ids = projects.map(p => p.id)
  const freshRes = ids.length
    ? await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            in: (col: string, v: string[]) => Promise<{ data: { project_id: string }[] | null; error: unknown }>
          }
        }
      }).from('sales_n_collected_freshness').select('project_id').in('project_id', ids)
    : { data: [], error: null }
  const seen = new Set((freshRes.data ?? []).map(f => f.project_id))
  const neverRecordedIds = freshRes.error ? [] : ids.filter(i => !seen.has(i))

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/sales/accounts" className="hover:text-foreground hover:underline">Accounts</Link>
        <span>/</span>
        <span className="text-foreground">{client.name}</span>
      </nav>

      <AccountDetail
        client={client}
        projects={projects}
        contacts={contactsRes.data ?? []}
        terms={termsRes.data ?? []}
        neverRecordedIds={neverRecordedIds}
      />
    </div>
  )
}

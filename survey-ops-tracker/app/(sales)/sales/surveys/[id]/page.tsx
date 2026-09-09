import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange } from '@/lib/utils/nRange'

export const dynamic = 'force-dynamic'

/**
 * One survey, as a salesperson sees it.
 *
 * THIS PAGE EXISTS BECAUSE ITS ABSENCE WAS A BUG. Every survey name in the
 * pipeline was a Link to /projects/[id], which lives under app/(app)/ — whose
 * layout does `if (profile?.role === 'sales') redirect('/sales')` before it
 * renders anything. So the one interaction the sales portal offered bounced the
 * user straight back to the list they were already looking at. Shipped that way;
 * found by review before Alex hit it.
 *
 * Reads sales_projects, never survey_projects (migration 102): the view carries
 * 33 of 81 columns and does its own scoping, so a survey belonging to someone
 * else 404s here rather than rendering with fields blanked out.
 *
 * WHAT IS DELIBERATELY NOT ON THIS PAGE: cost, budget, margin, the internal
 * target, and the ops notes. Not hidden by this component — absent from the
 * view, so there is nothing here to leak. The one number that needs care is N:
 * `n_target` is the CLIENT-FACING commitment, which is exactly the number a
 * salesperson should quote, and `n_internal_target` (what we actually field
 * above it) is not in the view at all.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm text-foreground">{children}</span>
    </div>
  )
}

const dash = (v: unknown) => (v == null || v === '' ? <span className="text-muted-foreground/50">—</span> : String(v))

export default async function SalesSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireSalesUser(`/sales/surveys/${id}`)

  const { data, error } = await supabase
    .from('sales_projects')
    .select(
      'id, project_code, project_name, client, client_id, project_type, category, objective, phase, status, scoping_stage, board_column, submitted_date, launch_date, due_date, deliver_date, delivered_at, n_target, n_target_max, n_collected, n_actual, credits, requested_by_name, salesperson, longitudinal, rerun_number'
    )
    .eq('id', id)
    .maybeSingle()

  // A row outside this salesperson's book simply is not in the view, so "not
  // found" and "not yours" are the same answer — which is the right answer to
  // give, since distinguishing them would confirm the survey exists.
  if (error || !data) notFound()

  const p = data
  const delivered = p.board_column === 'Delivery' || p.delivered_at != null
  const stage = p.status !== 'Open' ? p.status : delivered ? 'Delivered' : p.board_column

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/sales/surveys" className="hover:text-foreground hover:underline">Surveys</Link>
        <span>/</span>
        <span className="text-foreground">{p.project_code ?? 'Survey'}</span>
      </nav>

      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">{p.project_name}</h1>
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{stage}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        {p.client_id ? (
          <Link href={`/sales/accounts/${p.client_id}`} className="hover:text-foreground hover:underline">
            {p.client}
          </Link>
        ) : (
          p.client
        )}
        {p.project_code && <span className="text-muted-foreground/60"> · {p.project_code}</span>}
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Responses</h2>
          {/* n_target is the client-facing commitment. The internal target is
              not in this view and must never be added to it. */}
          <Row label="Target">{formatNRange(p.n_target, p.n_target_max) || dash(null)}</Row>
          <Row label="Collected">{p.n_collected != null ? fmtNum(p.n_collected) : dash(null)}</Row>
          <Row label="Final count">{p.n_actual != null ? fmtNum(p.n_actual) : dash(null)}</Row>
          <Row label="Credits">{p.credits != null ? fmtNum(p.credits) : dash(null)}</Row>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Dates</h2>
          <Row label="Submitted">{dash(p.submitted_date)}</Row>
          <Row label="Launched">{dash(p.launch_date)}</Row>
          <Row label="Due">{dash(p.due_date)}</Row>
          <Row label="Delivery">{dash(p.delivered_at?.slice(0, 10) ?? p.deliver_date)}</Row>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 md:col-span-2">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">Detail</h2>
          <Row label="Type">{dash(p.project_type)}</Row>
          <Row label="Category">{dash(p.category)}</Row>
          <Row label="Requested by">{dash(p.requested_by_name)}</Row>
          <Row label="Stage">{dash(p.phase === 'Scoping' ? (p.scoping_stage ?? 'Scoping') : p.board_column)}</Row>
          {p.longitudinal && <Row label="Wave">{p.rerun_number ? `Wave ${p.rerun_number}` : 'Recurring'}</Row>}
          {p.objective && (
            <div className="pt-3">
              <p className="mb-1 text-xs text-muted-foreground">Objective</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{p.objective}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

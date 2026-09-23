import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange } from '@/lib/utils/nRange'
import { bucketOf } from '@/lib/sales/buckets'
import { stageOf, stageTone } from '@/lib/sales/stage'
import { deliveredN } from '@/lib/sales/deliveredN'

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
 * Reads sales_projects, never survey_projects (migration 102): the view does its
 * own scoping, so a survey belonging to someone else 404s here rather than
 * rendering with fields blanked out.
 *
 * WHAT IS DELIBERATELY NOT ON THIS PAGE: cost, budget, margin, the internal
 * target, and the ops notes. Not hidden by this component — absent from the
 * view, so there is nothing here to leak. The one number that needs care is N:
 * `n_target` is the CLIENT-FACING commitment, which is exactly the number a
 * salesperson should quote, and `n_internal_target` (what we actually field
 * above it) is not in the view at all.
 *
 * ── TERMINOLOGY ─────────────────────────────────────────────────────────────
 * David, 2026-09-17: "use the same terminology that we use in non-sales SOCC.
 * for example, Final Count vs N Actual". The labels below are taken from
 * FIELD_LABELS in lib/utils/quickFields.ts, which is what the rest of the app
 * and the connector already say. This page had invented "Target", "Collected",
 * "Final count", "Launched", "Due" and "Delivery" for six fields that already
 * had names.
 *
 * ── THE THREE OPTIONAL READS ────────────────────────────────────────────────
 * Captain, N-collected freshness and deliverables each come from a SEPARATE
 * query that is allowed to fail, rather than from extra columns on the main
 * select. Migrations here are applied by hand, and PostgREST rejects the WHOLE
 * select when one named column does not exist yet — so folding `captain_name`
 * into the main select would turn "118 not applied yet" into a 404 on every
 * survey page. This way the page renders and the three lines are simply absent
 * until the migration lands.
 */

const dash = (v: unknown) =>
  v == null || v === '' ? <span className="text-muted-foreground/50">—</span> : String(v)

/** One label/value pair. Compact by default — David: "the screen can be
 *  condensed a little since there isnt so much info". */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground" title={hint}>{children}</dd>
    </div>
  )
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-4 ${className}`}>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

const fileSize = (b: number | null) => {
  if (b == null) return null
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export default async function SalesSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireSalesUser(`/sales/surveys/${id}`)

  const { data, error } = await supabase
    .from('sales_projects')
    .select(
      'id, project_code, project_name, client, client_id, project_type, category, objective, phase, status, scoping_stage, board_column, submitted_date, launch_date, due_date, deliver_date, delivered_at, n_target, n_target_max, n_collected, n_actual, credits, requested_by_name, requested_by_contact_id, salesperson, longitudinal, rerun_number'
    )
    .eq('id', id)
    .maybeSingle()

  // A row outside this salesperson's book simply is not in the view, so "not
  // found" and "not yours" are the same answer — which is the right answer to
  // give, since distinguishing them would confirm the survey exists.
  if (error || !data) notFound()

  const p = data
  // Both halves come from the same place the tiles and the list use, so this
  // badge cannot say something the surveys list disagrees with. The line here
  // used to test `status !== 'Open'` first, and since every delivered survey is
  // also Closed — 334 of 334 — this header read "Closed" on the entire
  // delivered book.
  const delivered = bucketOf(p) === 'delivered'

  // The three optional reads.
  //
  // `lib/supabase/types.ts` is regenerated by hand and lags a migration applied
  // by hand, so it does not yet know sales_deliverables or sales_projects'
  // captain columns. The cast is confined to this one local alias rather than
  // sprinkled through the calls, and every result is still checked — a failed
  // read is "we do not know", rendered as absence, never as a claim.
  const loose = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>
          order: (c: string, o: { ascending: boolean }) => PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>
        }
      }
    }
  }
  const ok = <T,>(r: { data: T; error: unknown }) => (r.error ? null : r.data)

  const [captain, freshness, deliverables] = await Promise.all([
    Promise.resolve(loose.from('sales_projects').select('captain_name, captain_initials, captain_former').eq('id', id).maybeSingle())
      .then(ok, () => null),
    Promise.resolve(loose.from('sales_n_collected_freshness').select('last_updated').eq('project_id', id).maybeSingle())
      .then(ok, () => null),
    Promise.resolve(loose.from('sales_deliverables')
      .select('id, file_name, kind, mime_type, size_bytes, source_url, drive_file_id, filed_at')
      .eq('project_id', id).order('filed_at', { ascending: false }))
      .then(ok, () => null),
  ])

  // The anticipated figure, with its reason — the same estimator the rest of the
  // sales view uses, so this page and the list cannot quote different numbers.
  const dn = deliveredN(p)

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/sales/surveys" className="hover:text-foreground hover:underline">Surveys</Link>
        <span>/</span>
        <span className="text-foreground">{p.project_code ?? 'Survey'}</span>
      </nav>

      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">{p.project_name}</h1>
        <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${stageTone(p)}`}>{stageOf(p)}</span>
        {p.longitudinal && (
          <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {p.rerun_number ? `Wave ${p.rerun_number}` : 'Recurring'}
          </span>
        )}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        {p.client_id ? (
          <Link href={`/sales/accounts/${p.client_id}`} className="hover:text-foreground hover:underline">
            {p.client}
          </Link>
        ) : (
          p.client
        )}
        {p.project_code && <span className="text-muted-foreground/60"> · {p.project_code}</span>}
        {p.project_type && <span className="text-muted-foreground/60"> · {p.project_type}</span>}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Responses">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {/* n_target is the client-facing commitment. The internal target is
                not in this view and must never be added to it. */}
            <Field label="N Target">{formatNRange(p.n_target, p.n_target_max) || dash(null)}</Field>
            <Field label="N Collected">
              {p.n_collected != null ? fmtNum(p.n_collected) : dash(null)}
              {/* David: "N Collected should have a last updated date under it."
                  A MISSING row means it has never been updated, which is not the
                  same as zero — so the two cases read differently. */}
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {freshness?.last_updated
                  ? `updated ${String(freshness.last_updated).slice(0, 10)}`
                  : 'never updated'}
              </span>
            </Field>
            <Field label="N Actual">{p.n_actual != null ? fmtNum(p.n_actual) : dash(null)}</Field>
            <Field label="Credits">{p.credits != null ? fmtNum(p.credits) : dash(null)}</Field>
          </dl>
          {/* Only when it is a projection. Where n_actual is recorded the figure
              above IS the answer and a second number would just compete with it. */}
          {dn?.estimated && (
            <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {/* A survey still in field has not anticipated anything yet --
                    calling its running total "Anticipated N Actual" is what
                    made a 7 look like a 6 one line further down. */}
                {dn.basis === 'still-collecting'
                  ? `Collected so far: ${fmtNum(dn.value)}`
                  : `Anticipated N Actual ≈ ${fmtNum(dn.value)}`}
                {dn.low != null && dn.high != null && ` (${fmtNum(dn.low)}–${fmtNum(dn.high)})`}
              </span>
              <br />
              {dn.note}
            </p>
          )}
        </Card>

        <Card title="Dates">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Submitted">{dash(p.submitted_date)}</Field>
            <Field label="Launch Date">{dash(p.launch_date)}</Field>
            <Field label="Due Date">{dash(p.due_date)}</Field>
            <Field label="Deliver Date">{dash(p.delivered_at?.slice(0, 10) ?? p.deliver_date)}</Field>
          </dl>
        </Card>

        <Card title="Detail" className="md:col-span-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <Field label="Type">{dash(p.project_type)}</Field>
            <Field label="Category">{dash(p.category)}</Field>
            <Field label="Requested by">{dash(p.requested_by_name)}</Field>
            {/* Absent, not blank, until 118 is applied — see the header note. */}
            {captain && (
              <Field label="Captain" hint={(captain.captain_name as string | null) ?? undefined}>
                {dash(captain.captain_name)}
                {/* Said in our own words. The stored name carries a literal
                    "(former employee)" on two of ten team members, covering 76
                    live surveys; 118 strips that and exposes the fact as a flag
                    instead, so the screen can answer "can I still ask them?"
                    without leaking an internal annotation format. */}
                {captain.captain_former === true && (
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    no longer at AlphaROC
                  </span>
                )}
              </Field>
            )}
            <Field label="Salesperson">{dash(p.salesperson)}</Field>
          </dl>
          {p.objective && (
            <div className="mt-4 border-t border-border/60 pt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Objective</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{p.objective}</p>
            </div>
          )}
        </Card>

        {/* David: "once the survey is delivered, they should be able to see
            deliverables attached to the survey". Shown only once delivered —
            before that there is nothing to attach, and an empty panel on every
            in-flight survey reads as something having gone missing. */}
        {delivered && deliverables != null && (
          <Card title="Deliverables" className="md:col-span-2">
            {deliverables.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing filed against this survey yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {deliverables.map((d) => {
                  const href = (d.source_url as string | null)
                    ?? (d.drive_file_id ? `https://drive.google.com/file/d/${String(d.drive_file_id)}/view` : null)
                  const size = fileSize(d.size_bytes as number | null)
                  return (
                    <li key={String(d.id)} className="flex items-baseline justify-between gap-4 py-2">
                      <span className="min-w-0 truncate text-sm">
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground hover:underline">
                            {(d.file_name as string | null) ?? 'Untitled'}
                          </a>
                        ) : (
                          <span className="text-foreground">{(d.file_name as string | null) ?? 'Untitled'}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {size && <>{size} · </>}
                        {String(d.filed_at ?? '').slice(0, 10)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

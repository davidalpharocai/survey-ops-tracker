import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { SalesPipeline, type SalesRow } from '@/components/sales/SalesPipeline'

export const dynamic = 'force-dynamic'

/**
 * The salesperson's own pipeline.
 *
 * Reads `sales_projects`, NOT `survey_projects`. That is the whole security
 * design and it is not interchangeable — see migration 102. The view is a
 * definer projection carrying an allowlist of columns and doing its own
 * scoping, and 102 dropped both sales policies on the base table, so this view
 * is the only path a sales session has to a project row.
 *
 * Until 102 this page relied on NOT ASKING for the sensitive columns, which was
 * cosmetic: RLS is row-level and cannot hide a column, so a sales session could
 * read budget, actual_spend and n_internal_target straight off PostgREST. Proved
 * on 2026-09-09 with Alex's own JWT — $124,375 of budget across 26 projects and
 * 84 internal targets, including the DE Shaw 150-vs-100 gap. Do NOT "optimise"
 * this back to the base table.
 *
 * Scoping is still Postgres's job and there is no `.eq()` here that a later edit
 * could drop — the view's WHERE reproduces 093 + 100 exactly. The absence of a
 * filter below is the design, not an omission; verified as Alex with a real
 * token: 241 rows, every one on his accounts.
 *
 * FETCHES EVERY STATUS, not just Open. David asked for "a breakdown between
 * whats been completed, whats being scoped, whats active", and that cannot be
 * computed from a list already filtered to open work. It is ~240 rows for the
 * largest account holder, so one query and client-side filtering beats five
 * round trips.
 */
export default async function SalesPipelinePage() {
  const { supabase, user } = await requireSalesUser('/sales')
  const name = await mySalespersonName(supabase, user.email)

  const { data, error } = await supabase
    .from('sales_projects')
    // One literal string, not concatenated: PostgREST parses the select at
    // compile time for its types, and a `+` defeats that inference — the rows
    // come back as GenericStringError[] and the cast below stops being checked.
    .select(
      'id, project_code, project_name, client, client_id, requested_by_name, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, submitted_date, deliver_date, delivered_at'
    )
    .order('deliver_date', { ascending: true, nullsFirst: false })

  // N-collected freshness, from migration 111's two-column view — the same read
  // /sales/home does, for the same reason: a survey whose count has never been
  // touched must not print its column default as a measured 0. Cast because
  // 111 is applied by hand and the generated types lag it. If this read fails,
  // rows stay unannotated and the cell says nothing special — a failed read is
  // a statement about our access, not about the data.
  const freshRes = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => Promise<{ data: { project_id: string; last_updated: string }[] | null; error: unknown }>
    }
  }).from('sales_n_collected_freshness').select('*')
  const lastUpdated = new Map<string, string>((freshRes.data ?? []).map(f => [f.project_id, f.last_updated]))
  const annotate = (r: SalesRow): SalesRow =>
    freshRes.error ? r : { ...r, n_collected_updated_at: lastUpdated.get(r.id) ?? null }
  const rows = ((data ?? []) as SalesRow[]).map(annotate)

  // Account NAMES for the picker. sales_clients is owner-scoped while
  // sales_projects is owner-OR-named-salesperson, so the two disagree in both
  // directions — which is exactly why the option LIST is built from the rows
  // and this is used only to name them. A failure here costs a nicer label, not
  // a working filter: accountOptions falls back to the shortest label it saw.
  const { data: accountRows } = await supabase
    .from('sales_clients')
    .select('id, name')
  const salesClients = (accountRows ?? []) as { id: string; name: string | null }[]

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Your pipeline</h1>
        {name && <span className="text-sm text-muted-foreground">{name}</span>}
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Every survey on your accounts. Pick a group to filter, search to narrow, and choose your own
        columns.
      </p>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Couldn&apos;t load your surveys. Try again, or tell David if it keeps happening.
        </p>
      )}

      {/* An empty list is ambiguous — no work, or scoping that failed to match?
          Say which, because a salesperson who cannot tell will assume the tool
          is broken, and on the evidence of a blank page, fairly. */}
      {!error && rows.length === 0 && (
        <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          {name
            ? `No surveys are currently on ${name}'s accounts.`
            : 'Your account is not linked to a salesperson yet — ask David to finish setting it up.'}
        </p>
      )}

      {rows.length > 0 && <SalesPipeline rows={rows} salesClients={salesClients} />}
    </div>
  )
}

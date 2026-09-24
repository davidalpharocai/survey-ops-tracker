import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { SurveyListPrint } from '@/components/sales/SurveyListPrint'
import { rangeFor, filterByRange, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import { bucketOf, migrateBucketId, type BucketId } from '@/lib/sales/buckets'
import { stageOf } from '@/lib/sales/stage'
import { inAccounts } from '@/lib/sales/accountIndex'
import type { SalesRow } from '@/components/sales/SalesPipeline'

export const dynamic = 'force-dynamic'

/**
 * Print the CURRENT survey list, across accounts.
 *
 * The account PDF answers "what have you done for Citadel"; this answers
 * "everything you delivered last quarter", which is the more common ask and
 * spans accounts. Same print-route approach as the account export — no PDF
 * library, the browser's own Save as PDF — and the same date-range module, so
 * the two exports cannot drift on what "delivered in Q3" means.
 *
 * The list's filters travel in the URL already, which is what makes this cheap:
 * the print page reads the SAME query parameters the list writes, so "print what
 * I am looking at" is a link, not a second filter UI to keep in step.
 */
export default async function SurveyListPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireSalesUser('/sales/surveys/print')
  const name = await mySalespersonName(supabase, user.email)

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : [])

  // migrateBucketId, as the list does: a bookmarked ?g=completed printed zero rows.
  const bucket = (migrateBucketId(one(sp.g) ?? 'active') ?? 'active') as BucketId | 'all'
  const q = (one(sp.q) ?? '').trim().toLowerCase()
  const clients = many(sp.c)
  const stages = many(sp.st)
  const basis = (['delivered', 'submitted', 'launched'].includes(one(sp.basis) ?? '')
    ? one(sp.basis) : 'delivered') as DateBasis
  const preset = (one(sp.preset) ?? 'all') as PresetId
  const custom: Range = { from: one(sp.from) || null, to: one(sp.to) || null }
  const cols = (one(sp.cols) ?? '').split(',').filter(Boolean)

  const { data } = await supabase
    .from('sales_projects')
    .select('id, project_code, project_name, client, client_id, requested_by_name, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, submitted_date, launch_date, deliver_date, delivered_at')
    .order('deliver_date', { ascending: true, nullsFirst: false })

  // The URL carries account IDs; the page prints account NAMES. Without this
  // the filter line read "Filtered to accounts: 3f2a1c9e-…" — a database key
  // where the client expected to see its own name.
  const { data: clientRows } = await supabase.from('sales_clients').select('id, name')
  const nameById = new Map<string, string>(
    ((clientRows ?? []) as { id: string; name: string | null }[]).map(c => [c.id, c.name ?? c.id]))

  // The list's OWN predicates, imported rather than re-derived. This block used
  // to claim "the same predicates the list applies" while comparing the picker's
  // client_id against the stale `client` label — zero overlap by construction,
  // so every account-filtered export was an empty PDF — and the chips' display
  // labels against raw board_column, where "Delivered" is stored as 'Delivery'
  // and matched nothing. ac6c100 and 53558d8 each changed the list and left
  // this copy behind. A predicate that lives in one place cannot drift from
  // itself.
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
  let rows = ((data ?? []) as SalesRow[]).map(annotate)
  if (bucket !== 'all') rows = rows.filter(r => bucketOf(r) === bucket)
  if (clients.length) rows = rows.filter(r => inAccounts(r, clients))
  if (stages.length) rows = rows.filter(r => stages.includes(stageOf(r)))
  if (q) {
    rows = rows.filter(r =>
      (r.project_name ?? '').toLowerCase().includes(q) ||
      (r.project_code ?? '').toLowerCase().includes(q) ||
      (r.client ?? '').toLowerCase().includes(q) ||
      (r.requested_by_name ?? '').toLowerCase().includes(q))
  }
  const total = rows.length
  const today = new Date().toLocaleDateString('en-CA')
  const range = rangeFor(preset, today, custom)
  const { rows: kept, undated } = filterByRange(rows, basis, range)

  return (
    <SurveyListPrint
      rows={kept}
      totalBeforeDates={total}
      undated={undated}
      basis={basis}
      range={range}
      cols={cols}
      bucket={bucket}
      clients={clients.map(id => nameById.get(id) ?? id)}
      stages={stages}
      search={one(sp.q) ?? ''}
      salesperson={name}
      generatedOn={today}
      generatedBy={user.email ?? ''}
    />
  )
}

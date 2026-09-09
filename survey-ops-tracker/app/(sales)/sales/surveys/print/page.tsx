import { requireSalesUser, mySalespersonName } from '@/lib/sales-auth'
import { SurveyListPrint } from '@/components/sales/SurveyListPrint'
import { rangeFor, filterByRange, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import { bucketOf, type BucketId } from '@/lib/sales/buckets'
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

  const bucket = (one(sp.g) ?? 'active') as BucketId | 'all'
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
    .select('id, project_code, project_name, client, requested_by_name, board_column, status, phase, n_target, n_target_max, n_collected, n_actual, credits, submitted_date, launch_date, deliver_date, delivered_at')
    .order('deliver_date', { ascending: true, nullsFirst: false })

  // The same predicates the list applies, in the same order, so the printed row
  // count matches the screen's.
  let rows = (data ?? []) as SalesRow[]
  if (bucket !== 'all') rows = rows.filter(r => bucketOf(r) === bucket)
  if (clients.length) rows = rows.filter(r => clients.includes(r.client ?? ''))
  if (stages.length) rows = rows.filter(r => stages.includes(r.board_column))
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
      clients={clients}
      stages={stages}
      search={one(sp.q) ?? ''}
      salesperson={name}
      generatedOn={today}
      generatedBy={user.email ?? ''}
    />
  )
}

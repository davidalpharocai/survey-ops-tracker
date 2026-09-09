import { notFound } from 'next/navigation'
import { requireSalesUser } from '@/lib/sales-auth'
import { AccountPrint } from '@/components/sales/AccountPrint'
import { rangeFor, filterByRange, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import type { AccountProject } from '@/components/sales/AccountDetail'
import type { Term } from '@/lib/sales/credits'

export const dynamic = 'force-dynamic'

/**
 * The printable account report.
 *
 * NO PDF LIBRARY, DELIBERATELY. The options were a headless Chrome route
 * (@sparticuz/chromium + puppeteer-core, ~50MB against Vercel's function limit
 * and a multi-second cold start), a pure-JS generator (pdfkit / jsPDF, which
 * means rebuilding the table layout, fonts and pagination by hand and having it
 * look nothing like the app), or the browser's own print-to-PDF. The last one
 * ships zero bytes, renders with the same components and the same brand, gets
 * pagination, page size and margins from an engine that already does them well,
 * and lets the reader pick their own paper. Its real cost is that the server
 * cannot generate the file unattended — which matters for a scheduled email and
 * does not matter at all for "a salesperson exports a table to send a client".
 * Revisit only if this needs to be emailed on a cron.
 *
 * THE FILTER ARRIVES IN THE URL, so the printed page is exactly what was on
 * screen — same date basis, same range, same columns. The filtering is redone
 * here from the same pure helpers rather than being passed as rows, so a
 * bookmarked or re-shared export URL still produces a correct, current report
 * instead of a stale snapshot.
 *
 * Reads the sales_* views, so an account outside this salesperson's book 404s
 * exactly as it does on the interactive page — a print URL is not a side door.
 */
export default async function AccountPrintPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const { supabase, user } = await requireSalesUser(`/sales/accounts/${id}/print`)

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const basis = (['delivered', 'submitted', 'launched'].includes(one(sp.basis) ?? '')
    ? one(sp.basis) : 'delivered') as DateBasis
  const preset = (one(sp.preset) ?? 'all') as PresetId
  const custom: Range = { from: one(sp.from) || null, to: one(sp.to) || null }
  const cols = (one(sp.cols) ?? '').split(',').filter(Boolean)

  const [{ data: client }, { data: projects }, { data: terms }] = await Promise.all([
    supabase.from('sales_clients').select('id, name, code').eq('id', id).maybeSingle(),
    supabase
      .from('sales_projects')
      .select('id, project_code, project_name, board_column, status, phase, n_target, n_target_max, n_collected, n_actual, credits, submitted_date, launch_date, deliver_date, delivered_at, requested_by_name, longitudinal, rerun_number')
      .eq('client_id', id)
      .order('deliver_date', { ascending: false, nullsFirst: false }),
    supabase.from('sales_terms').select('id, name, credits_total, starts_on, renews_on').eq('client_id', id),
  ])
  if (!client) notFound()

  // Same helpers as the screen, so the two cannot drift.
  const today = new Date().toLocaleDateString('en-CA')
  const range = rangeFor(preset, today, custom)
  const { rows, undated } = filterByRange((projects ?? []) as AccountProject[], basis, range)

  return (
    <AccountPrint
      client={client}
      rows={rows}
      totalCount={(projects ?? []).length}
      undated={undated}
      basis={basis}
      range={range}
      cols={cols}
      terms={(terms ?? []) as Term[]}
      generatedOn={today}
      generatedBy={user.email ?? ''}
    />
  )
}

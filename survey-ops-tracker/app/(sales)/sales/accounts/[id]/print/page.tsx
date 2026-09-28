import { notFound } from 'next/navigation'
import { requireSalesUser, mySalesIdentity } from '@/lib/sales-auth'
import { AccountPrint } from '@/components/sales/AccountPrint'
import { rangeFor, filterByRange, todayET, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import type { AccountProject } from '@/components/sales/AccountDetail'
import type { Term } from '@/lib/sales/credits'
import { parseUrlChoice } from '@/lib/sales/printColumns'

export const dynamic = 'force-dynamic'

/**
 * The printable Survey Activity Statement.
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
 * screen — same date basis, same range. The filtering is redone here from the
 * same pure helpers rather than being passed as rows, so a bookmarked or
 * re-shared export URL still produces a correct, current report instead of a
 * stale snapshot. So does the choice of what prints: `cols` and `sections`
 * (lib/sales/printColumns), which the pre-send panel writes back as it changes,
 * so a copied link reproduces the print. An old export link's `cols` (the
 * account page's retired column ids) is mapped, not ignored, so it still
 * prints what it printed.
 *
 * Reads the sales_* views, so an account outside this salesperson's book 404s
 * exactly as it does on the interactive page — a print URL is not a side door.
 * A FAILED read is not an empty account: the page says what did not load and
 * prints nothing, because a statement with a silently missing contract reads
 * "No contract in force" to a client who has one.
 */
const PROJECT_COLS =
  'id, project_code, project_name, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, term_id, submitted_date, launch_date, deliver_date, delivered_at, requested_by_name, longitudinal, rerun_number'

function Blocked({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      Blocked: {what} did not load, so this statement cannot be printed yet. Reload the page to try again.
    </p>
  )
}

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

  // select('*') on the account: it picks up `salesperson` for the contact line
  // and, once migration 122 is applied, `display_name`. Naming display_name
  // before 122 lands would fail the whole select and 404 the page.
  const [clientRes, projectsRes, termsRes] = await Promise.all([
    supabase.from('sales_clients').select('*').eq('id', id).maybeSingle(),
    supabase.from('sales_projects').select(PROJECT_COLS).eq('client_id', id),
    supabase.from('sales_terms').select('id, name, credits_total, starts_on, renews_on').eq('client_id', id),
  ])
  if (clientRes.error) return <Blocked what="sales_clients" />
  const client = clientRes.data as (Record<string, unknown> & { id: string; name: string | null; code: string | null; salesperson: string | null }) | null
  if (!client) notFound()
  if (projectsRes.error) return <Blocked what="sales_projects" />
  if (termsRes.error) return <Blocked what="sales_terms" />

  const allRows = (projectsRes.data ?? []) as unknown as AccountProject[]
  const displayName = typeof client.display_name === 'string' && client.display_name.trim()
    ? client.display_name.trim() : null

  // The contact printed in the masthead and the sign-off: the ACCOUNT's
  // salesperson, from the table RLS already trusts (093 lets any signed-in user
  // read it). Not the reader — John Farrall printing Alex Pinsky's account
  // still sends the client to Alex. A failed read drops the line; it does not
  // invent one.
  const [contactRes, identity] = await Promise.all([
    client.salesperson
      ? supabase.from('salespeople').select('canonical_name, email')
          .eq('canonical_name', client.salesperson).eq('active', true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    mySalesIdentity(supabase, user.email),
  ])
  const c = contactRes.data as { canonical_name: string; email: string | null } | null
  const contact = c ? { name: c.canonical_name, email: c.email } : null

  // N-collected freshness (migration 111), for THIS account's surveys only.
  // Cast because 111 is applied by hand and the generated types lag it. On a
  // failed read no row is marked "never recorded" — a failed read is a
  // statement about our access, not about the data.
  const ids = allRows.map(r => r.id)
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

  // Eastern Time, once, here: the filter, the "was due" test and the printed
  // date must all agree, and the server's own clock is UTC.
  const today = todayET()
  const range = rangeFor(preset, today, custom)
  const { rows, undated, notDelivered } = filterByRange(allRows, basis, range)

  return (
    <AccountPrint
      client={{ id: client.id, name: client.name ?? '(unnamed account)', code: client.code }}
      displayName={displayName}
      contact={contact}
      preparedBy={identity.name}
      rows={rows}
      allRows={allRows}
      undated={undated}
      notDelivered={notDelivered}
      basis={basis}
      range={range}
      terms={(termsRes.data ?? []) as Term[]}
      today={today}
      generatedAt={new Date().toISOString()}
      neverRecordedIds={neverRecordedIds}
      printChoice={parseUrlChoice('statement', sp.cols, sp.sections)}
    />
  )
}

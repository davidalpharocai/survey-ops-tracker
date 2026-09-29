import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AccountPrint } from '@/components/sales/AccountPrint'
import { rangeFor, filterByRange, todayET, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import type { AccountProject } from '@/components/sales/AccountDetail'
import type { Term } from '@/lib/sales/credits'
import { parseUrlChoice } from '@/lib/sales/printColumns'
import { STATEMENT_PROJECT_COLS, neverRecordedFrom } from '@/lib/sales/statementData'
import { StatementRangeBar } from '@/components/sales/print/StatementRangeBar'

export const dynamic = 'force-dynamic'

/**
 * The client's Survey Activity Statement, produced by an ANALYST.
 *
 * ── WHY THIS ROUTE EXISTS ───────────────────────────────────────────────────
 * The document only existed under /sales, behind requireSalesUser, so the only
 * way for David to look at it was to impersonate a salesperson. He asked for
 * that to stop (2026-09-28): "can you enable the pdf feature for me so i can
 * test it vs having to view-as alex every time."
 *
 * It could not be done by relaxing the gate. `sales_projects` opens with
 * `where public.my_role() = 'sales'` and scopes on my_salesperson_name(), which
 * reads the salespeople table by email — so an analyst let through the gate
 * would have reached a working portal containing zero rows, which looks like a
 * broken feature rather than a closed door. The other option was to add an
 * analyst to `salespeople` with sees_book_of, which would have put them in
 * every salesperson roster and picker in the app to make one PDF openable.
 *
 * So: same component, same helpers, analyst reads. This is not a widening.
 * Everything on the statement — targets, final counts, credits, dates — is a
 * column an analyst already reads on the project and client pages, and the
 * finance-only figures are not on it at all (see STATEMENT_PROJECT_COLS).
 * It is also better than a test hatch: finance can now produce a statement for
 * ANY account, not only the accounts in one salesperson's book.
 *
 * ── SCOPE OF THE ROWS ───────────────────────────────────────────────────────
 * Every live survey on the account. The sales view's two ownership arms (093's
 * salesperson match, 100's account match) are how a SALESPERSON is scoped to
 * their book; they are not part of what belongs on an account's statement, and
 * applying them here would drop surveys the client paid for because of who
 * happens to own the relationship. `deleted_at is null` is kept, because that
 * one is about the survey rather than the reader.
 *
 * ── THE GATE ────────────────────────────────────────────────────────────────
 * (app)/layout.tsx already redirects anyone whose role is not 'analyst', and
 * every RLS policy behind these tables tests the same thing. The explicit check
 * below is belt and braces: this route renders a document meant for a client,
 * and it should refuse rather than render if it is ever mounted outside that
 * shell.
 *
 * NO PDF LIBRARY — the browser's own print-to-PDF, for the reasons set out at
 * length in the sales route. The filter and the choice of what prints arrive in
 * the URL the same way, through the same helpers, so a link reproduces a print.
 */

function Blocked({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      Blocked: {what} did not load, so this statement cannot be printed yet. Reload the page to try again.
    </p>
  )
}

export default async function ClientStatementPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  if (profile?.role !== 'analyst') notFound()

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const basis = (['delivered', 'submitted', 'launched'].includes(one(sp.basis) ?? '')
    ? one(sp.basis) : 'delivered') as DateBasis
  const preset = (one(sp.preset) ?? 'all') as PresetId
  const custom: Range = { from: one(sp.from) || null, to: one(sp.to) || null }

  // select('*') on the ACCOUNT only — it is one row, it carries no survey
  // figures, and naming display_name explicitly would fail the whole select on
  // a database where migration 122 has not been applied. The PROJECTS are a
  // strict allowlist; see statementData.
  const [clientRes, projectsRes, termsRes] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).is('deleted_at', null).maybeSingle(),
    supabase.from('survey_projects').select(STATEMENT_PROJECT_COLS).eq('client_id', id).is('deleted_at', null),
    supabase.from('client_terms').select('id, client_id, name, credits_total, starts_on, renews_on')
      .eq('client_id', id).is('deleted_at', null),
  ])
  if (clientRes.error) return <Blocked what="the account" />
  const client = clientRes.data as (Record<string, unknown> & {
    id: string; name: string | null; code: string | null; salesperson: string | null
  }) | null
  if (!client) notFound()
  // A failed read is not an empty account. A statement whose contract silently
  // did not load reads "No contract in force" to a client who has one.
  if (projectsRes.error) return <Blocked what="the surveys" />
  if (termsRes.error) return <Blocked what="the contract terms" />

  const allRows = (projectsRes.data ?? []) as unknown as AccountProject[]
  const displayName = typeof client.display_name === 'string' && client.display_name.trim()
    ? client.display_name.trim() : null

  // The contact in the masthead and the sign-off is the ACCOUNT's salesperson,
  // never the person printing. An analyst printing Alex Pinsky's account still
  // sends the client to Alex — the document is the client's relationship, not
  // ours. A failed read drops the line rather than inventing one.
  const contactRes = client.salesperson
    ? await supabase.from('salespeople').select('canonical_name, email')
        .eq('canonical_name', client.salesperson).eq('active', true).maybeSingle()
    : { data: null }
  const c = contactRes.data as { canonical_name: string; email: string | null } | null
  const contact = c ? { name: c.canonical_name, email: c.email } : null

  // Never-recorded collection counts, straight off project_audit — the table
  // migration 111's view exists to keep away from the sales tier, and which an
  // analyst reads directly. The RULE is shared (neverRecordedFrom) so the two
  // routes cannot disagree about which surveys say "not recorded".
  const ids = allRows.map(r => r.id)
  const auditRes = ids.length
    ? await supabase.from('project_audit').select('project_id').eq('field', 'n_collected').in('project_id', ids)
    : { data: [] as { project_id: string }[], error: null }
  const neverRecordedIds = neverRecordedFrom(
    ids,
    (auditRes.data ?? []) as { project_id: string }[],
    Boolean(auditRes.error),
  )

  // Eastern Time, once: the filter, the "was due" test and the printed date
  // must agree, and the server's clock is UTC.
  const today = todayET()
  const range = rangeFor(preset, today, custom)
  const { rows, undated, notDelivered } = filterByRange(allRows, basis, range)

  return (
    <>
      {/* The analyst route is opened straight from the client page, with no
          screen in front of it to choose a range on — so the choice lives
          here. Writes the same four parameters the sales print route reads.
          Not printed. */}
      <StatementRangeBar basis={basis} preset={preset} from={custom.from} to={custom.to} />
      <AccountPrint
        client={{ id: client.id, name: client.name ?? '(unnamed account)', code: client.code }}
        displayName={displayName}
        contact={contact}
        preparedBy={null}
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
    </>
  )
}

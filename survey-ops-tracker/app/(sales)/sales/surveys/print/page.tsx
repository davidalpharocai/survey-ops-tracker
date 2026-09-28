import Link from 'next/link'
import { requireSalesUser, mySalesIdentity } from '@/lib/sales-auth'
import { bookOwner } from '@/lib/sales/identity'
import { SurveyListPrint, type ListRow } from '@/components/sales/SurveyListPrint'
import { rangeFor, filterByRange, todayET, type DateBasis, type PresetId, type Range } from '@/lib/sales/dateRange'
import { migrateBucketId, bucketOf, type BucketId } from '@/lib/sales/buckets'
import { stageOf } from '@/lib/sales/stage'
import { clientStageName } from '@/lib/sales/statement'
import { accountIndex, accountNameOf, inAccounts } from '@/lib/sales/accountIndex'
import type { SalesRow } from '@/components/sales/SalesPipeline'
import type { Term } from '@/lib/sales/credits'
import { parseUrlChoice } from '@/lib/sales/printColumns'

export const dynamic = 'force-dynamic'

/**
 * Print the CURRENT survey list.
 *
 * The statement answers "what have you done for this client"; this answers
 * "everything you delivered last quarter", which is the more common ask. Same
 * print-route approach as the account export — no PDF library, the browser's
 * own Save as PDF — and the same date-range module and document parts, so the
 * two exports cannot drift on what "delivered in Q3" means or how it looks.
 *
 * The list's filters travel in the URL already, which is what makes this cheap:
 * the print page reads the SAME query parameters the list writes, so "print what
 * I am looking at" is a link, not a second filter UI to keep in step. What
 * prints travels the same way: `cols` and `sections` (lib/sales/printColumns),
 * which the pre-send panel writes back as it changes; an old link's `cols` is
 * mapped rather than ignored.
 *
 * ONE ACCOUNT SELECTED = a client document; none or several = Internal. See
 * SurveyListPrint for why the selection, not a checkbox, decides.
 */
type Row = SalesRow & ListRow & { term_id?: string | null; launch_date?: string | null; salesperson?: string | null }

function Blocked({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      Blocked: {what} did not load, so this list cannot be printed yet. Reload the page to try again.
    </p>
  )
}

function NotInBook() {
  return (
    <p role="alert" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
      The selected account is not in your book, so there is no list to print for it.{' '}
      <Link href="/sales/surveys" className="font-medium text-foreground underline underline-offset-2">Back to your surveys</Link>
    </p>
  )
}

export default async function SurveyListPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { supabase, user } = await requireSalesUser('/sales/surveys/print')
  const identity = await mySalesIdentity(supabase, user.email)

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

  // Paged: PostgREST caps a response at 1,000 rows and truncates SILENTLY, and
  // a book past that line would print short with nothing to say so. No
  // .order() for the document — sortForStatement orders it — but a stable
  // order is needed for the pages to tile.
  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sales_projects')
      .select('id, project_code, project_name, client, client_id, requested_by_name, salesperson, board_column, status, phase, scoping_stage, n_target, n_target_max, n_collected, n_actual, credits, term_id, submitted_date, launch_date, deliver_date, delivered_at')
      .order('id')
      .range(from, from + 999)
    if (error) return <Blocked what="sales_projects" />
    all.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 1000) break
  }

  // The URL carries account IDs; the page prints account NAMES. Without this
  // the filter line read "Filtered to accounts: 3f2a1c9e-…".
  //
  // Named the way the screen names them (accountNameOf): sales_clients where it
  // knows the id, else the shortest `client` label on that id's own rows.
  // sales_clients is OWNER-scoped while sales_projects also shows surveys that
  // merely name the reader as salesperson, so a list can hold accounts
  // sales_clients never returns — measured 2026-09-27: Jenna 3, Vineet 8,
  // Shanu 1. Naming only from sales_clients printed "—" in their Account
  // column and refused their client prints outright.
  const { data: clientRows, error: cErr } = await supabase.from('sales_clients').select('*')
  if (cErr) return <Blocked what="sales_clients" />
  const accountRows = (clientRows ?? []) as unknown as (Record<string, unknown> & { id: string; name: string | null; salesperson: string | null })[]
  const index = accountIndex(accountRows)
  const labelsById = new Map<string, string[]>()
  for (const r of all) {
    if (!r.client_id) continue
    const l = labelsById.get(r.client_id) ?? []
    if (r.client) l.push(r.client)
    labelsById.set(r.client_id, l)
  }
  const nameOf = (id: string) => accountNameOf(id, labelsById.get(id) ?? [], index)
  const nameById: Record<string, string> = {}
  for (const id of new Set([...labelsById.keys(), ...accountRows.map(c => c.id)])) nameById[id] = nameOf(id)

  // N-collected freshness, from migration 111's two-column view — the same read
  // /sales/home does, for the same reason: a survey whose count has never been
  // touched must not print its column default as a measured 0. Cast because
  // 111 is applied by hand and the generated types lag it. If this read fails,
  // no row is marked "never recorded".
  const freshRes = await (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => Promise<{ data: { project_id: string; last_updated: string }[] | null; error: unknown }>
    }
  }).from('sales_n_collected_freshness').select('*')
  const fresh = new Set((freshRes.data ?? []).map(f => f.project_id))

  // The list's OWN predicates, imported rather than re-derived. An earlier
  // copy compared the picker's client_id against the stale `client` label —
  // zero overlap by construction, so every account-filtered export was an empty
  // PDF. A predicate that lives in one place cannot drift from itself.
  let rows = all
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
  const today = todayET()
  const range = rangeFor(preset, today, custom)
  const { rows: kept, undated, notDelivered } = filterByRange(rows, basis, range)
  const neverRecordedIds = freshRes.error ? [] : kept.filter(r => !fresh.has(r.id)).map(r => r.id)

  // Client mode: exactly one account selected. Its display name (122, when
  // applied — hence select('*') above), its salesperson as the contact, and its
  // contracts for the before-the-contract check.
  //
  // An account the reader works on WITHOUT owning is not in sales_clients, and
  // that is not a failed read: it prints as a client document too, named from
  // its survey records, with the salesperson those surveys name as the contact
  // (the reader sees them BECAUSE they are named on them). It has no saved
  // display name, so the pre-send check asks for the client's own name, and
  // sales_terms (owner-scoped) returns no contract, which a list does not state
  // anyway. Refusing here said "did not load … reload to try again", which no
  // reload could ever fix.
  const mode: 'client' | 'internal' = clients.length === 1 ? 'client' : 'internal'
  let account: { id: string; name: string; displayName: string | null; own: boolean } | null = null
  let contact: { name: string; email: string | null } | null = null
  let terms: Term[] = []
  if (mode === 'client') {
    const id = clients[0]
    const a = accountRows.find(c => c.id === id)
    // Neither owned nor on any survey the reader can see: an old or edited
    // link. Say so, rather than print an empty document "Prepared for" nobody.
    if (!a && !labelsById.has(id)) return <NotInBook />
    const dn = a && typeof a.display_name === 'string' && a.display_name.trim() ? a.display_name.trim() : null
    account = { id, name: nameOf(id), displayName: dn, own: !!a }
    // The most frequent salesperson on the account's rows, for the unowned case.
    const named = new Map<string, number>()
    for (const r of all) if (r.client_id === id && r.salesperson) named.set(r.salesperson, (named.get(r.salesperson) ?? 0) + 1)
    const salesperson = a ? a.salesperson : ([...named].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null)
    const [contactRes, termsRes] = await Promise.all([
      salesperson
        ? supabase.from('salespeople').select('canonical_name, email')
            .eq('canonical_name', salesperson).eq('active', true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.from('sales_terms').select('id, name, credits_total, starts_on, renews_on').eq('client_id', id),
    ])
    const c = contactRes.data as { canonical_name: string; email: string | null } | null
    contact = c ? { name: c.canonical_name, email: c.email } : null
    // A failed terms read only costs the before-the-contract check on a list;
    // the list itself states no contract position.
    terms = termsRes.error ? [] : ((termsRes.data ?? []) as Term[])
  }

  return (
    <SurveyListPrint
      rows={kept}
      totalBeforeDates={total}
      undated={undated}
      notDelivered={notDelivered}
      basis={basis}
      range={range}
      bucket={bucket}
      stages={[...new Set(stages.map(clientStageName))]}
      search={one(sp.q) ?? ''}
      mode={mode}
      account={account}
      selectedCount={clients.length}
      selectedNames={mode === 'internal'
        ? clients.map(id => (index.has(id) || labelsById.has(id) ? nameOf(id) : 'an account outside your book'))
        : []}
      accountNameById={nameById}
      bookOwner={bookOwner(identity)}
      contact={contact}
      terms={terms}
      preparedBy={identity.name}
      today={today}
      generatedAt={new Date().toISOString()}
      neverRecordedIds={neverRecordedIds}
      printChoice={parseUrlChoice('list', sp.cols, sp.sections)}
    />
  )
}

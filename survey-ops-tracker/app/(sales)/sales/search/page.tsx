import { requireSalesUser } from '@/lib/sales-auth'
import { runSearch, type SearchClient } from '@/lib/search/run'
import { isSearchable, MIN_QUERY } from '@/lib/search/match'
import { SearchResults } from '@/components/search/SearchResults'

export const dynamic = 'force-dynamic'

/**
 * The same search, for the sales tier.
 *
 * ── FIVE OBJECTS, NOT TEN ───────────────────────────────────────────────────
 * Sales reads six security_barrier views and no tables at all (102, 105, 111,
 * 118). So this page can offer surveys, accounts, contacts, contracts and
 * files, and it deliberately offers nothing else: there is no sales view over
 * rerun series, account notes, project activity, next steps or the team roster,
 * and building one to round out a search page would be a disclosure decision
 * wearing a feature's clothes.
 *
 * The scope needs no `.eq()` here. runSearch is handed the USER'S client and
 * the view names, and the views scope themselves -- so there is no filter in
 * this file for a later edit to drop.
 */
export default async function SalesSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; o?: string }>
}) {
  const { q = '', o = '' } = await searchParams
  const { supabase } = await requireSalesUser(`/sales/search?q=${encodeURIComponent(q)}`)

  if (!isSearchable(q)) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {q.trim()
            ? `Type at least ${MIN_QUERY} characters.`
            : 'Search your surveys, accounts, contacts, contracts and files.'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Use the box in the top bar, or press ⌘K. Enter searches everything on your book.
        </p>
      </div>
    )
  }

  const { groups, total } = await runSearch(supabase as unknown as SearchClient, 'sales', q)

  return (
    <SearchResults
      q={q.trim()}
      groups={groups}
      total={total}
      initialObject={o || null}
      tierLabel="your book"
    />
  )
}

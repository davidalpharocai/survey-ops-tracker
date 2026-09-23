import { createClient } from '@/lib/supabase/server'
import { runSearch, type SearchClient } from '@/lib/search/run'
import { isSearchable, MIN_QUERY } from '@/lib/search/match'
import { SearchResults } from '@/components/search/SearchResults'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Search — Survey Ops Command Center' }

/**
 * System-wide search, grouped by object.
 *
 * David, 2026-09-23: "if i type a word/characters in the search and just press
 * enter (without selecting something that popped up as a potential match) it
 * brings to a search page that shows where that result came up in grouped by
 * object (ie survey, contact, account, etc)."
 *
 * ── WHY THIS IS A SERVER COMPONENT AND THE DROPDOWN IS NOT ──────────────────
 * The nav dropdown searches three lists React Query already holds, which is why
 * it answers on every keystroke. This page searches ten objects including the
 * text of 616 activity rows and 448 next steps -- nothing caches that, and it
 * should not. One round trip on Enter is the right trade for a page you arrive
 * at deliberately.
 *
 * It runs as the SIGNED-IN USER, not the admin client. Every policy that
 * governs the rest of the app governs this page too, so search cannot become
 * the one surface that returns a row the reader could not otherwise open.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; o?: string }>
}) {
  const { q = '', o = '' } = await searchParams
  const supabase = await createClient()

  if (!isSearchable(q)) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {q.trim()
            ? `Type at least ${MIN_QUERY} characters — one letter matches most of the book and answers nothing.`
            : 'Search surveys, accounts, contacts, contracts, files, rerun series, people, notes, activity and next steps.'}
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Use the box in the top bar, or press Ctrl/⌘ + / from anywhere. Enter searches everything.
        </p>
      </div>
    )
  }

  const { groups, total } = await runSearch(supabase as unknown as SearchClient, 'analyst', q)

  return (
    <SearchResults
      q={q.trim()}
      groups={groups}
      total={total}
      initialObject={o || null}
      tierLabel="the tracker"
    />
  )
}

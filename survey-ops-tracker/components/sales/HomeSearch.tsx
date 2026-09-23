'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtNum } from '@/lib/utils/number'
import { stageOf, stageTone } from '@/lib/sales/stage'

/**
 * Search and account-filter on the sales home page.
 *
 * David, 2026-09-17: "on the home page for sales they should be able to deep
 * search in the list of surveys, filter by client."
 *
 * ── WHY IT FILTERS THE WHOLE BOOK, NOT THE CARDS ────────────────────────────
 * The home page already loads every survey the salesperson can see — measured,
 * 268 rows for the largest book — and renders about 25 of them across four
 * curated cards. Searching the 25 would answer almost nothing; the other 243 are
 * the reason someone types in a box. So this searches everything that was
 * already fetched, which costs no extra query.
 *
 * ── AND WHY IT IS NOT A SECOND SURVEYS PAGE ─────────────────────────────────
 * When the box is empty and no account is chosen, this renders nothing and the
 * curated cards stand. The results view appears only once someone asks for it,
 * and links out to the full list so the one implementation of sorting, columns,
 * buckets, saved views and print stays on /sales/surveys rather than being
 * half-rebuilt here.
 *
 * ── DEEP MEANS FOUR FIELDS ──────────────────────────────────────────────────
 * Name, code, account and REQUESTED-BY. The last one is the one the nav search
 * leaves out, and it matters: 162 of Alex's 268 rows carry a requester, so
 * typing a contact's name into the nav box finds nothing while the surveys page
 * finds eleven.
 */

export interface HomeSearchRow {
  id: string
  project_code: string | null
  project_name: string
  client: string | null
  client_id: string | null
  requested_by_name: string | null
  board_column: string
  status: string
  phase: string | null
  scoping_stage?: string | null
  n_target: number | null
  n_collected: number | null
  n_actual: number | null
  deliver_date: string | null
  delivered_at: string | null
}

const MAX_SHOWN = 40

export function HomeSearch({ rows }: { rows: HomeSearchRow[] }) {
  const [q, setQ] = useState('')
  const [client, setClient] = useState('')

  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>()
    for (const r of rows) {
      if (!r.client_id) continue
      const e = m.get(r.client_id) ?? { id: r.client_id, name: r.client ?? '(no account)', n: 0 }
      e.n++
      // The stale label splits 14 accounts across several spellings; the
      // SHORTEST in a group is the canonical name plus nothing.
      if (r.client && r.client.length < e.name.length) e.name = r.client
      m.set(r.client_id, e)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [rows])

  const active = q.trim().length > 0 || client !== ''

  const hits = useMemo(() => {
    if (!active) return []
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (client && r.client_id !== client) return false
      if (!needle) return true
      return (
        r.project_name.toLowerCase().includes(needle) ||
        (r.project_code ?? '').toLowerCase().includes(needle) ||
        (r.client ?? '').toLowerCase().includes(needle) ||
        (r.requested_by_name ?? '').toLowerCase().includes(needle)
      )
    })
  }, [rows, q, client, active])

  const full = `/sales/surveys?g=all${client ? `&c=${client}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search all your surveys — name, code, account or who asked…"
          className="h-9 min-w-[18rem] flex-1 rounded-md border border-border bg-background px-3 text-sm"
          aria-label="Search your surveys"
        />
        <select
          value={client}
          onChange={e => setClient(e.target.value)}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.n})</option>)}
        </select>
        {active && (
          <button
            type="button"
            onClick={() => { setQ(''); setClient('') }}
            className="h-9 rounded-md border border-border px-2.5 text-xs hover:bg-muted"
          >
            Clear
          </button>
        )}
      </div>

      {active && (
        <div className="mt-3 rounded-lg border border-border bg-card">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2">
            <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {hits.length === 0
                ? 'No match'
                : `${fmtNum(hits.length)} match${hits.length === 1 ? '' : 'es'} in your ${fmtNum(rows.length)} surveys`}
            </span>
            <Link href={full} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
              Open in the full list →
            </Link>
          </div>

          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Nothing on your book matches that.
            </p>
          ) : (
            <>
              {hits.slice(0, MAX_SHOWN).map(r => (
                <Link
                  key={r.id}
                  href={`/sales/surveys/${r.id}`}
                  className="flex items-center gap-3 border-b border-border/60 px-4 py-2 last:border-0 hover:bg-muted/30"
                >
                  <span className="w-[72px] shrink-0 text-xs text-muted-foreground">{r.project_code ?? '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{r.project_name}</span>
                  <span className="hidden w-40 shrink-0 truncate text-xs text-muted-foreground sm:block">{r.client ?? '—'}</span>
                  <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] ${stageTone(r)}`}>
                    {stageOf(r)}
                  </span>
                </Link>
              ))}
              {/* Never a silent cap: a list that stops at 40 without saying so
                  reads as "that is all there is". */}
              {hits.length > MAX_SHOWN && (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  Showing the first {MAX_SHOWN} of {fmtNum(hits.length)}.{' '}
                  <Link href={full} className="underline hover:text-foreground">See them all</Link>.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

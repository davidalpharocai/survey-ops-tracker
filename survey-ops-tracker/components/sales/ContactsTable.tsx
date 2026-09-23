'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fmtNum } from '@/lib/utils/number'
import { useUrlSearch } from '@/lib/hooks/useUrlSearch'

/**
 * The contacts list.
 *
 * David, 2026-09-17: "contacts page: deep search contacts, filter by client,
 * values should be clickable or at the very least i click anywhere in the row
 * and it takes me to the contact."
 *
 * ── WHOLE-ROW NAVIGATION WITHOUT BREAKING THE OTHER LINKS ───────────────────
 * A row that navigates on click and also contains a mailto: and an account link
 * is a trap if it is built with an onClick on the <tr>: clicking the email would
 * fire both. So the row is not a click handler at all. The NAME cell carries a
 * real <a href> that stretches across the row with an absolutely-positioned
 * overlay, and the cells that have their own destination sit above it. That
 * keeps middle-click, cmd-click and "copy link address" working on every one of
 * them — which an onClick handler silently takes away, and which this app has an
 * explicit standing rule about.
 *
 * ── SEARCH IS DEEP ON PURPOSE ───────────────────────────────────────────────
 * Name, email, title and account all match. A salesperson looking someone up
 * usually has one of those four and not necessarily the one the list is sorted
 * by; a box that matches only names turns "who was the VP at Citadel" into
 * scrolling.
 */

export interface ContactRow {
  id: string
  client_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  title: string | null
  phone: string | null
  account: string
  requested: number
}

export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  const router = useRouter()
  const params = useSearchParams()
  // Local while typing, written to the URL once you pause -- a router.replace()
  // per keystroke made this box lag on a force-dynamic page.
  const [q, setQ] = useUrlSearch('q')
  const client = params.get('c') ?? ''

  const setParams = useCallback((mut: (sp: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString())
    mut(next)
    router.replace(next.toString() ? `?${next.toString()}` : '?', { scroll: false })
  }, [params, router])

  // Built from the ROWS, not from the accounts table: the two are scoped
  // differently, so an account list would offer options that match nothing and
  // omit ones that do. Same rule as the surveys picker.
  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>()
    for (const r of rows) {
      const e = m.get(r.client_id) ?? { id: r.client_id, name: r.account, n: 0 }
      e.n++
      m.set(r.client_id, e)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  }, [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (client && r.client_id !== client) return false
      if (!needle) return true
      return (
        `${r.first_name ?? ''} ${r.last_name ?? ''}`.toLowerCase().includes(needle) ||
        (r.email ?? '').toLowerCase().includes(needle) ||
        (r.title ?? '').toLowerCase().includes(needle) ||
        r.account.toLowerCase().includes(needle)
      )
    })
  }, [rows, q, client])

  const nameOf = (r: ContactRow) =>
    [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed contact'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search name, email, title or account…"
          className="h-8 min-w-[16rem] flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
          aria-label="Search contacts"
        />
        <select
          value={client}
          onChange={e => setParams(p => { const v = e.target.value; if (v) p.set('c', v); else p.delete('c') })}
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({a.n})</option>
          ))}
        </select>
      </div>

      <p className="mb-2 text-sm text-muted-foreground">
        {shown.length === rows.length
          ? `${fmtNum(rows.length)} contact${rows.length === 1 ? '' : 's'} across ${accounts.length} account${accounts.length === 1 ? '' : 's'}`
          : `${fmtNum(shown.length)} of ${fmtNum(rows.length)} contacts`}
      </p>

      {/* The header only sticks inside a scroll container that has a BOUNDED
          height. `sticky top-0` on a th inside a plain overflow-x-auto wrapper
          has no scrollport to stick within, so it never moved -- the claim in
          the old comment here was simply wrong. Same bound ProjectTable and
          SalesPipeline already use. */}
      <div className="overflow-auto thin-scroll max-h-[calc(100vh-18rem)] rounded-lg border border-border">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">Name</th>
              <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">Account</th>
              <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">Title</th>
              <th className="sticky top-0 z-10 bg-muted px-3 py-2 font-medium">Email</th>
              <th className="sticky top-0 z-10 bg-muted px-3 py-2 text-right font-medium" title="Surveys recorded with this person as the requester.">Surveys requested</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(c => (
              <tr key={c.id} className="group relative border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">
                  {/* The stretched link. `before:` covers the row, so a click
                      anywhere that is not another link lands here — and it is a
                      real href, so middle-click and cmd-click still work. */}
                  <Link
                    href={`/sales/contacts/${c.id}`}
                    className="before:absolute before:inset-0 before:content-[''] hover:underline"
                  >
                    {nameOf(c)}
                  </Link>
                </td>
                <td className="relative z-10 px-3 py-2">
                  <Link href={`/sales/accounts/${c.client_id}`} className="hover:underline">{c.account}</Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.title || '—'}</td>
                <td className="relative z-10 px-3 py-2">
                  {c.email ? (
                    // A real mailto, because the reason you look a contact up is
                    // usually to write to them.
                    <a href={`mailto:${c.email}`} className="text-muted-foreground hover:text-foreground hover:underline">
                      {c.email}
                    </a>
                  ) : (
                    <span className="text-muted-foreground/40">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {c.requested || <span className="text-muted-foreground/40">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && rows.length > 0 && (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No contact matches that.{' '}
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => { setQ(''); setParams(p => p.delete('c')) }}
          >
            Clear the filters
          </button>
        </p>
      )}
    </div>
  )
}

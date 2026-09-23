'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fmtNum } from '@/lib/utils/number'
import { useUrlSearch } from '@/lib/hooks/useUrlSearch'

/**
 * The accounts list.
 *
 * David, 2026-09-17: "accounts should searchable as well. the header should stay
 * frozen once you scroll down past it. i should be able to click into any of
 * those values (name, active surveys, etc). it should show credits used (in
 * current term), credits remaining, credits used all time, and the option to add
 * other columns and remove/rearrange if they want + save the view."
 *
 * ── EVERY NUMBER IS A LINK, AND THEY ALL GO SOMEWHERE DIFFERENT ─────────────
 * "Click into any of those values" only means something if the destinations
 * differ. A count of active surveys links to THAT account's active surveys, not
 * to the account page — the number is a filter someone has already applied in
 * their head, and the click should hand them the list it describes. So each cell
 * carries the account id AND the bucket into /sales/surveys, whose filters are
 * URL state precisely so another page can drive them.
 *
 * ── THE CREDIT COLUMNS ARE THREE DIFFERENT QUESTIONS ────────────────────────
 * They are computed on the server by `creditPosition` and arrive here as
 * numbers. Two things about them are load-bearing:
 *
 *   A blank is not a zero. An account with no term recorded has no "remaining"
 *   — that is unanswerable, not nought — and printing 0 in a column a client may
 *   eventually see asserts they have nothing left.
 *
 *   `used` counts credits DRAWN, not priced. Migration 100: consumption is
 *   derived from the survey's stage. The old cell counted anything with a price
 *   on it, which had BofA reading 158 against 58 actually drawn.
 *
 * ── ORDERING AND SEARCH LIVE IN THE URL ─────────────────────────────────────
 * Same rule as the surveys list: a view a salesperson cannot send to anyone is
 * half a feature, and a reload that loses their sort is an annoyance the rest of
 * the app does not have.
 */

export interface AccountRow {
  id: string
  name: string
  code: string | null
  total: number
  active: number
  scoping: number
  delivered: number
  hold: number
  cancelled: number
  contacts: number
  /** Drawn in the term in force today. */
  creditsTerm: number
  /** That term's allowance less the above. Null when no term is recorded. */
  creditsRemaining: number | null
  /** Drawn across every survey on the account, termed or not. */
  creditsAllTime: number
  /** Priced but not yet fielded. */
  creditsCommitted: number
  /** Surveys with no credit figure at all, so the figures above are floors. */
  unpriced: number
  termName: string | null
}

type ColId =
  | 'total' | 'active' | 'scoping' | 'delivered' | 'hold' | 'cancelled'
  | 'creditsTerm' | 'creditsRemaining' | 'creditsAllTime' | 'creditsCommitted'
  | 'contacts'

interface Col {
  id: ColId
  label: string
  title: string
  /** Where this cell goes when clicked, or null for a plain number. */
  href: ((r: AccountRow) => string) | null
  value: (r: AccountRow) => number | null
  /** Rendered when the value is null — never "0". */
  blank?: string
}

const surveys = (id: string, g: string) => `/sales/surveys?c=${id}&g=${g}`

const COLS: Col[] = [
  { id: 'total', label: 'Surveys', title: 'Every survey on this account, all time.', href: r => surveys(r.id, 'all'), value: r => r.total },
  { id: 'active', label: 'Active', title: 'Scoped and running — not yet delivered.', href: r => surveys(r.id, 'active'), value: r => r.active },
  { id: 'scoping', label: 'Scoping', title: 'Still being scoped and priced.', href: r => surveys(r.id, 'scoping'), value: r => r.scoping },
  { id: 'delivered', label: 'Delivered', title: 'Reached the Delivery stage and went to the client.', href: r => surveys(r.id, 'delivered'), value: r => r.delivered },
  { id: 'hold', label: 'On hold', title: 'Paused.', href: r => surveys(r.id, 'hold'), value: r => r.hold },
  { id: 'cancelled', label: 'Cancelled', title: 'Called off.', href: r => surveys(r.id, 'cancelled'), value: r => r.cancelled },
  {
    id: 'creditsTerm', label: 'Credits (term)',
    title: 'Credits DRAWN in the term running today — priced and fielded. Blank when no term is recorded.',
    href: r => `/sales/accounts/${r.id}`, value: r => (r.termName == null ? null : r.creditsTerm),
  },
  {
    id: 'creditsRemaining', label: 'Remaining',
    title: 'The current term\'s allowance less what has been drawn. Blank when no term or no allowance is recorded — that is unanswerable, not zero.',
    href: r => `/sales/accounts/${r.id}`, value: r => r.creditsRemaining,
  },
  {
    id: 'creditsAllTime', label: 'Credits (all time)',
    title: 'Credits drawn across every survey on the account, inside a term or not.',
    href: r => `/sales/accounts/${r.id}`, value: r => r.creditsAllTime,
  },
  {
    id: 'creditsCommitted', label: 'Committed',
    title: 'Priced but not yet fielded — promised, not consumed. Counted in neither figure to its left.',
    href: r => `/sales/accounts/${r.id}`, value: r => r.creditsCommitted,
  },
  { id: 'contacts', label: 'Contacts', title: 'People we know at this account.', href: r => `/sales/contacts?c=${r.id}`, value: r => r.contacts },
]

const DEFAULT_COLS: ColId[] = ['total', 'active', 'scoping', 'delivered', 'creditsTerm', 'creditsRemaining', 'creditsAllTime', 'contacts']
const COLS_KEY = 'socc-sales-accounts-columns'
const VIEWS_KEY = 'socc-sales-accounts-views'

interface SavedView { name: string; q: string; sortBy: string; asc: boolean; cols: ColId[] }

export function AccountsTable({ rows, offBook = 0 }: { rows: AccountRow[]; offBook?: number }) {
  const router = useRouter()
  const params = useSearchParams()

  // See useUrlSearch: typing is local, the URL catches up on a pause.
  const [q, setQ] = useUrlSearch('q')
  const sortBy = params.get('s') ?? 'name'
  const asc = params.get('d') !== 'desc'

  const setParams = useCallback((mut: (sp: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString())
    mut(next)
    router.replace(next.toString() ? `?${next.toString()}` : '?', { scroll: false })
  }, [params, router])

  const [cols, setColsState] = useState<ColId[]>(DEFAULT_COLS)
  const [views, setViews] = useState<SavedView[]>([])
  const [showCols, setShowCols] = useState(false)

  // localStorage throws outright in some contexts (private windows, blocked site
  // data), and comes back empty in others, so every read is guarded and the
  // table renders correctly without it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_KEY)
      const parsed = raw ? (JSON.parse(raw) as ColId[]) : null
      const valid = parsed?.filter(c => COLS.some(x => x.id === c))
      if (valid?.length) setColsState(valid)
      const v = localStorage.getItem(VIEWS_KEY)
      if (v) setViews(JSON.parse(v) as SavedView[])
    } catch { /* defaults are fine */ }
  }, [])

  function setCols(next: ColId[]) {
    if (next.length === 0) return   // never let the table become columnless
    setColsState(next)
    try { localStorage.setItem(COLS_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  /** Toggle, preserving the canonical order rather than appending to the end —
   *  so removing and re-adding a column puts it back where it was. */
  function toggleCol(id: ColId) {
    const has = cols.includes(id)
    setCols(COLS.map(c => c.id).filter(c => (c === id ? !has : cols.includes(c))))
  }

  function move(id: ColId, dir: -1 | 1) {
    const i = cols.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= cols.length) return
    const next = cols.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setCols(next)
  }

  function saveViews(next: SavedView[]) {
    setViews(next)
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)) } catch { /* not fatal */ }
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    // Deep on purpose: an account is as likely to be found by its Cl##### code
    // as by name, and a salesperson pasting a code into a box that only matches
    // names gets an empty page with no clue why.
    const out = needle
      ? rows.filter(r =>
          r.name.toLowerCase().includes(needle) ||
          (r.code ?? '').toLowerCase().includes(needle) ||
          (r.termName ?? '').toLowerCase().includes(needle))
      : rows.slice()

    const col = COLS.find(c => c.id === sortBy)
    out.sort((a, b) => {
      if (!col) return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * (asc ? 1 : -1)
      // Nulls last in both directions: a blank means "not recorded", and
      // sorting it as if it were zero puts unanswered accounts at the top of a
      // "least used" sort as though they were the most frugal.
      const av = col.value(a), bv = col.value(b)
      if (av == null && bv == null) return a.name.localeCompare(b.name)
      if (av == null) return 1
      if (bv == null) return -1
      return (av - bv) * (asc ? 1 : -1) || a.name.localeCompare(b.name)
    })
    return out
  }, [rows, q, sortBy, asc])

  const visible = COLS.filter(c => cols.includes(c.id)).sort(
    (a, b) => cols.indexOf(a.id) - cols.indexOf(b.id))

  const sortHead = (id: string, label: string, title: string, numeric = true) => (
    <th
      key={id}
      className={`sticky top-0 z-10 bg-muted px-3 py-2 font-medium ${numeric ? 'text-right' : 'text-left'}`}
      title={title}
    >
      <button
        type="button"
        className="hover:text-foreground"
        onClick={() => setParams(p => {
          if (sortBy === id) { if (asc) p.set('d', 'desc'); else p.delete('d') }
          else { p.set('s', id); p.delete('d') }
        })}
      >
        {label}{sortBy === id && (asc ? ' ↑' : ' ↓')}
      </button>
    </th>
  )

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search accounts by name, code or term…"
          className="h-8 min-w-[16rem] flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
          aria-label="Search accounts"
        />
        <button
          type="button"
          onClick={() => setShowCols(v => !v)}
          className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-muted"
        >
          Columns
        </button>
        <button
          type="button"
          className="h-8 rounded-md border border-border px-2.5 text-xs hover:bg-muted"
          title="Save the current search, sort and columns under a name"
          onClick={() => {
            const name = window.prompt('Name this view')
            if (!name?.trim()) return
            saveViews([...views.filter(v => v.name !== name.trim()),
              { name: name.trim(), q, sortBy, asc, cols }])
          }}
        >
          Save view
        </button>
        {views.map(v => (
          <span key={v.name} className="inline-flex items-center rounded-full border border-border text-xs">
            <button
              type="button"
              className="py-1 pl-2.5 pr-1 hover:text-foreground"
              onClick={() => {
                setCols(v.cols.filter(c => COLS.some(x => x.id === c)))
                setParams(p => {
                  if (v.q) p.set('q', v.q); else p.delete('q')
                  if (v.sortBy === 'name') p.delete('s'); else p.set('s', v.sortBy)
                  if (v.asc) p.delete('d'); else p.set('d', 'desc')
                })
              }}
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete the view ${v.name}`}
              className="py-1 pl-1 pr-2 text-muted-foreground hover:text-destructive"
              onClick={() => saveViews(views.filter(x => x.name !== v.name))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      {showCols && (
        <div className="mb-3 rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Tick to show. The arrows reorder — Account always stays first.
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {COLS.map(c => {
              const on = cols.includes(c.id)
              return (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <label className="flex flex-1 items-center gap-2" title={c.title}>
                    <input type="checkbox" checked={on} onChange={() => toggleCol(c.id)} />
                    {c.label}
                  </label>
                  {on && (
                    <>
                      <button type="button" aria-label={`Move ${c.label} left`} className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => move(c.id, -1)}>←</button>
                      <button type="button" aria-label={`Move ${c.label} right`} className="px-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => move(c.id, 1)}>→</button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <p className="mb-2 text-sm text-muted-foreground">
        {shown.length === rows.length
          ? `${fmtNum(rows.length)} account${rows.length === 1 ? '' : 's'}`
          : `${fmtNum(shown.length)} of ${fmtNum(rows.length)} accounts`}
        {' · '}{fmtNum(shown.reduce((t, r) => t + r.total, 0))} surveys between them
        {offBook > 0 && (
          <span title="You are named as the salesperson on these, but their account belongs to someone else — so they appear on your surveys list without an account row here.">
            {' · '}{fmtNum(offBook)} more on accounts you don&apos;t own
          </span>
        )}
      </p>

      {/* The header is sticky rather than the table being scrolled in a box:
          the page scrolls, and `sticky top-0` on the cells keeps the labels
          against the viewport, which is what "stays frozen once you scroll down
          past it" describes. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              {sortHead('name', 'Account', 'The client account you own.', false)}
              {visible.map(c => sortHead(c.id, c.label, c.title))}
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/sales/accounts/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  {r.code && <span className="ml-2 text-xs text-muted-foreground">{r.code}</span>}
                </td>
                {visible.map(c => {
                  const isCredit = c.id.startsWith('credits')
                  // Nothing priced at all means the answer is "not recorded",
                  // not "nought". Rendering 0 here would have 31 of 34 accounts
                  // assert they have drawn no credits, when in fact no survey on
                  // them has ever been given a price. "0+?" is the worst of both
                  // — it reads as zero and footnotes itself.
                  const nothingPriced = isCredit && r.unpriced === r.total
                  const v = nothingPriced ? null : c.value(r)
                  return (
                    <td key={c.id} className="px-3 py-2 text-right tabular-nums">
                      {v == null ? (
                        <span className="text-muted-foreground/40" title={
                          nothingPriced
                            ? `None of this account's ${r.total} surveys is priced in credits yet — which is not the same as none being used.`
                            : c.id === 'creditsRemaining'
                              ? 'No term allowance recorded, so there is nothing to have remaining.'
                              : 'No term recorded for this account.'
                        }>—</span>
                      ) : v === 0 && !isCredit ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : c.href ? (
                        <Link href={c.href(r)} className="hover:underline">{fmtNum(v)}</Link>
                      ) : (
                        fmtNum(v)
                      )}
                      {/* A total drawn from a partly-priced set is a FLOOR, and
                          saying so is the difference between a number and a
                          misleading number. */}
                      {isCredit && v != null && r.unpriced > 0 && (
                        <span
                          className="ml-1 text-[10px] text-muted-foreground"
                          title={`${r.unpriced} of ${r.total} surveys have no credit figure yet, so this is a floor.`}
                        >+?</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && rows.length > 0 && (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          No account matches &ldquo;{q.trim()}&rdquo;.{' '}
          <button type="button" className="underline hover:text-foreground" onClick={() => setQ('')}>
            Clear the search
          </button>
        </p>
      )}
    </div>
  )
}

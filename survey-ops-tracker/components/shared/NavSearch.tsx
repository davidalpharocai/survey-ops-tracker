'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjects, type SlimProject } from '@/lib/hooks/useProjects'
import { useClients } from '@/lib/hooks/useClients'
import { useAllContacts } from '@/lib/hooks/useClientContacts'
import { scoreRow, isSearchable, RANK } from '@/lib/search/match'
import { searchPath } from '@/lib/search/objects'
import { stageOf } from '@/lib/sales/stage'

/**
 * The nav search: projects, clients and contacts over the cached lists, so it
 * answers on every keystroke.
 *
 * ── WHAT CHANGED 2026-09-23, AND WHY ────────────────────────────────────────
 * David: "can we make search window that pops up when one starts searching
 * expand more so i can see more of whats populating as i type? also, it should
 * be that if i type a word/characters in the search and just press enter
 * (without selecting something that popped up as a potential match) it brings
 * to a search page."
 *
 * Three things were wrong:
 *
 *   1. The caps were 5 projects, 3 clients, 4 contacts, AND THEY WERE SILENT.
 *      Typing "BAM" showed 5 of 69 surveys with nothing on screen saying the
 *      other 64 existed. Caps are now roughly double and every group states its
 *      full count, so a truncated list reads as truncated.
 *
 *   2. ENTER ALREADY DID SOMETHING. `sel` started at 0, so the first row was
 *      always selected and Enter opened it -- pressing Enter after typing threw
 *      you into a survey you never picked. Selection now starts at NOTHING
 *      (-1); the arrow keys opt into a row, and a bare Enter goes to /search.
 *      This is exactly the distinction David drew: "without selecting
 *      something that popped up".
 *
 *   3. A CONTACT HIT OPENED THE ACCOUNT, not the contact -- /clients/<client_id>
 *      -- which was correct only back when there was no contact page. There has
 *      been one at /contacts/[id] for a while. Same defect the sales search had.
 *
 * Ranking is scoreRow() from lib/search/match, shared with the results page, so
 * the order in this dropdown and the order on that page cannot disagree.
 */

type Hit = {
  key: string
  group: 'Surveys' | 'Contacts' | 'Accounts' | 'Actions'
  title: string
  sub?: string
  tag?: string
  rank: number
  run: () => void
}

// Roughly double the old caps. Deliberately not unbounded: this is a dropdown
// under a nav bar, and "everything" is what the results page is for.
const CAP = { project: 10, client: 6, contact: 8 }

export function NavSearch() {
  const router = useRouter()
  const { data: projects = [] } = useProjects()
  const { data: clients = [] } = useClients()
  const { data: contacts = [] } = useAllContacts()

  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  // -1 means NOTHING is selected, which is what makes a bare Enter mean "search
  // everything" rather than "open whatever happened to sort first".
  const [sel, setSel] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const go = (href: string) => { setOpen(false); setQ(''); router.push(href) }
  const seeAll = () => { const t = q.trim(); if (t) go(searchPath('analyst', t)) }

  const { hits, totals } = useMemo(() => {
    const s = q.trim()
    if (!isSearchable(s)) return { hits: [] as Hit[], totals: { Surveys: 0, Contacts: 0, Accounts: 0 } }
    const out: Hit[] = []

    const rank = (fields: (string | null | undefined)[]) => scoreRow(fields, s)

    // Surveys
    const pj = projects
      .map(p => ({ p, r: rank([p.project_code, p.project_name, p.client]) }))
      .filter(x => x.r !== RANK.miss)
      .sort((a, b) => a.r - b.r)
    for (const { p, r } of pj.slice(0, CAP.project)) {
      // The shared resolver, so this dropdown and the results page cannot
      // disagree about where a survey is -- and so neither of them labels a
      // delivered survey "Closed", which every delivered survey also is.
      const tag = stageOf({ status: p.status, phase: p.phase, board_column: p.board_column })
      out.push({
        key: `p-${p.id}`, group: 'Surveys', rank: r,
        title: `${p.project_code ? p.project_code + ' · ' : ''}${p.project_name}`,
        sub: p.client ?? '', tag: tag || undefined, run: () => go(`/projects/${p.id}`),
      })
    }

    // Contacts — to the CONTACT, not to their account.
    const ct = contacts
      .map(c => ({ c, full: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() }))
      .map(x => ({ ...x, r: rank([x.full, x.c.email, x.c.title]) }))
      .filter(x => x.r !== RANK.miss)
      .sort((a, b) => a.r - b.r)
    for (const { c, full, r } of ct.slice(0, CAP.contact)) {
      out.push({
        key: `ct-${c.id}`, group: 'Contacts', rank: r,
        title: full || (c.email ?? 'Contact'),
        sub: [c.title, c.clients?.name].filter(Boolean).join(' · ') || undefined,
        run: () => go(`/contacts/${c.id}`),
      })
    }

    // Accounts, each with a proposed "their surveys" action.
    const cl = clients
      .map(c => ({ c, r: rank([c.name, c.code]) }))
      .filter(x => x.r !== RANK.miss)
      .sort((a, b) => a.r - b.r)
    for (const { c, r } of cl.slice(0, CAP.client)) {
      out.push({ key: `c-${c.id}`, group: 'Accounts', rank: r, title: c.name, sub: c.code ?? 'Account', run: () => go(`/clients/${c.id}`) })
      out.push({ key: `cs-${c.id}`, group: 'Actions', rank: r, title: `${c.name}'s surveys`, tag: 'list', run: () => go(`/list?view=full&search=${encodeURIComponent(c.name)}`) })
    }

    const order = { Surveys: 0, Contacts: 1, Accounts: 2, Actions: 3 }
    out.sort((a, b) => order[a.group] - order[b.group] || a.rank - b.rank)
    return { hits: out, totals: { Surveys: pj.length, Contacts: ct.length, Accounts: cl.length } }
  }, [q, projects, clients, contacts])

  // A fresh query deselects. Without this, typing one more letter would leave a
  // stale row selected and Enter would open it instead of searching.
  useEffect(() => setSel(-1), [q])
  useEffect(() => setSel(s => (s >= hits.length ? -1 : s)), [hits.length])

  const showDropdown = open && isSearchable(q)

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (hits.length ? (s + 1) % hits.length : -1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (hits.length ? (s <= 0 ? hits.length - 1 : s - 1) : -1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (sel >= 0 && hits[sel]) hits[sel].run()
      else seeAll()
    }
  }

  const groupTotal = (g: Hit['group']): number | null =>
    g === 'Actions' ? null : totals[g as keyof typeof totals]

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0 max-w-md mx-auto">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search surveys, accounts, contacts…"
        aria-label="Deep search"
        className="w-full bg-muted/60 border border-border rounded-lg pl-7 pr-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:bg-background"
      />
      {showDropdown && (
        // Wider than the input and taller than it was: the panel is no longer
        // the constraint, so more of what matches is actually on screen.
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-[min(38rem,92vw)] bg-popover border border-border rounded-xl shadow-xl overflow-hidden max-h-[75vh] overflow-y-auto thin-scroll">
          {hits.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground text-center">
              Nothing here matches “{q.trim()}”.
            </p>
          ) : (
            hits.map((h, i) => {
              const firstOfGroup = i === 0 || hits[i - 1].group !== h.group
              const total = groupTotal(h.group)
              const capped = h.group === 'Surveys' ? CAP.project : h.group === 'Contacts' ? CAP.contact : CAP.client
              const more = total != null && total > capped ? total - capped : 0
              return (
                <div key={h.key}>
                  {firstOfGroup && (
                    <p className="flex items-baseline gap-2 px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">
                      <span>{h.group}</span>
                      {total != null && <span className="tabular-nums">{total}</span>}
                      {/* Never a silent cap. */}
                      {more > 0 && <span className="normal-case tracking-normal text-muted-foreground/60">+{more} more on the search page</span>}
                    </p>
                  )}
                  <button
                    onMouseEnter={() => setSel(i)}
                    onClick={h.run}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${i === sel ? 'bg-accent' : ''}`}
                  >
                    <span className="font-medium text-foreground truncate">{h.title}</span>
                    {h.sub && <span className="text-muted-foreground truncate text-[12px]">{h.sub}</span>}
                    {h.tag && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground border border-border rounded-full px-2 py-0.5">{h.tag}</span>}
                  </button>
                </div>
              )
            })
          )}

          <button
            onClick={seeAll}
            onMouseEnter={() => setSel(-1)}
            className={`w-full flex items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm transition-colors ${sel === -1 ? 'bg-accent' : ''}`}
          >
            <span className="text-muted-foreground">🔎</span>
            <span className="truncate">
              Search everything for <span className="font-medium text-foreground">“{q.trim()}”</span>
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">↵</span>
          </button>

          <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">
            ↑↓ pick a result · ↵ search everything · esc close · ⌘/ focus
          </div>
        </div>
      )}
    </div>
  )
}

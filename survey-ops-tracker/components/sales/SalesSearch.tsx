'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { scoreRow, isSearchable, RANK } from '@/lib/search/match'
import { searchPath } from '@/lib/search/objects'

/**
 * One search box over everything a salesperson owns — accounts, contacts and
 * surveys. David: "they should be able to search for a client or a contact".
 *
 * A VISIBLE FIELD, not a ⌘K palette. Linear and Notion hide search behind a
 * chord because their users live in the keyboard; the reader here opens the tool
 * a few times a week to answer "what's happening with Citadel". A palette you
 * have to know about is a feature that does not exist for that person. The
 * shortcut is wired up as well, for whoever wants it — but the box is on screen.
 *
 * FETCHES ONCE, FILTERS LOCALLY. The whole searchable set is one salesperson's
 * book: ~245 surveys, ~27 accounts and a few dozen contacts, which is a few tens
 * of kilobytes. A debounced round trip per keystroke would be slower, would
 * flicker, and would put a `.ilike` on every keystroke against three tables for
 * no benefit at this size. Re-fetched every five minutes; a survey created this
 * morning is not worth a websocket.
 *
 * Reads the sales_* VIEWS, never the base tables — see migrations 102 and 105.
 * The views are self-scoping, so there is no `.eq()` here that a later edit
 * could drop, and no way for this to return a row that belongs to someone else.
 */

type Hit = {
  kind: 'Account' | 'Contact' | 'Survey'
  id: string
  title: string
  subtitle: string
  href: string
}

const CAP: Record<Hit['kind'], number> = { Account: 8, Contact: 10, Survey: 14 }

export function SalesSearch() {
  const supabase = createClient()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  // -1 means NOTHING is selected. That is what lets a bare Enter mean "search
  // everything" rather than "open whichever row happened to sort first" --
  // David, 2026-09-23: "without selecting something that popped up".
  const [cursor, setCursor] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data } = useQuery({
    queryKey: ['sales-search-index'],
    queryFn: async () => {
      const [clients, contacts, projects] = await Promise.all([
        supabase.from('sales_clients').select('id, name, code'),
        supabase.from('sales_contacts').select('id, client_id, first_name, last_name, email, title'),
        supabase.from('sales_projects').select('id, project_code, project_name, client, board_column, status'),
      ])
      return {
        clients: clients.data ?? [],
        contacts: contacts.data ?? [],
        projects: projects.data ?? [],
        // A denied or failed read must not look like "you own nothing". The
        // dropdown says so rather than rendering a confident empty state.
        failed: [clients.error, contacts.error, projects.error].some(Boolean),
      }
    },
    staleTime: 300_000,
    retry: false,
  })

  const { hits, totals } = useMemo<{ hits: Hit[]; totals: Record<Hit['kind'], number> }>(() => {
    const needle = q.trim().toLowerCase()
    if (!isSearchable(needle) || !data) return { hits: [], totals: { Account: 0, Contact: 0, Survey: 0 } }
    const has = (...parts: (string | null | undefined)[]) =>
      scoreRow(parts, needle) !== RANK.miss

    const accounts: Hit[] = data.clients
      .filter(c => has(c.name, c.code))
      .map(c => ({
        kind: 'Account' as const,
        id: c.id,
        title: c.name,
        subtitle: c.code ?? 'Account',
        href: `/sales/accounts/${c.id}`,
      }))

    const byClient = new Map(data.clients.map(c => [c.id, c.name]))
    const people: Hit[] = data.contacts
      .filter(c => has(c.first_name, c.last_name, c.email, c.title))
      .map(c => ({
        kind: 'Contact' as const,
        id: c.id,
        title: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.email ?? 'Contact'),
        subtitle: [c.title, byClient.get(c.client_id ?? '')].filter(Boolean).join(' · ') || '—',
        // The contact's own page, not their account. This used to land on the
        // account because /sales/contacts/[id] did not exist -- a Contact hit
        // that opens an Account is a wrong answer dressed as a right one.
        href: `/sales/contacts/${c.id}`,
      }))

    const surveys: Hit[] = data.projects
      .filter(p => has(p.project_name, p.project_code, p.client))
      .map(p => ({
        kind: 'Survey' as const,
        id: p.id,
        title: p.project_name,
        subtitle: [p.project_code, p.client, p.status === 'Open' ? p.board_column : p.status]
          .filter(Boolean).join(' · '),
        href: `/sales/surveys/${p.id}`,
      }))

    // Accounts and contacts first: a name typed into this box is far more often
    // a who than a what, and surveys are the long tail that would otherwise bury
    // them.
    //
    // The caps roughly doubled on 2026-09-23 (David: "expand more so i can see
    // more of whats populating as i type"), and each group now states its FULL
    // count below, so a truncated list reads as truncated instead of as
    // "that is all there is". Everything beyond these is on the search page.
    return {
      hits: [...accounts.slice(0, CAP.Account), ...people.slice(0, CAP.Contact), ...surveys.slice(0, CAP.Survey)],
      totals: { Account: accounts.length, Contact: people.length, Survey: surveys.length },
    }
  }, [q, data])

  useEffect(() => setCursor(-1), [q])

  // Close on an outside click, and open the box on ⌘K / Ctrl-K for whoever wants
  // it. The box is visible either way; this is an accelerator, not the door.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function go(h: Hit) {
    setOpen(false)
    setQ('')
    router.push(h.href)
  }

  function seeAll() {
    const t = q.trim()
    if (!t) return
    setOpen(false)
    setQ('')
    router.push(searchPath('sales', t))
  }

  const showDropdown = open && q.trim().length >= 2

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="Search accounts, contacts, surveys…"
        aria-label="Search your accounts, contacts and surveys"
        onChange={e => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
          if (!showDropdown) return
          if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setCursor(c => (c + 1) % hits.length) }
          if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setCursor(c => (c <= 0 ? hits.length - 1 : c - 1)) }
          // Enter fires even with zero hits: "nothing in the dropdown" is itself
          // a reason to want the full search page.
          if (e.key === 'Enter') { e.preventDefault(); if (cursor >= 0 && hits[cursor]) go(hits[cursor]); else seeAll() }
        }}
        className="w-44 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:w-64 focus:border-ring focus:outline-none md:w-56"
      />

      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-[75vh] w-[min(32rem,92vw)] overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {data?.failed ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Couldn&apos;t load search right now — this isn&apos;t &ldquo;nothing found&rdquo;. Try again, or tell David.
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              Nothing matching &ldquo;{q.trim()}&rdquo; on your accounts.
            </p>
          ) : (
            hits.map((h, i) => {
              const firstOfKind = i === 0 || hits[i - 1].kind !== h.kind
              const more = totals[h.kind] - CAP[h.kind]
              return (
                <div key={`${h.kind}-${h.id}`}>
                  {firstOfKind && (
                    <p className="flex items-baseline gap-2 border-t border-border/50 px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70 first:border-t-0">
                      <span>{h.kind}s</span>
                      <span className="tabular-nums">{totals[h.kind]}</span>
                      {/* Never a silent cap. */}
                      {more > 0 && (
                        <span className="normal-case tracking-normal text-muted-foreground/60">
                          +{more} more on the search page
                        </span>
                      )}
                    </p>
                  )}
                  <button
                    onClick={() => go(h)}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      'flex w-full items-baseline gap-2 px-3 py-2 text-left transition-colors',
                      i === cursor ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{h.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{h.subtitle}</span>
                    </span>
                  </button>
                </div>
              )
            })
          )}

          {/* Always present, even when nothing matched above -- an empty
              dropdown is exactly when someone wants the wider search. */}
          <button
            onClick={seeAll}
            onMouseEnter={() => setCursor(-1)}
            className={cn(
              'flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm transition-colors',
              cursor === -1 ? 'bg-muted' : 'hover:bg-muted/60',
            )}
          >
            <span className="truncate">
              Search everything for <span className="font-medium text-foreground">&ldquo;{q.trim()}&rdquo;</span>
            </span>
            <span className="ml-auto shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              &crarr;
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

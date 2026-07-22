'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjects, type SlimProject } from '@/lib/hooks/useProjects'
import { useClients } from '@/lib/hooks/useClients'
import { useAllContacts } from '@/lib/hooks/useClientContacts'

// Deep nav search: projects (PR#, name, client, keywords), clients, and contacts —
// each entity plus a proposed "<name>'s surveys" action that opens the filtered list.
// Client-side over the cached lists, so it's instant and offline-safe.

type Hit = {
  key: string
  group: 'Projects' | 'Clients' | 'Contacts' | 'Actions'
  title: string
  sub?: string
  tag?: string
  run: () => void
}

const CAP = { project: 5, client: 3, contact: 4 }

export function NavSearch() {
  const router = useRouter()
  const { data: projects = [] } = useProjects()
  const { data: clients = [] } = useClients()
  const { data: contacts = [] } = useAllContacts()

  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Ctrl/Cmd+/ focuses the search from anywhere.
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

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const go = (href: string) => { setOpen(false); setQ(''); router.push(href) }

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase()
    if (s.length < 2) return []
    const out: Hit[] = []

    // Projects — PR code / name / client (keyword) match, ranked.
    const pj: { p: SlimProject; r: number }[] = []
    for (const p of projects) {
      const code = (p.project_code ?? '').toLowerCase()
      const name = (p.project_name ?? '').toLowerCase()
      const client = (p.client ?? '').toLowerCase()
      let r = -1
      if (code === s) r = 0
      else if (code.includes(s)) r = 1
      else if (name.startsWith(s)) r = 2
      else if (name.includes(s)) r = 3
      else if (client.includes(s)) r = 4
      if (r >= 0) pj.push({ p, r })
    }
    pj.sort((a, b) => a.r - b.r)
    for (const { p } of pj.slice(0, CAP.project)) {
      const tag = p.phase === 'Active' ? (p.status === 'Open' ? p.board_column ?? '' : p.status ?? '') : p.phase ?? ''
      out.push({
        key: `p-${p.id}`, group: 'Projects', title: `${p.project_code ? p.project_code + ' · ' : ''}${p.project_name}`,
        sub: p.client ?? '', tag: tag ?? undefined, run: () => go(`/projects/${p.id}`),
      })
    }

    // Clients — name match → entity + "<client>'s surveys".
    const cl = clients.filter((c) => (c.name ?? '').toLowerCase().includes(s)).slice(0, CAP.client)
    for (const c of cl) {
      out.push({ key: `c-${c.id}`, group: 'Clients', title: c.name, sub: c.code ?? 'Client', run: () => go(`/clients/${c.id}`) })
      out.push({ key: `cs-${c.id}`, group: 'Actions', title: `${c.name}'s surveys`, tag: 'search', run: () => go(`/list?view=full&search=${encodeURIComponent(c.name)}`) })
    }

    // Contacts — full-name match → the contact (its client page) + "<name>'s surveys".
    const seenName = new Set<string>()
    const ct = contacts
      .map((c) => ({ c, full: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() }))
      .filter((x) => x.full.toLowerCase().includes(s))
      .slice(0, CAP.contact)
    for (const { c, full } of ct) {
      out.push({ key: `ct-${c.id}`, group: 'Contacts', title: full, sub: `Contact · ${c.clients?.name ?? '—'}`, run: () => go(`/clients/${c.client_id}`) })
      const nk = full.toLowerCase()
      if (!seenName.has(nk)) {
        seenName.add(nk)
        out.push({ key: `cts-${c.id}`, group: 'Actions', title: `${full}'s surveys`, tag: 'search', run: () => go(`/list?view=full&search=${encodeURIComponent(full)}`) })
      }
    }

    // Order groups: Projects, Contacts, Clients, then the Actions.
    const order = { Projects: 0, Contacts: 1, Clients: 2, Actions: 3 }
    return out.sort((a, b) => order[a.group] - order[b.group])
  }, [q, projects, clients, contacts])

  useEffect(() => setSel(0), [q])
  useEffect(() => setSel((s) => Math.min(s, Math.max(0, hits.length - 1))), [hits.length])

  const showDropdown = open && q.trim().length >= 2

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (hits.length ? (s + 1) % hits.length : 0)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (hits.length ? (s - 1 + hits.length) % hits.length : 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); hits[sel]?.run() }
  }

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0 max-w-md mx-auto">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">🔍</span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search projects, clients, contacts…"
        aria-label="Deep search"
        className="w-full bg-muted/60 border border-border rounded-lg pl-7 pr-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:bg-background"
      />
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden max-h-[70vh] overflow-y-auto thin-scroll">
          {hits.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted-foreground text-center">No matches for “{q.trim()}”.</p>
          ) : (
            hits.map((h, i) => {
              const firstOfGroup = i === 0 || hits[i - 1].group !== h.group
              return (
                <div key={h.key}>
                  {firstOfGroup && (
                    <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground/70">{h.group}</p>
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
          <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground">↑↓ navigate · ↵ open · esc close · ⌘/ focus</div>
        </div>
      )}
    </div>
  )
}

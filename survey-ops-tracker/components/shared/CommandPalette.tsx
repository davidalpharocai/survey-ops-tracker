'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useProjects, type SlimProject } from '@/lib/hooks/useProjects'

type PaletteItem =
  | { kind: 'project'; project: SlimProject }
  | { kind: 'action'; id: string; label: string; href: string }

const ACTIONS: { id: string; label: string; href: string }[] = [
  { id: 'new-project', label: 'New project', href: '/?new=1' },
  { id: 'go-board', label: 'Go to board', href: '/' },
  { id: 'go-list', label: 'Go to list', href: '/list' },
  { id: 'go-reruns', label: 'Go to reruns', href: '/reruns' },
]

const MAX_RESULTS = 8

/** Rank project matches: name startsWith > name includes > client includes. */
function matchProjects(projects: SlimProject[], query: string): SlimProject[] {
  const q = query.toLowerCase()
  const starts: SlimProject[] = []
  const nameHits: SlimProject[] = []
  const clientHits: SlimProject[] = []
  for (const p of projects) {
    const name = (p.project_name ?? '').toLowerCase()
    const client = (p.client ?? '').toLowerCase()
    if (name.startsWith(q)) starts.push(p)
    else if (name.includes(q)) nameHits.push(p)
    else if (client.includes(q)) clientHits.push(p)
  }
  return [...starts, ...nameHits, ...clientHits].slice(0, MAX_RESULTS)
}

/**
 * Global Ctrl+K / Cmd+K command palette: jump to any project by name or
 * client, or type ">" for quick actions. Mounted once in the app layout.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: projects = [] } = useProjects()

  // Ctrl+Shift+K / Cmd+Shift+K toggles from anywhere — deliberately NOT guarded
  // by isTypingTarget: a modified chord never types a character, so it's safe
  // (and expected) even while focus is in an input. (Plain Ctrl/Cmd+K is owned
  // by the ✦ Assistant panel, so the palette uses the Shift variant.)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Fresh palette every open + focus the search box
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // rAF: the input mounts in this same commit
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    const trimmed = query.trim()
    if (trimmed.startsWith('>')) {
      const actionQuery = trimmed.slice(1).trim().toLowerCase()
      return ACTIONS.filter(a => a.label.toLowerCase().includes(actionQuery)).map(
        a => ({ kind: 'action' as const, ...a })
      )
    }
    if (trimmed === '') {
      // A few recent projects (cache is ordered created_at desc) + all actions
      const recent = projects
        .slice(0, MAX_RESULTS - ACTIONS.length)
        .map(p => ({ kind: 'project' as const, project: p }))
      return [...recent, ...ACTIONS.map(a => ({ kind: 'action' as const, ...a }))]
    }
    return matchProjects(projects, trimmed).map(p => ({
      kind: 'project' as const,
      project: p,
    }))
  }, [query, projects])

  // Keep the highlight on a real row when the list shrinks
  useEffect(() => {
    setSelected(s => Math.min(s, Math.max(0, items.length - 1)))
  }, [items.length])

  function close() {
    setOpen(false)
  }

  function activate(item: PaletteItem) {
    close()
    if (item.kind === 'project') {
      router.push(`/projects/${item.project.id}`)
      return
    }
    // Already on the board? /?new=1 wouldn't remount the page, so its
    // on-mount query check never re-runs — tell it directly instead.
    if (item.id === 'new-project' && window.location.pathname === '/') {
      window.dispatchEvent(new CustomEvent('sot:open-new-project'))
      return
    }
    router.push(item.href)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => (items.length === 0 ? 0 : (s + 1) % items.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => (items.length === 0 ? 0 : (s - 1 + items.length) % items.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[selected]
      if (item) activate(item)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mt-[15vh] mx-auto w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Search projects, or type > for actions…"
          className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground px-4 py-3 border-b border-border outline-none"
        />
        <div className="overflow-y-auto max-h-80">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">
              No matches
            </p>
          ) : (
            items.map((item, i) => (
              <button
                key={item.kind === 'project' ? item.project.id : item.id}
                onClick={() => activate(item)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selected ? 'bg-accent' : ''
                }`}
              >
                {item.kind === 'project' ? (
                  <>
                    <span className="font-medium text-foreground truncate">
                      {item.project.project_name}
                    </span>
                    <span className="text-muted-foreground truncate">
                      {item.project.client}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground border border-border rounded-full px-2 py-0.5">
                      {item.project.phase === 'Active'
                        ? item.project.status === 'Open'
                          ? item.project.board_column
                          : item.project.status
                        : item.project.phase}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
                      ⌘
                    </span>
                    <span className="text-foreground">{item.label}</span>
                  </>
                )}
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          ↑↓ navigate · ↵ open · esc close
        </div>
      </div>
    </div>
  )
}

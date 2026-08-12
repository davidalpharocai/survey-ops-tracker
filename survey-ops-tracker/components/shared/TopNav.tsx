'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { NavSearch } from '@/components/shared/NavSearch'

const HANDOVER_URL =
  'https://docs.google.com/document/d/1rkT0KYApcvYU1BlK-TO_lfiXyhL0FuGIPz9UjduSJgk/edit'

// Primary destinations promoted to top-level tabs (the former ☰ menu). Board is
// the home/logo; List + Operations/Full View stay as the projects-page toggles;
// the Assistant is the floating ✦ + ⌘K. Low-frequency / external items live
// under "More".
interface Tab {
  href: string
  label: string
  icon: string
  title: string
  badge?: number
}

// The ribbon's default left-to-right order (hrefs). The `tabs` array below is
// built in this same order. Users can drag any tab to reorder; their order is
// remembered per-browser (NAV_ORDER_KEY) and "Reset ribbon order" in More
// restores this default. Keep this list in sync with the `tabs` array's order.
const DEFAULT_TAB_ORDER = ['/reruns', '/calendar', '/review', '/admin'] as const
const NAV_ORDER_KEY = 'socc.nav.order.v1'

/** Hydrate a persisted ribbon order from localStorage. Mirrors the List view's
 *  column-order pattern: keep only hrefs that still exist (drops a tab removed
 *  from the registry), and APPEND any known tab missing from the stored list —
 *  so a tab added after a user saved their order shows up (at the end) instead
 *  of vanishing until they reset. Returns null (→ caller keeps the default)
 *  when nothing valid survives or storage is unreadable. */
function loadNavOrder(validHrefs: readonly string[]): string[] | null {
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter((h): h is string => typeof h === 'string' && validHrefs.includes(h))
    if (valid.length === 0) return null
    const missing = validHrefs.filter((h) => !valid.includes(h))
    return [...valid, ...missing]
  } catch {
    return null
  }
}

function saveNavOrder(order: string[]) {
  try {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order))
  } catch {
    // storage unavailable/full — the in-memory order still works this visit
  }
}

const menuItemClass =
  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground/90 hover:bg-accent hover:text-foreground transition-colors'

export function TopNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  // Pending Deliverables-review + Email-review + overdue Rerun counts → badges. Fail soft to 0.
  const { data: emailPending = 0 } = useQuery({
    queryKey: ['email-review-count'],
    queryFn: async () => {
      const { count } = await createClient()
        .from('email_inbox')
        .select('id', { count: 'exact', head: true })
        .in('status', ['review', 'pending_no_project'])
      return count ?? 0
    },
    staleTime: 60_000,
  })
  const { data: delivPending = 0 } = useQuery({
    queryKey: ['deliverables-review-count'],
    queryFn: async () => {
      const { count } = await createClient()
        .from('deliverables')
        .select('id', { count: 'exact', head: true })
        .in('status', ['review', 'unsorted'])
        .is('deleted_at', null)
      return count ?? 0
    },
    staleTime: 60_000,
  })
  const { data: rerunOverdue = 0 } = useQuery({
    queryKey: ['rerun-overdue-count'],
    queryFn: async () => {
      const supabase = createClient()
      // Overdue count from the first-class rerun model (rerun_series_status) only.
      // The legacy sheet mirror (rerun_status) is retired as a rerun view and no
      // longer contributes to the badge — so the count reflects real, current
      // first-class reruns needing action.
      const { count } = await supabase
        .from('rerun_series_status')
        .select('id', { count: 'exact', head: true })
        .eq('is_overdue', true)
      return count ?? 0
    },
    staleTime: 60_000,
  })

  // Close More on navigation / outside-click / Escape.
  useEffect(() => setMoreOpen(false), [pathname])
  useEffect(() => {
    if (!moreOpen) return
    function onPointerDown(e: PointerEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [moreOpen])

  const tabs: Tab[] = [
    { href: '/reruns', label: 'Reruns', icon: '🔁', title: 'Reruns — recurring surveys on a calendar / list / series view; badge = overdue', badge: rerunOverdue },
    { href: '/calendar', label: 'Calendar', icon: '📅', title: 'Calendar — every dated event on a month grid, filterable by captain, type, client, and more' },
    // Combined Deliverables + Email review — rendered specially below (two icons,
    // two counts). Kept in the tabs array so it can be reordered like the rest.
    { href: '/review', label: 'Review', icon: '📦', title: 'Review — emailed deliverables we couldn’t auto-file, and client emails we couldn’t tie to a project, in two columns to file or dismiss' },
    { href: '/admin', label: 'Admin', icon: '⚙️', title: 'Admin — system links, client ids, roster, recently deleted, and data health' },
  ]
  const tabsByHref = new Map(tabs.map((t) => [t.href, t]))

  // Personal-to-browser ribbon order. SSR + first client paint use the default
  // (deterministic, so no hydration mismatch); a mount-only effect then applies
  // the user's saved order. Same convention as the List view's column prefs.
  const [order, setOrder] = useState<string[]>([...DEFAULT_TAB_ORDER])
  useEffect(() => {
    const stored = loadNavOrder(DEFAULT_TAB_ORDER)
    if (stored) setOrder(stored)
  }, [])

  const isCustomized =
    order.length !== DEFAULT_TAB_ORDER.length || order.some((h, i) => h !== DEFAULT_TAB_ORDER[i])

  // Native HTML5 drag-and-drop (deliberately NOT a dnd library): the tabs stay
  // real <a href> links, so a plain click navigates and cmd/middle/right-click
  // still "open in new tab" — a drag only starts on an actual drag gesture. We
  // track the tab being dragged + the current drop target for the visual cue.
  const [dragHref, setDragHref] = useState<string | null>(null)
  const [overHref, setOverHref] = useState<string | null>(null)

  function moveTab(fromHref: string, toHref: string) {
    if (fromHref === toHref) return
    setOrder((prev) => {
      const from = prev.indexOf(fromHref)
      const to = prev.indexOf(toHref)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, fromHref)
      saveNavOrder(next)
      return next
    })
  }

  function resetNavOrder() {
    setOrder([...DEFAULT_TAB_ORDER])
    try {
      localStorage.removeItem(NAV_ORDER_KEY)
    } catch {
      /* ignore */
    }
    setMoreOpen(false)
  }

  const isProjects = pathname === '/' || pathname === '/list'
  const tabClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return `inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-colors ${
      active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`
  }

  // The clickable tab itself (the draggable wrapper div is added below).
  // `draggable={false}` suppresses the browser's native link-drag ghost so only
  // the dnd sensor drives reordering; a plain click still navigates.
  function renderTab(t: Tab) {
    if (t.href === '/review') {
      // Combined review item: "📦 Deliverables [#] / ✉️ Email [#] Review".
      // Each count is a badge, shown only when > 0.
      return (
        <Link href={t.href} title={t.title} className={tabClass(t.href)} draggable={false}>
          <span aria-hidden="true">📦</span>
          <span>Deliverables</span>
          {delivPending > 0 && (
            <span className="text-[12px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
              {delivPending}
            </span>
          )}
          <span className="text-muted-foreground/50">/</span>
          <span aria-hidden="true">✉️</span>
          <span>Email</span>
          {emailPending > 0 && (
            <span className="text-[12px] font-medium px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
              {emailPending}
            </span>
          )}
          <span>Review</span>
        </Link>
      )
    }
    return (
      <Link href={t.href} title={t.title} className={tabClass(t.href)} draggable={false}>
        <span aria-hidden="true">{t.icon}</span> {t.label}
        {!!t.badge && t.badge > 0 && (
          <span
            className={`ml-0.5 text-[12px] font-medium px-1.5 py-0.5 rounded-full ${
              t.href === '/reruns'
                ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                : 'bg-primary/15 text-primary'
            }`}
          >
            {t.badge}
          </span>
        )}
      </Link>
    )
  }

  return (
    <nav className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-1.5 flex items-center gap-2 flex-wrap">
      <Link
        href="/"
        title="Board — the kanban home"
        className={`inline-flex items-center gap-1.5 font-bold text-sm px-1.5 py-1 rounded-lg transition-colors ${
          isProjects ? 'text-foreground' : 'text-foreground/80 hover:text-foreground'
        }`}
      >
        {/* Real AlphaROC wordmark (same asset as the Credit Management app). It's
            a white logo, so invert it on the light nav and leave it as-is on dark. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/alpharoc-logo.png"
          alt="AlphaROC"
          className="h-5 w-auto shrink-0 invert dark:invert-0"
        />
        Survey Ops
      </Link>

      <div className="flex items-center gap-0.5 flex-wrap">
        {/* Draggable primary tabs. Native HTML5 DnD keeps each tab a real link:
            a plain click navigates, cmd/middle/right-click opens a new tab, and a
            drag reorders + persists (per-browser). The dragged tab dims; the drop
            target shows a ring. */}
        <div className="flex items-center gap-0.5">
          {order.map((href) => {
            const t = tabsByHref.get(href)
            if (!t) return null
            const isDragged = dragHref === href
            const isDropTarget = overHref === href && dragHref !== null && dragHref !== href
            return (
              <div
                key={href}
                draggable
                onDragStart={(e) => {
                  setDragHref(href)
                  e.dataTransfer.effectAllowed = 'move'
                  try {
                    e.dataTransfer.setData('text/plain', href)
                  } catch {
                    /* some browsers restrict setData — the state ref is enough */
                  }
                }}
                onDragEnd={() => {
                  setDragHref(null)
                  setOverHref(null)
                }}
                onDragOver={(e) => {
                  // Always allow the drop (a tab is the only thing draggable in the
                  // nav). preventDefault is what makes this a valid drop target.
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overHref !== href) setOverHref(href)
                }}
                onDragLeave={() => {
                  if (overHref === href) setOverHref(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  // Read the dragged tab from the dataTransfer (set in onDragStart)
                  // rather than React state, so the reorder never depends on a
                  // state commit landing between the drag events.
                  const from = e.dataTransfer.getData('text/plain') || dragHref
                  if (from) moveTab(from, href)
                  setDragHref(null)
                  setOverHref(null)
                }}
                title="Drag to reorder — your ribbon order is remembered on this device"
                className={`inline-flex cursor-grab active:cursor-grabbing rounded-lg transition-[opacity,box-shadow] ${
                  isDragged ? 'opacity-40' : ''
                } ${isDropTarget ? 'ring-1 ring-ring bg-accent/40' : ''}`}
              >
                {renderTab(t)}
              </div>
            )
          })}
        </div>

        {/* More — low-frequency / external destinations */}
        <div ref={moreRef} className="relative">
          <button
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
            title="More — Insights, Internal Projects, Connect your Claude, and the docs"
            className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <span aria-hidden="true">⋯</span> More
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-full mt-2 z-50 w-60 bg-popover border border-border rounded-xl shadow-xl p-1.5 flex flex-col">
              <Link href="/insights" className={menuItemClass} title="Insights — pipeline rollup, deadlines, on-time delivery, workload, budget">
                <span>📊</span> Insights
              </Link>
              <Link href="/internal" className={menuItemClass} title="Internal Projects — AlphaROC's own work on a sprint-based board">
                <span>🧰</span> Internal Projects
              </Link>
              <Link href="/connect" className={menuItemClass} title="Connect your Claude — link claude.ai / Desktop / Code (analyst-only)">
                <span>🔌</span> Connect your Claude
              </Link>
              <div className="border-t border-border my-1.5" />
              <Link href="/guide" className={menuItemClass} title="How to use the tracker — the in-app guide (always current)">
                <span>📖</span> User Guide
              </Link>
              <a href={HANDOVER_URL} target="_blank" rel="noopener noreferrer" className={menuItemClass} title="Systems, accounts, and runbooks — opens the Google Doc">
                <span>🛟</span> Systems &amp; Handover <span className="ml-auto text-xs text-muted-foreground">↗</span>
              </a>
              <div className="border-t border-border my-1.5" />
              {/* Ribbon customization. The tip is always shown (discoverability);
                  Reset appears only once the order has been changed. */}
              <div className="px-3 py-1 text-[11px] text-muted-foreground/80 flex items-center gap-2">
                <span aria-hidden="true">⠿</span> Drag ribbon tabs to reorder
              </div>
              {isCustomized && (
                <button onClick={resetNavOrder} className={menuItemClass} title="Restore the ribbon to its default order (Reruns · Calendar · Review · Admin)">
                  <span>↺</span> Reset ribbon order
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <NavSearch />

      <div className="ml-auto flex items-center gap-3">
        <span
          title="Ctrl+K opens the ✦ Assistant · Ctrl+Shift+K opens the command palette (jump to any project)"
          className="hidden md:inline-flex text-[12px] border border-border rounded px-1.5 py-0.5 text-muted-foreground"
        >
          ✦ Ctrl+K
        </span>
        <ThemeToggle />
      </div>
    </nav>
  )
}

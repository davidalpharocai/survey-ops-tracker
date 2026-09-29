'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { NavSearch } from '@/components/shared/NavSearch'
import { UserMenu } from '@/components/shared/UserMenu'
import { hasUnreadChanges } from '@/lib/changelog/seen'
import { useCanViewFinancials } from '@/lib/hooks/useCapabilities'

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
//
// '/finance' is in the ORDER for everyone but in the TABS only for finance
// holders (David, 2026-09-24: Finance moves into the ribbon, shown only to the
// people who may open it). Keeping it in the order means a holder's saved
// order behaves like any other tab's; leaving it out of the tabs means a
// non-holder can never see it, whatever order their browser has saved. The
// page itself is gated on the server as well (app/(app)/finance/layout.tsx) —
// hiding a link is not a permission check.
//
// '/insights' leads, and '/admin' has left for the account menu (David,
// 2026-09-29: "lets move insights to the main nav bar so analysts see it").
// Insights had been sitting in the "More" menu, which is where this app puts
// things people are not expected to open — the opposite of the intent.
//
// NO STORAGE KEY BUMP IS NEEDED for that swap. mergeNavOrder drops a saved
// href that is no longer a default (so '/admin' falls out of an order saved
// last week) and inserts a default that is missing from the saved list after
// the nearest tab preceding it (so '/insights', first in this list, lands at
// the front). The reconciling this needs is the reconciling it already does.
export const DEFAULT_TAB_ORDER = ['/insights', '/reruns', '/calendar', '/finance', '/review'] as const
export const NAV_ORDER_KEY = 'socc.nav.order.v1'

/**
 * A saved ribbon order, reconciled with today's tabs. Keeps only hrefs that
 * still exist (drops a tab removed from the registry, and duplicates), and
 * INSERTS any known tab missing from the saved list right after the nearest
 * tab that precedes it in the default order — so a tab added after someone
 * saved their order (Finance, 2026-09-28) appears where it belongs, after
 * Calendar, instead of vanishing until they reset or landing at the far end.
 * Returns null (→ caller keeps the default) when nothing valid survives.
 */
export function mergeNavOrder(stored: unknown, defaults: readonly string[]): string[] | null {
  if (!Array.isArray(stored)) return null
  const out = [...new Set(stored.filter((h): h is string => typeof h === 'string' && defaults.includes(h)))]
  if (out.length === 0) return null
  defaults.forEach((h, i) => {
    if (out.includes(h)) return
    let at = -1
    for (let j = i - 1; j >= 0 && at < 0; j--) at = out.indexOf(defaults[j])
    out.splice(at + 1, 0, h)
  })
  return out
}

/** Hydrate a persisted ribbon order from localStorage (mergeNavOrder does the
 *  reconciling). Null when nothing is stored or storage is unreadable. */
function loadNavOrder(validHrefs: readonly string[]): string[] | null {
  try {
    const raw = localStorage.getItem(NAV_ORDER_KEY)
    if (!raw) return null
    return mergeNavOrder(JSON.parse(raw), validHrefs)
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
  // False while the check loads and on any error, so Finance appears only once
  // we KNOW the reader holds the permission — never a flash of it for others.
  const canFinance = useCanViewFinancials()

  // Publish the nav's height as --topnav-h, so a page's own sticky bar (the
  // finance filter bar) can sit just under it. The nav wraps to two or three
  // lines on a narrow screen, so a fixed offset would slide that bar under it.
  const navRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const publish = () => document.documentElement.style.setProperty('--topnav-h', `${el.offsetHeight}px`)
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Whether there is a changelog entry this browser hasn't seen. Starts FALSE
  // and is filled in after mount on purpose: localStorage doesn't exist during
  // server rendering, so reading it in the initial state would make the server
  // and client markup disagree and React would blow the whole tree away with a
  // hydration error. A dot that appears a frame late costs nothing.
  const [seenStale, setSeenStale] = useState(false)
  useEffect(() => {
    setSeenStale(hasUnreadChanges())
  }, [pathname])
  // Suppressed while actually ON the changelog. Both this effect and the page's
  // "mark as read" effect run in the same tick on that navigation, so reading
  // localStorage here would still see the OLD value and the dot would linger for
  // one more navigation. Hiding it on the page itself is both correct and what a
  // reader expects; by the time they navigate away the marker has been written.
  const unread = seenStale && pathname !== '/changelog'
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
    { href: '/insights', label: 'Insights', icon: '📊', title: 'Insights — what the team delivered, on time, cycle time, and open work right now, over a date range you choose' },
    { href: '/reruns', label: 'Reruns', icon: '🔁', title: 'Reruns — recurring surveys on a calendar / list / series view; badge = overdue', badge: rerunOverdue },
    { href: '/calendar', label: 'Calendar', icon: '📅', title: 'Calendar — every dated event on a month grid, filterable by captain, type, client, and more' },
    // Finance holders only (see DEFAULT_TAB_ORDER). Absent from this list for
    // everyone else, so no saved order can bring it back for them.
    ...(canFinance
      ? [{ href: '/finance', label: 'Finance', icon: '💵', title: 'Finance — what we charged, what fielding cost and what we kept; the money still moving this week; the cost of one respondent; and which records to fill in. Finance team only.' }]
      : []),
    // Combined Deliverables + Email review — rendered specially below (two icons,
    // two counts). Kept in the tabs array so it can be reordered like the rest.
    { href: '/review', label: 'Review', icon: '📦', title: 'Review — emailed deliverables we couldn’t auto-file, and client emails we couldn’t tie to a project, in two columns to file or dismiss' },
    // Admin is no longer a ribbon tab: it lives in the account menu (UserMenu),
    // with Sign out, because it is something you do to the system rather than a
    // place you work.
  ]
  const tabsByHref = new Map(tabs.map((t) => [t.href, t]))
  // The default order in words, as this reader sees it (no Finance for a
  // non-holder), for the Reset button's tooltip.
  const defaultOrderWords = DEFAULT_TAB_ORDER.map((h) => tabsByHref.get(h)?.label).filter(Boolean).join(' · ')

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
    <nav ref={navRef} className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border px-6 py-1.5 flex items-center gap-2 flex-wrap">
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
            title="More — Internal Projects, Connect your Claude, and the docs"
            className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <span aria-hidden="true">⋯</span> More
            {/* Surfaced on the button too, not only on the item inside — a dot
                nobody can see until they open the menu announces nothing. */}
            {unread && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
          </button>
          {moreOpen && (
            <div className="absolute left-0 top-full mt-2 z-50 w-60 bg-popover border border-border rounded-xl shadow-xl p-1.5 flex flex-col">
              {/* Insights is no longer here either: it is a ribbon tab now
                  (2026-09-29). Finance left earlier, shown only to finance
                  holders (see DEFAULT_TAB_ORDER). */}
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
              <Link href="/changelog" className={menuItemClass} title="What's new — everything that changed in the tracker, newest first">
                <span>✨</span> What&rsquo;s new
                {unread && (
                  <span
                    className="ml-auto w-2 h-2 rounded-full bg-blue-500"
                    title="There's something new since you last looked"
                  />
                )}
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
                <button onClick={resetNavOrder} className={menuItemClass} title={`Restore the ribbon to its default order (${defaultOrderWords})`}>
                  <span>↺</span> Reset ribbon order
                </button>
              )}
              {/* Sign out moved to the account menu (UserMenu), beside Admin —
                  it was the last line under a ribbon-reordering tip, which is
                  not where anyone looks for it. /signout stays typeable and
                  reachable from every tier, which is the part that matters. */}
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
        <UserMenu />
      </div>
    </nav>
  )
}

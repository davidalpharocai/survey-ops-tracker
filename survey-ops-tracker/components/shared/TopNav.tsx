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
    { href: '/calendar', label: 'Calendar', icon: '📅', title: 'Calendar — every dated event on a month grid, filterable by captain, type, client, and more' },
    // Combined Deliverables + Email review — rendered specially below (two icons,
    // two counts). Kept in the tabs array so it holds its position after Calendar.
    { href: '/review', label: 'Review', icon: '📦', title: 'Review — emailed deliverables we couldn’t auto-file, and client emails we couldn’t tie to a project, in two columns to file or dismiss' },
    { href: '/reruns', label: 'Reruns', icon: '🔁', title: 'Reruns — recurring surveys on a calendar / list / series view; badge = overdue', badge: rerunOverdue },
    { href: '/admin', label: 'Admin', icon: '⚙️', title: 'Admin — system links, client ids, roster, recently deleted, and data health' },
  ]

  const isProjects = pathname === '/' || pathname === '/list'
  const tabClass = (href: string) => {
    const active = pathname === href || pathname.startsWith(href + '/')
    return `inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg transition-colors ${
      active ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
    }`
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
        {tabs.map(t =>
          t.href === '/review' ? (
            // Combined review item: "📦 Deliverables [#] / ✉️ Email [#] Review".
            // Each count is a badge, shown only when > 0.
            <Link key={t.href} href={t.href} title={t.title} className={tabClass(t.href)}>
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
          ) : (
            <Link key={t.href} href={t.href} title={t.title} className={tabClass(t.href)}>
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
        )}

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

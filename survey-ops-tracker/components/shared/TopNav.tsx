'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { ThemeToggle } from '@/components/shared/ThemeToggle'
import { NavSearch } from '@/components/shared/NavSearch'

const USER_GUIDE_URL =
  'https://docs.google.com/document/d/1FtnUeytOj1OI54dEhB5ogmoIcVKK18c9E1FztwKpQXE/edit'
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

  // Pending Email Review + overdue Rerun counts → badges. Fail soft to 0.
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
  const { data: rerunOverdue = 0 } = useQuery({
    queryKey: ['rerun-overdue-count'],
    queryFn: async () => {
      const { count } = await createClient()
        .from('rerun_status')
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
    { href: '/deliverables', label: 'Deliverables', icon: '📦', title: 'Deliverables depository — files and links sent to clients, filed to the Shared Drive' },
    { href: '/email-review', label: 'Email Review', icon: '✉️', title: 'Email Review — client emails we couldn’t tie to one project; file or ignore them', badge: emailPending },
    { href: '/reruns', label: 'Reruns', icon: '🔁', title: 'Rerun Radar — recurring & one-off reruns, bucketed overdue / upcoming / done', badge: rerunOverdue },
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
        className={`font-bold text-sm px-1.5 py-1 rounded-lg transition-colors ${
          isProjects ? 'text-foreground' : 'text-foreground/80 hover:text-foreground'
        }`}
      >
        <span className="text-blue-600 dark:text-blue-400">✦</span> Survey Ops
      </Link>

      <div className="flex items-center gap-0.5 flex-wrap">
        {tabs.map(t => (
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
        ))}

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
              <a href={USER_GUIDE_URL} target="_blank" rel="noopener noreferrer" className={menuItemClass} title="How to use the tracker — opens the Google Doc">
                <span>📖</span> User Guide <span className="ml-auto text-xs text-muted-foreground">↗</span>
              </a>
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

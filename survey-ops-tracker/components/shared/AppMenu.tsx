'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const USER_GUIDE_URL =
  'https://docs.google.com/document/d/1FtnUeytOj1OI54dEhB5ogmoIcVKK18c9E1FztwKpQXE/edit'
const HANDOVER_URL =
  'https://docs.google.com/document/d/1rkT0KYApcvYU1BlK-TO_lfiXyhL0FuGIPz9UjduSJgk/edit'

const itemClass =
  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground/90 hover:bg-accent hover:text-foreground transition-colors'

export function AppMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  // Close when navigating, clicking outside, or pressing Escape
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Menu — pages, user guide, and team docs"
        aria-label="Open menu"
        aria-expanded={open}
        className="text-foreground/70 hover:text-foreground hover:bg-accent rounded-lg px-2 py-1 text-lg leading-none transition-colors cursor-pointer"
      >
        ☰
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-64 bg-popover border border-border rounded-xl shadow-xl p-1.5 flex flex-col">
          <Link href="/" className={itemClass} title="The kanban board — the main view">
            <span>🗂</span> Board
          </Link>
          <Link href="/list" className={itemClass} title="All projects as a sortable table, with CSV export">
            <span>📋</span> List view
          </Link>
          <Link
            href="/internal"
            className={itemClass}
            title="Internal Projects — AlphaROC's own work, on a sprint-based Backlog → Done board (separate from survey projects)"
          >
            <span>🧰</span> Internal Projects
          </Link>
          <Link
            href="/insights"
            className={itemClass}
            title="Insights — pipeline rollup, deadlines, on-time delivery, workload, budget"
          >
            <span>📊</span> Insights
          </Link>
          <Link
            href="/admin"
            className={itemClass}
            title="Admin — system links (incl. password resets), client ids, roster, recently deleted, and data health"
          >
            <span>⚙️</span> Admin
          </Link>
          <Link
            href="/deliverables"
            className={itemClass}
            title="Deliverables depository — files and links sent to clients, filed to the Shared Drive"
          >
            <span>📦</span> Deliverables
          </Link>
          <Link
            href="/email-review"
            className={itemClass}
            title="Email Review — client emails we couldn't confidently tie to one project; file them to the right project or ignore"
          >
            <span>✉️</span> Email Review
          </Link>
          <div className="border-t border-border my-1.5" />
          <Link
            href="/connect"
            className={itemClass}
            title="Connect your Claude — link claude.ai, Claude Desktop, or Claude Code to ask about projects and set reminders (analyst-only)"
          >
            <span>🔌</span> Connect your Claude
          </Link>
          <a
            href={USER_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={itemClass}
            title="How to use the tracker — opens the Google Doc in a new tab"
          >
            <span>📖</span> User Guide
            <span className="ml-auto text-xs text-muted-foreground">↗</span>
          </a>
          <a
            href={HANDOVER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={itemClass}
            title="Systems, accounts, and what-to-do-if-it-breaks runbooks — opens the Google Doc in a new tab"
          >
            <span>🛟</span> Systems &amp; Handover
            <span className="ml-auto text-xs text-muted-foreground">↗</span>
          </a>
          <div className="border-t border-border my-1.5" />
          <p className="px-3 py-1.5 text-xs text-muted-foreground">
            Tip: Ctrl+K jumps to any project
          </p>
        </div>
      )}
    </div>
  )
}

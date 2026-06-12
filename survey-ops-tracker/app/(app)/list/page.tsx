'use client'
import { useEffect, useRef, useState } from 'react'
import { ProjectTable } from '@/components/list/ProjectTable'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { SkeletonRow } from '@/components/shared/Skeleton'
import { useProjects, fetchFullProjects } from '@/lib/hooks/useProjects'
import { useViewMode } from '@/lib/hooks/useViewMode'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import { isTypingTarget } from '@/lib/utils/keyboard'
import Link from 'next/link'

export default function ListView() {
  const { data: projects = [], isLoading } = useProjects()
  const { mode, setMode } = useViewMode()
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcut: "/" focuses search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const q = search.trim().toLowerCase()
  const visibleProjects = projects.filter(p => {
    if (!(mode === 'full' ? true : p.phase === 'Active' && p.status === 'Open')) return false
    if (
      q &&
      !p.project_name.toLowerCase().includes(q) &&
      !p.client.toLowerCase().includes(q)
    ) {
      return false
    }
    return true
  })

  // The list runs on a slim fetch — pull the full rows on demand so the
  // CSV gets every column (budget, slack channel, linked docs, ...).
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      exportProjectsCsv(await fetchFullProjects(visibleProjects.map(p => p.id)))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-muted border border-border rounded-lg p-1 gap-1">
          <Link
            href="/"
            title="Kanban view — drag cards between pipeline stages"
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors"
          >
            Board
          </Link>
          <span title="Table view — sortable columns, all projects in one list" className="text-xs bg-background text-foreground px-3 py-1.5 rounded font-medium">
            List
          </span>
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search projects…  ( / )"
          className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 placeholder:text-muted-foreground focus:outline-none focus:border-ring w-44"
        />
        <button
          onClick={handleExport}
          disabled={isLoading || exporting || visibleProjects.length === 0}
          title="Downloads the projects currently shown (respects the Operations/Full View toggle)"
          className="ml-auto text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
        >
          {exporting ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>

      {isLoading ? (
        <div className="bg-card border border-border shadow-sm rounded-xl py-2 divide-y divide-border/50">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : (
        <ProjectTable projects={visibleProjects} />
      )}
    </div>
  )
}

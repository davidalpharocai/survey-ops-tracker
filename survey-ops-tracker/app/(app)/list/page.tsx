'use client'
import { useEffect, useRef, useState } from 'react'
import { ProjectTable, type SortField, type SortDir } from '@/components/list/ProjectTable'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { SavedViews } from '@/components/shared/SavedViews'
import { SkeletonRow } from '@/components/shared/Skeleton'
import { useProjects, fetchFullProjects } from '@/lib/hooks/useProjects'
import { useViewMode } from '@/lib/hooks/useViewMode'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import { isTypingTarget } from '@/lib/utils/keyboard'
import Link from 'next/link'

const HIDDEN_COLS_KEY = 'sot.listHiddenColumns'
const SORT_KEY = 'sot.listSort'

// A list "view" is the table's personality: which projects, which columns, sort
interface ListViewConfig {
  mode: 'operations' | 'full'
  hiddenCols: string[]
  sortField: SortField
  sortDir: SortDir
}

export default function ListView() {
  const { data: projects = [], isLoading } = useProjects()
  const { mode, setMode } = useViewMode()
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Column visibility + sort live here so saved views can capture them.
  // Both persist on their own so they survive a reload independent of views.
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<SortField>('due_date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    try {
      setHiddenCols(new Set(JSON.parse(localStorage.getItem(HIDDEN_COLS_KEY) ?? '[]')))
      const s = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null')
      if (s?.field) {
        setSortField(s.field)
        setSortDir(s.dir)
      }
    } catch {
      // corrupted storage — defaults are fine
    }
  }, [])

  function toggleCol(key: string) {
    setHiddenCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...next]))
      return next
    })
  }
  function changeSort(field: SortField, dir: SortDir) {
    setSortField(field)
    setSortDir(dir)
    localStorage.setItem(SORT_KEY, JSON.stringify({ field, dir }))
  }

  function applyView(c: ListViewConfig) {
    setMode(c.mode)
    const cols = new Set(c.hiddenCols)
    setHiddenCols(cols)
    localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...cols]))
    changeSort(c.sortField, c.sortDir)
  }

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
        <SavedViews<ListViewConfig>
          storageKey="sot.savedViews.list"
          current={{ mode, hiddenCols: [...hiddenCols], sortField, sortDir }}
          onApply={applyView}
          tooltip="Save this table's setup — Operations/Full, visible columns, and sort — as a named view. Personal to you. Pick one, then Update / Rename / Delete."
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
        <ProjectTable
          projects={visibleProjects}
          hiddenCols={hiddenCols}
          onToggleCol={toggleCol}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={changeSort}
        />
      )}
    </div>
  )
}

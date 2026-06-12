'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Board } from '@/components/board/Board'
import { ScopingBoard } from '@/components/board/ScopingBoard'
import { NewProjectModal } from '@/components/board/NewProjectModal'
import { ProjectCard } from '@/components/board/ProjectCard'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { ColorKey } from '@/components/shared/ColorKey'
import { useProjects, useMoveProjectToColumn, fetchFullProjects } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { useViewMode } from '@/lib/hooks/useViewMode'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import { isTypingTarget } from '@/lib/utils/keyboard'
import Link from 'next/link'

export default function BoardPage() {
  const router = useRouter()
  const { data: projects = [], isLoading } = useProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const moveProject = useMoveProjectToColumn()
  const { mode, setMode } = useViewMode()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Keyboard shortcuts: "/" focuses search, "n" opens New Project
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (e.key === '/') {
        e.preventDefault()
        document.getElementById('board-search')?.focus()
      } else if (e.key === 'n') {
        e.preventDefault()
        setShowNewProject(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const scopingProjects = projects.filter(
    p => p.phase === 'Scoping' && p.status === 'Open'
  )
  const knownClients = [...new Set(projects.map(p => p.client))].sort()
  // The draggable board only ever shows in-flight work; Closed lives in its own section
  const activeProjects = projects.filter(
    p => p.phase === 'Active' && (p.status === 'Open' || p.status === 'Hold')
  )
  const closedProjects = projects.filter(
    p => p.phase === 'Active' && p.status === 'Closed'
  )
  const exportableProjects =
    mode === 'full'
      ? [...scopingProjects, ...activeProjects, ...closedProjects]
      : activeProjects

  // The board runs on a slim fetch — pull the full rows on demand so the
  // CSV gets every column (budget, slack channel, linked docs, ...).
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      exportProjectsCsv(await fetchFullProjects(exportableProjects.map(p => p.id)))
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground text-sm">Loading projects...</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Board/List tabs */}
          <div className="flex bg-muted rounded-lg p-1 gap-1">
            <span className="text-xs bg-background text-foreground px-3 py-1.5 rounded font-medium">
              Board
            </span>
            <Link
              href="/list"
              className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors"
            >
              List
            </Link>
          </div>
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || exportableProjects.length === 0}
            title="Downloads the projects currently shown (respects the Operations/Full View toggle)"
            className="text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : '⬇ Export CSV'}
          </button>
          <button
            onClick={() => setShowNewProject(true)}
            title="Create a new project — or press N anywhere on the board"
            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors"
          >
            + New Project
          </button>
        </div>
      </div>

      {/* Color key */}
      <ColorKey />

      {/* Scoping board (Full View only) */}
      {mode === 'full' && <ScopingBoard projects={scopingProjects} />}

      {/* Operations pipeline */}
      {mode === 'full' && (
        <h2 className="text-xs text-muted-foreground uppercase tracking-widest font-semibold -mb-1">
          Operations Pipeline
        </h2>
      )}
      <Board
        projects={activeProjects}
        teamMembers={teamMembers}
        onMoveProject={moveProject}
      />

      {/* Closed section (Full View only) */}
      {mode === 'full' && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setShowClosed(v => !v)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest font-semibold transition-colors self-start"
          >
            <span>{showClosed ? '▾' : '▸'}</span>
            Closed
            <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal">
              {closedProjects.length}
            </span>
          </button>
          {showClosed && (
            closedProjects.length === 0 ? (
              <p className="text-muted-foreground/50 text-xs">No closed projects</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {closedProjects.map(p => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onClick={() => router.push(`/projects/${p.id}`)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      )}

      {showNewProject && (
        <NewProjectModal
          teamMembers={teamMembers}
          knownClients={knownClients}
          onClose={() => setShowNewProject(false)}
        />
      )}
    </div>
  )
}

'use client'
import { useState } from 'react'
import { Board } from '@/components/board/Board'
import { ScopingBoard } from '@/components/board/ScopingBoard'
import { NewProjectModal } from '@/components/board/NewProjectModal'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { useProjects, useMoveProjectToColumn } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { useViewMode } from '@/lib/hooks/useViewMode'
import Link from 'next/link'

export default function BoardPage() {
  const { data: projects = [], isLoading } = useProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const moveProject = useMoveProjectToColumn()
  const { mode, setMode } = useViewMode()
  const [showNewProject, setShowNewProject] = useState(false)

  const scopingProjects = projects.filter(
    p => p.phase === 'Scoping' && p.status === 'Open'
  )
  const activeProjects = projects.filter(p =>
    mode === 'full'
      ? p.phase === 'Active'
      : p.phase === 'Active' && p.status === 'Open'
  )

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
        <button
          onClick={() => setShowNewProject(true)}
          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors"
        >
          + New Project
        </button>
      </div>

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

      {showNewProject && (
        <NewProjectModal
          teamMembers={teamMembers}
          onClose={() => setShowNewProject(false)}
        />
      )}
    </div>
  )
}

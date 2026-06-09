'use client'
import { Board } from '@/components/board/Board'
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

  const visibleProjects = projects.filter(p =>
    mode === 'full' ? true : p.phase === 'Active' && p.status === 'Open'
  )

  if (isLoading) {
    return <div className="text-slate-400 text-sm">Loading projects...</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Board/List tabs */}
          <div className="flex bg-slate-800 rounded-lg p-1 gap-1">
            <span className="text-xs bg-slate-700 text-white px-3 py-1.5 rounded font-medium">
              Board
            </span>
            <Link
              href="/list"
              className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded transition-colors"
            >
              List
            </Link>
          </div>
          <ViewToggle mode={mode} onChange={setMode} />
        </div>
        <button className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors">
          + New Project
        </button>
      </div>

      {/* Board */}
      <Board
        projects={visibleProjects}
        teamMembers={teamMembers}
        onMoveProject={moveProject}
      />
    </div>
  )
}

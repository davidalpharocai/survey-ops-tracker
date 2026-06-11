'use client'
import { ProjectTable } from '@/components/list/ProjectTable'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { useProjects } from '@/lib/hooks/useProjects'
import { useViewMode } from '@/lib/hooks/useViewMode'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import Link from 'next/link'

export default function ListView() {
  const { data: projects = [], isLoading } = useProjects()
  const { mode, setMode } = useViewMode()

  const visibleProjects = projects.filter(p =>
    mode === 'full' ? true : p.phase === 'Active' && p.status === 'Open'
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-muted rounded-lg p-1 gap-1">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded transition-colors"
          >
            Board
          </Link>
          <span className="text-xs bg-background text-foreground px-3 py-1.5 rounded font-medium">
            List
          </span>
        </div>
        <ViewToggle mode={mode} onChange={setMode} />
        <button
          onClick={() => exportProjectsCsv(visibleProjects)}
          disabled={isLoading || visibleProjects.length === 0}
          title="Downloads the projects currently shown (respects the Operations/Full View toggle)"
          className="ml-auto text-xs border border-border text-muted-foreground hover:text-foreground hover:border-ring px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
        >
          ⬇ Export CSV
        </button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading projects...</div>
      ) : (
        <ProjectTable projects={visibleProjects} />
      )}
    </div>
  )
}

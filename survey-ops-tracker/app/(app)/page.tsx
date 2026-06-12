'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { Board, columnSortRank } from '@/components/board/Board'
import { ScopingBoard, SCOPING_STAGES } from '@/components/board/ScopingBoard'
import { NewProjectModal } from '@/components/board/NewProjectModal'
import { ProjectCard } from '@/components/board/ProjectCard'
import { ViewToggle } from '@/components/shared/ViewToggle'
import { ColorKey } from '@/components/shared/ColorKey'
import { Skeleton, SkeletonCard } from '@/components/shared/Skeleton'
import { useProjects, useMoveProjectToColumn, useUpdateProject, fetchFullProjects, type SlimProject } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { useQueryClient } from '@tanstack/react-query'
import { useIsNewForMe } from '@/lib/hooks/useSeenProjects'
import { useViewMode } from '@/lib/hooks/useViewMode'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import { isTypingTarget } from '@/lib/utils/keyboard'
import { boardOrder, sortOrderBetween } from '@/lib/utils/ordering'
import { STAGE_ORDER, getCheckboxesForColumn, type BoardColumn as BoardColumnType } from '@/lib/utils/stage'
import type { Database } from '@/lib/supabase/types'
import Link from 'next/link'

export default function BoardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading } = useProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const moveProject = useMoveProjectToColumn()
  const updateProject = useUpdateProject()
  const isNewForMe = useIsNewForMe()
  const { mode, setMode } = useViewMode()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [exporting, setExporting] = useState(false)

  // The command palette's "New project" action lands here as /?new=1 —
  // open the modal and clean the URL. window.location.search (not
  // useSearchParams) keeps this page out of a Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') {
      setShowNewProject(true)
      router.replace('/')
    }
    // ...and when the palette is invoked while already on the board, it
    // signals via event instead of a no-op same-page navigation.
    function onOpenNew() {
      setShowNewProject(true)
    }
    window.addEventListener('sot:open-new-project', onOpenNew)
    return () => window.removeEventListener('sot:open-new-project', onOpenNew)
  }, [router])

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

  // Full View drag handler: routes drops to the right action depending on
  // where the card came from and where it landed
  function handleFullViewDragEnd(result: DropResult) {
    window.__sotDragging = false
    if (!result.destination) return
    const from = result.source.droppableId
    const to = result.destination.droppableId
    const id = result.draggableId
    if (from === to && result.destination.index === result.source.index) return
    const toScoping = (SCOPING_STAGES as string[]).includes(to)
    const fromScoping = (SCOPING_STAGES as string[]).includes(from)
    const toPipeline = (STAGE_ORDER as string[]).includes(to)

    // Persisted position: the dropped card lands between its new neighbors
    const destList = toPipeline
      ? activeProjects.filter(p => p.board_column === to && p.id !== id)
      : scopingProjects.filter(p => (p.scoping_stage ?? 'New Inquiry') === to && p.id !== id)
    const destSorted = destList.sort(
      (a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b)
    )
    const i = result.destination.index
    const sortOrder = sortOrderBetween(destSorted[i - 1]?.sort_order, destSorted[i]?.sort_order)

    // Same-tick cache apply so the drop animation targets the new home
    function applyNow(patch: Partial<SlimProject>) {
      queryClient.setQueriesData<SlimProject[]>({ queryKey: ['projects'] }, old =>
        old?.map(pr => (pr.id === id ? ({ ...pr, ...patch } as SlimProject) : pr))
      )
    }

    if (fromScoping && toScoping) {
      applyNow({ scoping_stage: to as Database['public']['Enums']['scoping_stage'], sort_order: sortOrder })
      updateProject.mutate({
        id,
        updates: {
          scoping_stage: to as Database['public']['Enums']['scoping_stage'],
          sort_order: sortOrder,
        },
      })
    } else if (fromScoping && toPipeline) {
      // Approve: promote into the pipeline at the column it was dropped on
      applyNow({
        phase: 'Active',
        board_column: to as Database['public']['Enums']['board_column'],
        sort_order: sortOrder,
        ...getCheckboxesForColumn(to as BoardColumnType),
      })
      updateProject.mutate({
        id,
        updates: {
          phase: 'Active',
          board_column: to as Database['public']['Enums']['board_column'],
          submitted_date: new Date().toISOString().split('T')[0],
          ...getCheckboxesForColumn(to as BoardColumnType),
          sort_order: sortOrder,
        },
      })
    } else if (toPipeline) {
      applyNow({
        board_column: to as Database['public']['Enums']['board_column'],
        sort_order: sortOrder,
        ...getCheckboxesForColumn(to as BoardColumnType),
      })
      moveProject(id, to as BoardColumnType, sortOrder)
    } else if (toScoping) {
      // Demote: pipeline card dragged back up to a scoping column — the deal
      // reopened. Stage checkboxes are kept so a re-promotion resumes intact.
      applyNow({
        phase: 'Scoping',
        scoping_stage: to as Database['public']['Enums']['scoping_stage'],
        sort_order: sortOrder,
      })
      updateProject.mutate({
        id,
        updates: {
          phase: 'Scoping',
          scoping_stage: to as Database['public']['Enums']['scoping_stage'],
          sort_order: sortOrder,
        },
      })
    }
  }

  if (isLoading) {
    // Skeleton board: filter pill bar + 7 column-shaped containers of cards,
    // sized like the real thing so the layout doesn't jump when data lands
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-3 flex-wrap">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
        <div className="flex gap-2 overflow-x-hidden pb-4">
          {Array.from({ length: 7 }).map((_, col) => (
            <div
              key={col}
              className="bg-card border border-border rounded-xl p-2 min-w-[158px] max-w-[253px] flex-1 basis-0 flex flex-col gap-2"
            >
              <Skeleton className="h-4 w-2/3" />
              {Array.from({ length: col % 2 === 0 ? 3 : 2 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {/* Board/List tabs */}
          <div className="flex bg-muted border border-border rounded-lg p-1 gap-1">
            <span title="Kanban view — drag cards between pipeline stages" className="text-xs bg-background text-foreground px-3 py-1.5 rounded font-medium">
              Board
            </span>
            <Link
              href="/list"
              title="Table view — sortable columns, all projects in one list"
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

      {/* Full View: one shared drag context spanning scoping + pipeline, so a
          scoping card dropped on a pipeline column gets promoted on the spot */}
      {mode === 'full' ? (
        <DragDropContext onDragStart={() => { window.__sotDragging = true }} onDragEnd={handleFullViewDragEnd}>
          <ScopingBoard projects={scopingProjects} wrapInContext={false} />
          <h2 className="text-xs text-muted-foreground uppercase tracking-widest font-semibold -mb-1">
            Operations Pipeline
          </h2>
          <Board
            projects={activeProjects}
            teamMembers={teamMembers}
            onMoveProject={moveProject}
            wrapInContext={false}
          />
        </DragDropContext>
      ) : (
        <Board
          projects={activeProjects}
          teamMembers={teamMembers}
          onMoveProject={moveProject}
        />
      )}

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
                    isNew={isNewForMe(p)}
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

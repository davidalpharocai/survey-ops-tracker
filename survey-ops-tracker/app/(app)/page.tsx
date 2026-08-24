'use client'
import { Caret } from '@/components/shared/Caret'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { Board, type DropResolver } from '@/components/board/Board'
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
import { useStoredFlag } from '@/lib/hooks/useStoredFlag'
import { exportProjectsCsv } from '@/lib/utils/exportCsv'
import { isTypingTarget } from '@/lib/utils/keyboard'
import { cardOrder, dropSortOrder, type BoardSortMode } from '@/lib/utils/ordering'
import { STAGE_ORDER, getCheckboxesForColumn, type BoardColumn as BoardColumnType } from '@/lib/utils/stage'
import { useComplianceMaps } from '@/lib/hooks/useComplianceState'
import { complianceGate } from '@/lib/utils/compliance'
import { toast } from '@/lib/utils/toast'
import { matchesDeliveredWindow, DELIVERED_WINDOW_LABELS, type DeliveredWindow } from '@/lib/utils/date'
import type { Database } from '@/lib/supabase/types'
import Link from 'next/link'

const BOARD_SORT_KEY = 'sot.boardSort'

export default function BoardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading } = useProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const moveProject = useMoveProjectToColumn()
  const updateProject = useUpdateProject()
  const { data: complianceMaps } = useComplianceMaps()
  const isNewForMe = useIsNewForMe()
  const { mode, setMode } = useViewMode()
  const [showNewProject, setShowNewProject] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  // "Delivered in X" window — shared by the board filter bar and the Archived
  // section below (delivered work lives there). Picking a window auto-opens the
  // section; the two controls stay in sync because they read/write this one state.
  const [deliveredWithin, setDeliveredWithin] = useState<DeliveredWindow>('all')
  useEffect(() => {
    if (deliveredWithin !== 'all') setShowClosed(true)
  }, [deliveredWithin])
  const [pipelineCollapsed, setPipelineCollapsed] = useStoredFlag('sot.collapse.pipeline', false)
  // Card sort mode for both lanes. It lives here (not in Board) because Full
  // View's drag handler below has to compute drop positions against the same
  // order the columns render in. Defaults to the soonest delivery date; a
  // stored choice wins. Read after mount so the server render matches.
  const [boardSort, setBoardSort] = useState<BoardSortMode>('due')
  useEffect(() => {
    const stored = localStorage.getItem(BOARD_SORT_KEY)
    if (stored === 'manual' || stored === 'due') setBoardSort(stored)
  }, [])
  function changeBoardSort(m: BoardSortMode) {
    setBoardSort(m)
    localStorage.setItem(BOARD_SORT_KEY, m)
  }
  // A drop's sort_order has to be computed against the cards the destination
  // column is SHOWING, and for the pipeline that's the board's business (the
  // captain filter and search live in <Board/>). It lends us its resolver;
  // a ref because it changes with every filter keystroke and this handler only
  // reads it at drop time. Null while the pipeline is collapsed/unmounted.
  const pipelineDrop = useRef<DropResolver | null>(null)
  const takeDropResolver = useCallback((resolve: DropResolver | null) => {
    pipelineDrop.current = resolve
  }, [])
  // Remember this as the origin so a project's "← Back" returns here
  useEffect(() => {
    sessionStorage.setItem('sot.cameFrom', '/')
  }, [])
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
  // Archived section = closed (delivered/manually archived) plus cancelled. A
  // client can cancel at any stage — including while still in Scoping — so
  // Cancelled folds in regardless of phase (it would otherwise fall off the
  // board entirely, since scopingProjects requires status 'Open').
  const closedProjects = projects.filter(
    p => (p.phase === 'Active' && p.status === 'Closed') || p.status === 'Cancelled'
  )
  // When a "Delivered in X" window is active, scope the Archived section to
  // projects DELIVERED within it (status Closed = delivered/archived; excludes
  // Cancelled), by deliver_date. 'all' shows everything archived, as before.
  const archivedInWindow =
    deliveredWithin === 'all'
      ? closedProjects
      : closedProjects.filter(p => p.status === 'Closed' && matchesDeliveredWindow(p.deliver_date, deliveredWithin))
  // Finished work reads newest-delivered-first: "soonest due" says nothing once
  // it's out the door. These cards aren't draggable, so there's no hand-arranged
  // order to protect and the board's sort mode doesn't apply here (see cardOrder).
  // .slice() because sort() mutates and closedProjects also feeds the CSV export.
  const archivedShown = archivedInWindow.slice().sort(cardOrder('delivered', boardSort))
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
    const moved = projects.find(p => p.id === id)
    if (from === to && result.destination.index === result.source.index) return
    // Re-ordering inside one column is hand-arranging, and sort_order — the
    // column it writes — is shared by the whole team while the sort mode is
    // this browser's localStorage. Dragging in date order would snap the card
    // back and quietly re-shuffle a teammate's hand-arranged column, so stop
    // and say which switch to flip. (Same rule as the board's own handler.)
    if (from === to && boardSort !== 'manual') {
      toast('Set Sort to "Manual (drag)" to hand-arrange this column.')
      return
    }
    const toScoping = (SCOPING_STAGES as string[]).includes(to)
    const fromScoping = (SCOPING_STAGES as string[]).includes(from)
    const toPipeline = (STAGE_ORDER as string[]).includes(to)

    // Persisted position: the dropped card lands between the neighbours it was
    // dropped between ON SCREEN (destination.index counts rendered cards), with
    // the value itself placed in hand-arranged order — see dropSortOrder.
    // The pipeline's rendered list is the board's to know (it owns the captain
    // filter and folds the retired Delivery column into Data QA), so we use the
    // resolver it lends us. The scoping lane renders straight from
    // scopingProjects, unfiltered, so here it's the same cards in two orders —
    // and it renders flat, without the pipeline's priority ranking.
    const i = result.destination.index
    let sortOrder: number
    if (toPipeline) {
      // No resolver = no pipeline columns on screen, so nothing could have been
      // dropped on one. Bail rather than invent a position.
      if (!pipelineDrop.current) return
      sortOrder = pipelineDrop.current(to as BoardColumnType, i, id)
    } else {
      const inStage = (order: (a: SlimProject, b: SlimProject) => number) =>
        scopingProjects
          .filter(p => (p.scoping_stage ?? 'New Inquiry') === to && p.id !== id)
          .sort(order)
      sortOrder = dropSortOrder(
        inStage(cardOrder('scoping', boardSort)),
        inStage(cardOrder('scoping', 'manual')),
        i
      )
    }

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
      const newColumn = to as BoardColumnType
      // Compliance guardrail (same as the Operations board): block dragging into
      // Fielding+ (before-fielding review) or onto Delivered (after-fielding review)
      // when the client's review isn't approved. Override is a project-page action.
      if (moved && complianceMaps) {
        const firm = moved.client.split(' - ')[0].trim()
        const gate = complianceGate({
          targetColumn: newColumn,
          willMarkDelivered: newColumn === 'Delivery',
          client: complianceMaps.clientByFirm.get(firm) ?? null,
          override: moved.compliance_override ?? null,
          submissions: complianceMaps.approvedByProject.get(moved.id) ?? [],
          rerunNumber: moved.rerun_number,
          complianceRequiredOverride: moved.compliance_required_override,
        })
        if (gate.blocked) {
          toast(gate.message + ' Open the project to review or override.')
          return
        }
      }
      applyNow({
        board_column: newColumn,
        sort_order: sortOrder,
        ...getCheckboxesForColumn(newColumn),
      })
      moveProject(id, newColumn, sortOrder)
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
          <ScopingBoard projects={scopingProjects} wrapInContext={false} sortMode={boardSort} />
          <button
            onClick={() => setPipelineCollapsed(!pipelineCollapsed)}
            title={pipelineCollapsed ? 'Expand the pipeline' : 'Collapse the pipeline (your choice is remembered)'}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest font-semibold transition-colors self-start -mb-1"
          >
            <Caret open={!pipelineCollapsed} className="text-foreground" />
            Operations Pipeline
            {pipelineCollapsed && (
              <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal">
                {activeProjects.length}
              </span>
            )}
          </button>
          {!pipelineCollapsed && (
            <Board
              projects={activeProjects}
              teamMembers={teamMembers}
              onMoveProject={moveProject}
              wrapInContext={false}
              deliveredWithin={deliveredWithin}
              onDeliveredWithinChange={setDeliveredWithin}
              sortMode={boardSort}
              onSortModeChange={changeBoardSort}
              // Full View drops are handled up here, so borrow the board's
              // drop math — only it knows what its columns are showing.
              onDropResolver={takeDropResolver}
            />
          )}
        </DragDropContext>
      ) : (
        <Board
          projects={activeProjects}
          teamMembers={teamMembers}
          onMoveProject={moveProject}
          deliveredWithin={deliveredWithin}
          onDeliveredWithinChange={setDeliveredWithin}
          sortMode={boardSort}
          onSortModeChange={changeBoardSort}
        />
      )}

      {/* Archived section — shown in BOTH Operations and Full view (collapsed by
          default). Delivered projects auto-archive into here (delivered ⇒ closed),
          and every archived project stays findable via the top search. */}
      <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap self-start">
            <button
              onClick={() => setShowClosed(v => !v)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest font-semibold transition-colors"
            >
              <Caret open={showClosed} className="text-foreground" />
              Archived
              <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal">
                {archivedShown.length}
              </span>
            </button>
            {/* Delivered-window scoper — synced with the board's Delivered filter. */}
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground normal-case tracking-normal">
              <span>Delivered:</span>
              <select
                value={deliveredWithin}
                onChange={e => setDeliveredWithin(e.target.value as DeliveredWindow)}
                title="Show projects delivered within this window (kept in sync with the board's Delivered filter)."
                className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-ring"
              >
                {(Object.keys(DELIVERED_WINDOW_LABELS) as DeliveredWindow[]).map(w => (
                  <option key={w} value={w}>{DELIVERED_WINDOW_LABELS[w]}</option>
                ))}
              </select>
            </label>
          </div>
          {showClosed && (
            archivedShown.length === 0 ? (
              <p className="text-muted-foreground/50 text-xs">
                {deliveredWithin === 'all' ? 'No archived projects' : `Nothing delivered ${DELIVERED_WINDOW_LABELS[deliveredWithin].toLowerCase()}`}
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {archivedShown.map(p => (
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

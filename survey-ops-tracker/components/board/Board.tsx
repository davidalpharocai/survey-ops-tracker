'use client'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { BoardFilters } from './BoardFilters'
import { SavedViews } from '@/components/shared/SavedViews'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useIsNewForMe } from '@/lib/hooks/useSeenProjects'
import { STAGE_ORDER, getCheckboxesForColumn, type BoardColumn as BoardColumnType } from '@/lib/utils/stage'
import { matchesDuePreset, type DeliveredWindow } from '@/lib/utils/date'
import { useComplianceMaps } from '@/lib/hooks/useComplianceState'
import { complianceGate } from '@/lib/utils/compliance'
import { toast } from '@/lib/utils/toast'
import { cardOrder, dropSortOrder, type BoardSortMode } from '@/lib/utils/ordering'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { isRerunProject } from '@/lib/reruns/isRerun'
import type { SlimProject } from '@/lib/hooks/useProjects'
import type { TeamMember } from '@/lib/hooks/useTeamMembers'

interface BoardProps {
  projects: SlimProject[]
  teamMembers: TeamMember[]
  onMoveProject: (id: string, column: BoardColumnType, sortOrder?: number) => void
  // Full View provides a page-level DragDropContext (so cards can be dragged
  // from scoping into the pipeline); the board then skips its own context
  wrapInContext?: boolean
  // "Delivered in X" window — lifted to the page (shared with the Archived
  // section). The board only passes it through to the filter bar; it doesn't
  // affect the kanban columns (delivered projects aren't on the board).
  deliveredWithin?: DeliveredWindow
  onDeliveredWithinChange?: (w: DeliveredWindow) => void
  // Card sort mode — lifted to the page because Full View's page-level drag
  // handler has to compute drop positions against the SAME order the columns
  // render in (and the page also sorts the Archived section).
  sortMode?: BoardSortMode
  onSortModeChange?: (m: BoardSortMode) => void
  // Full View drops onto pipeline columns land in ITS page-level handler, but
  // only the board knows what a column is actually showing (the captain filter
  // and the search box live in here, and the retired Delivery column folds into
  // Data QA). So the board hands the page the function that turns a drop
  // position into a sort_order, and both views compute it the same way.
  // Called with null when the board unmounts, so a stale resolver can't be used.
  onDropResolver?: (resolve: DropResolver | null) => void
}

/** Turns "dropped at index i of column C" into the sort_order to persist. */
export type DropResolver = (column: BoardColumnType, index: number, draggedId: string) => number

const CAPTAIN_FILTER_KEY = 'sot.captainFilter'

// The board shows the active pipeline only — the 'Delivery' column is retired
// (delivery is marked from the project record; delivered work auto-archives
// into the Archived section, and the "Delivered in X" filter surfaces it
// there). Any project still sitting in 'Delivery' but not yet delivered
// (Open/Hold delivery-prep) folds into the last visible column, Data QA, so
// it never disappears.
const VISIBLE_STAGES = STAGE_ORDER.filter(s => s !== 'Delivery')
// Module scope because the drop math has to fold Delivery into Data QA exactly
// the way the columns render it — a card counted in the wrong column is a card
// dropped in the wrong place.
const columnMatch = (p: SlimProject, stage: BoardColumnType) =>
  stage === 'Data QA'
    ? p.board_column === 'Data QA' || p.board_column === 'Delivery'
    : p.board_column === stage

// columnSortRank now lives with the rest of the ordering rules, so the render
// sort and the drop math can't drift apart. Re-exported because callers have
// always imported it from the board.
export { columnSortRank } from '@/lib/utils/ordering'

export function Board({ projects, teamMembers, onMoveProject, wrapInContext = true, deliveredWithin = 'all', onDeliveredWithinChange, sortMode = 'due', onSortModeChange, onDropResolver }: BoardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: currentMember, isLoading: memberLoading } = useCurrentMember()
  const { data: complianceMaps } = useComplianceMaps()
  const isNewForMe = useIsNewForMe()
  const [captainFilter, setCaptainFilter] = useState<string | null>(null)
  const [filterReady, setFilterReady] = useState(false)
  const [salespersonFilter, setSalespersonFilter] = useState<string | null>(null)
  const [rerunFilter, setRerunFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [dueFilter, setDueFilter] = useState<string | null>(null)
  const [dueFrom, setDueFrom] = useState<string | null>(null)
  const [dueTo, setDueTo] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Default the board to "my projects": last choice wins, otherwise the
  // logged-in user's own captain filter when they're a team member
  useEffect(() => {
    if (filterReady || memberLoading) return
    const stored = localStorage.getItem(CAPTAIN_FILTER_KEY)
    if (stored === 'all') setCaptainFilter(null)
    else if (stored) setCaptainFilter(stored)
    else if (currentMember?.id) setCaptainFilter(currentMember.id)
    setFilterReady(true)
  }, [filterReady, memberLoading, currentMember])

  // If a remembered captain no longer exists, fall back to everyone
  useEffect(() => {
    if (filterReady && captainFilter && teamMembers.length > 0 &&
        !teamMembers.some(m => m.id === captainFilter)) {
      setCaptainFilter(null)
    }
  }, [filterReady, captainFilter, teamMembers])

  function handleCaptainChange(id: string | null) {
    setCaptainFilter(id)
    localStorage.setItem(CAPTAIN_FILTER_KEY, id ?? 'all')
  }

  // Distinct salespeople actually present on the projects (for the filter list).
  const salespeople = useMemo(
    () => [...new Set(projects.map(p => p.salesperson).filter((s): s is string => !!s && s.trim() !== ''))].sort((a, b) => a.localeCompare(b)),
    [projects]
  )

  // One comparator for the columns AND for the drop math in handleDragEnd — if
  // those two ever disagree a dropped card lands somewhere the user didn't drop it.
  const pipelineOrder = useMemo(() => cardOrder<SlimProject>('pipeline', sortMode), [sortMode])
  // ...and the hand-arranged order, which the drop math needs whatever the
  // current mode is: sort_order MEANS a manual position, so a value computed
  // between two date-ordered neighbours is meaningless in the order it's stored
  // for (and to the teammate reading it in manual mode).
  const manualOrder = useMemo(() => cardOrder<SlimProject>('pipeline', 'manual'), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (salespersonFilter && p.salesperson !== salespersonFilter) return false
      if (rerunFilter === 'only' && !isRerunProject(p)) return false
      if (rerunFilter === 'non' && isRerunProject(p)) return false
      if (captainFilter) {
        if (captainFilter === 'unassigned') {
          if (p.captain != null) return false
        } else if (
          p.captain?.id !== captainFilter &&
          !(p.co_captain_ids ?? []).includes(captainFilter)
        ) {
          return false
        }
      }
      if (typeFilter && p.project_type !== typeFilter) return false
      if (!matchesDuePreset(p.due_date, dueFilter, dueFrom, dueTo)) return false
      if (stageFilter) {
        if (stageFilter === 'Closed') {
          if (p.status !== 'Closed') return false
        } else if (p.board_column !== stageFilter || p.status === 'Closed') {
          return false
        }
      }
      if (
        clientFilter &&
        p.client.split(' - ')[0].trim().toLowerCase() !== clientFilter.toLowerCase()
      )
        return false
      if (
        q &&
        !p.project_name.toLowerCase().includes(q) &&
        !p.client.toLowerCase().includes(q) &&
        !(p.latest_next_steps ?? '').toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
  }, [projects, captainFilter, salespersonFilter, rerunFilter, typeFilter, dueFilter, dueFrom, dueTo, stageFilter, clientFilter, search])

  const hasActiveFilters = !!(captainFilter || salespersonFilter || rerunFilter || typeFilter || dueFilter || stageFilter || clientFilter || search)
  function clearAllFilters() {
    handleCaptainChange(null)
    setSalespersonFilter(null)
    setRerunFilter(null)
    setTypeFilter(null)
    setDueFilter(null)
    setDueFrom(null)
    setDueTo(null)
    setStageFilter(null)
    setClientFilter(null)
    setSearch('')
  }

  // Where a card dropped at `index` of `column` belongs. The neighbours come
  // from the list the column RENDERED (`filtered`, folded and sorted exactly as
  // the columns below do it) because `index` counts rendered cards — with the
  // default "my projects" filter on, the unfiltered column is a different,
  // longer list and its index i is a different pair of cards. The value itself
  // is then placed in the unfiltered column's hand-arranged order, so hidden
  // cards stay coherent too (see dropSortOrder).
  const resolveDropSortOrder = useCallback<DropResolver>(
    (column, index, draggedId) => {
      const inColumn = (list: SlimProject[], order: (a: SlimProject, b: SlimProject) => number) =>
        list.filter(p => columnMatch(p, column) && p.id !== draggedId).sort(order)
      return dropSortOrder(
        inColumn(filtered, pipelineOrder),
        inColumn(projects.filter(p => p.status !== 'Closed'), manualOrder),
        index
      )
    },
    [filtered, projects, pipelineOrder, manualOrder]
  )

  // Hand the resolver to Full View's page-level drag handler (and take it back
  // on unmount — a collapsed pipeline has no columns to drop onto).
  useEffect(() => {
    onDropResolver?.(resolveDropSortOrder)
    return () => onDropResolver?.(null)
  }, [onDropResolver, resolveDropSortOrder])

  function handleDragEnd(result: DropResult) {
    window.__sotDragging = false
    if (!result.destination) return
    const newColumn = result.destination.droppableId as BoardColumnType
    const sameColumn = newColumn === result.source.droppableId
    if (sameColumn && result.destination.index === result.source.index) return
    // Re-ordering INSIDE a column is hand-arranging, and that only sticks in
    // manual mode. sort_order is a global column; the sort mode is this
    // browser's localStorage. So a drag while the cards are on screen in date
    // order is a no-op the user can see (the card snaps back to its date) and a
    // scramble they can't: it rewrites the order a teammate in manual mode
    // arranged by hand. Say so instead of writing it.
    if (sameColumn && sortMode !== 'manual') {
      toast('Set Sort to "Manual (drag)" to hand-arrange this column.')
      return
    }
    // Moving BETWEEN columns still works in either mode — it's a stage change,
    // and the card only needs a sane position in its new column.
    const sortOrder = resolveDropSortOrder(newColumn, result.destination.index, result.draggableId)

    // Compliance guardrail (before-fielding): block dragging into Fielding or
    // later when the client's questionnaire review isn't approved. Override is
    // a project-page action; the board just stops the move and points there.
    const moved = projects.find(p => p.id === result.draggableId)
    if (moved && complianceMaps) {
      const firm = moved.client.split(' - ')[0].trim()
      const gate = complianceGate({
        targetColumn: newColumn,
        // Dropping onto the Delivered column marks the project delivered (and now
        // archives it), so run the after-fielding gate too — not just before-fielding.
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

    // Apply the move to the cache RIGHT HERE, in the same tick as the drop —
    // the drop animation then aims at the card's new home, not its old one.
    queryClient.setQueriesData<SlimProject[]>({ queryKey: ['projects'] }, old =>
      old?.map(p =>
        p.id === result.draggableId
          ? { ...p, board_column: newColumn, sort_order: sortOrder, ...getCheckboxesForColumn(newColumn) }
          : p
      )
    )
    onMoveProject(result.draggableId, newColumn, sortOrder)
  }

  function handleDragStart() {
    window.__sotDragging = true
  }

  const columns = (
    <div className="flex gap-2 overflow-x-auto pb-4">
      {VISIBLE_STAGES.map(stage => (
        <BoardColumn
          key={stage}
          id={stage}
          title={stage}
          projects={filtered
            .filter(p => columnMatch(p, stage))
            .sort(pipelineOrder)}
          isNewFor={isNewForMe}
          onCardClick={id => router.push(`/projects/${id}`)}
          bodyClassName="h-[calc(100vh-15rem)] overflow-y-auto thin-scroll"
          collapseWhenEmpty
        />
      ))}
    </div>
  )

  type BoardViewConfig = {
    captain: string | null
    salesperson?: string | null
    rerun?: string | null
    type: string | null
    due: string | null
    dueFrom?: string | null
    dueTo?: string | null
    stage: string | null
    sort?: BoardSortMode
  }
  function applyView(c: BoardViewConfig) {
    handleCaptainChange(c.captain)
    setSalespersonFilter(c.salesperson ?? null)
    setRerunFilter(c.rerun ?? null)
    setTypeFilter(c.type ?? null)
    // Legacy saved views may still carry type: 'Rerun' from before the split —
    // migrate them to the rerun filter instead of the (now Rerun-less) type one.
    if (c.type === 'Rerun') {
      setTypeFilter(null)
      setRerunFilter('only')
    }
    setDueFilter(c.due)
    setDueFrom(c.dueFrom ?? null)
    setDueTo(c.dueTo ?? null)
    setStageFilter(c.stage)
    // A view saved before the sort mode existed captured no sort — resolve it to
    // 'manual', never to 'due', or applying an old view silently re-sorts a
    // column someone deliberately hand-arranged.
    onSortModeChange?.(c.sort ?? 'manual')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <BoardFilters
          captains={teamMembers}
          captainFilter={captainFilter}
          currentMemberId={currentMember?.id ?? null}
          salespeople={salespeople}
          salespersonFilter={salespersonFilter}
          onSalespersonChange={setSalespersonFilter}
          rerunFilter={rerunFilter}
          onRerunChange={setRerunFilter}
          typeFilter={typeFilter}
          dueFilter={dueFilter}
          dueFrom={dueFrom}
          dueTo={dueTo}
          stageFilter={stageFilter}
          clientFilter={clientFilter}
          deliveredFilter={deliveredWithin}
          onDeliveredChange={onDeliveredWithinChange}
          search={search}
          onCaptainChange={handleCaptainChange}
          onTypeChange={setTypeFilter}
          onDueChange={setDueFilter}
          onDueFromChange={setDueFrom}
          onDueToChange={setDueTo}
          onStageChange={setStageFilter}
          onClientChange={setClientFilter}
          onSearchChange={setSearch}
        />
        <div className="flex items-start gap-3 flex-wrap">
          <label className="flex flex-col gap-0.5">
            <span className="flex items-center text-xs text-muted-foreground uppercase tracking-wider font-medium">
              Sort
              <InfoTooltip text="Card order inside every column. Delivery date puts the soonest client deadline on top (a project with no delivery date falls back to its due date; a brand-new one with neither stays on top until it gets a date). Manual keeps the order you dragged cards into — switch to it before hand-arranging a column: re-ordering inside a column is blocked in Delivery date mode, because the order you'd write is shared with the team while this setting is only yours. Dragging a card to a different column works in either mode. Remembered in this browser and captured by saved views." />
            </span>
            <select
              value={sortMode}
              onChange={e => onSortModeChange?.(e.target.value as BoardSortMode)}
              className="bg-muted border border-border text-foreground/80 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-ring"
            >
              <option value="due">Delivery date</option>
              <option value="manual">Manual (drag)</option>
            </select>
          </label>
          <SavedViews<BoardViewConfig>
            storageKey="sot.savedViews"
            current={{ captain: captainFilter, salesperson: salespersonFilter, rerun: rerunFilter, type: typeFilter, due: dueFilter, dueFrom, dueTo, stage: stageFilter, sort: sortMode }}
            onApply={applyView}
            tooltip="Save the current board filters (captain, type, rerun, due, stage) and card sort as a named view and jump back in one click. Personal to you. Pick one, then Update / Rename / Delete."
          />
        </div>
      </div>
      {filtered.length === 0 && projects.length > 0 && hasActiveFilters && (
        <div className="bg-card border border-border rounded-xl px-4 py-6 text-center text-sm text-muted-foreground">
          No projects match your filters.{' '}
          <button onClick={clearAllFilters} className="text-blue-600 dark:text-blue-400 hover:underline">
            Clear all filters
          </button>
        </div>
      )}
      {wrapInContext ? (
        <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>{columns}</DragDropContext>
      ) : (
        columns
      )}
    </div>
  )
}

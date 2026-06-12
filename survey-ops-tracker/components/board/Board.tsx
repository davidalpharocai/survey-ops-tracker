'use client'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { BoardFilters } from './BoardFilters'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useIsNewForMe } from '@/lib/hooks/useSeenProjects'
import { STAGE_ORDER, getCheckboxesForColumn, type BoardColumn as BoardColumnType } from '@/lib/utils/stage'
import { getDueUrgency } from '@/lib/utils/date'
import { boardOrder, sortOrderBetween } from '@/lib/utils/ordering'
import type { SlimProject } from '@/lib/hooks/useProjects'
import type { TeamMember } from '@/lib/hooks/useTeamMembers'

interface BoardProps {
  projects: SlimProject[]
  teamMembers: TeamMember[]
  onMoveProject: (id: string, column: BoardColumnType, sortOrder?: number) => void
  // Full View provides a page-level DragDropContext (so cards can be dragged
  // from scoping into the pipeline); the board then skips its own context
  wrapInContext?: boolean
}

const CAPTAIN_FILTER_KEY = 'sot.captainFilter'

// Column order: urgent first, then high, then normal — Hold always sinks to the bottom
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1 }

export function columnSortRank(p: SlimProject): number {
  if (p.status === 'Hold') return 100
  return PRIORITY_RANK[p.priority ?? ''] ?? 2
}

export function Board({ projects, teamMembers, onMoveProject, wrapInContext = true }: BoardProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: currentMember, isLoading: memberLoading } = useCurrentMember()
  const isNewForMe = useIsNewForMe()
  const [captainFilter, setCaptainFilter] = useState<string | null>(null)
  const [filterReady, setFilterReady] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [dueFilter, setDueFilter] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string | null>(null)
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter(p => {
      if (
        captainFilter &&
        p.captain?.id !== captainFilter &&
        !(p.co_captain_ids ?? []).includes(captainFilter)
      )
        return false
      if (typeFilter && p.project_type !== typeFilter) return false
      if (dueFilter && getDueUrgency(p.due_date) !== dueFilter) return false
      if (stageFilter) {
        if (stageFilter === 'Closed') {
          if (p.status !== 'Closed') return false
        } else if (p.board_column !== stageFilter || p.status === 'Closed') {
          return false
        }
      }
      if (
        q &&
        !p.project_name.toLowerCase().includes(q) &&
        !p.client.toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
  }, [projects, captainFilter, typeFilter, dueFilter, stageFilter, search])

  function handleDragEnd(result: DropResult) {
    window.__sotDragging = false
    if (!result.destination) return
    const newColumn = result.destination.droppableId as BoardColumnType
    const sameColumn = newColumn === result.source.droppableId
    // The dropped card takes a persisted position between its new neighbors
    const destCards = filtered
      .filter(p => p.board_column === newColumn && p.id !== result.draggableId)
      .sort((a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b))
    const i = result.destination.index
    const sortOrder = sortOrderBetween(destCards[i - 1]?.sort_order, destCards[i]?.sort_order)
    if (sameColumn && result.destination.index === result.source.index) return
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
      {STAGE_ORDER.map(stage => (
        <BoardColumn
          key={stage}
          id={stage}
          title={stage}
          projects={filtered
            .filter(p => p.board_column === stage)
            .sort((a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b))}
          isNewFor={isNewForMe}
          onCardClick={id => router.push(`/projects/${id}`)}
        />
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <BoardFilters
        captains={teamMembers}
        captainFilter={captainFilter}
        currentMemberId={currentMember?.id ?? null}
        typeFilter={typeFilter}
        dueFilter={dueFilter}
        stageFilter={stageFilter}
        search={search}
        onCaptainChange={handleCaptainChange}
        onTypeChange={setTypeFilter}
        onDueChange={setDueFilter}
        onStageChange={setStageFilter}
        onSearchChange={setSearch}
      />
      {wrapInContext ? (
        <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>{columns}</DragDropContext>
      ) : (
        columns
      )}
    </div>
  )
}

'use client'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { BoardFilters } from './BoardFilters'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { STAGE_ORDER, type BoardColumn as BoardColumnType } from '@/lib/utils/stage'
import { getDueDateStatus } from '@/lib/utils/date'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { TeamMember } from '@/lib/hooks/useTeamMembers'

interface BoardProps {
  projects: SurveyProject[]
  teamMembers: TeamMember[]
  onMoveProject: (id: string, column: BoardColumnType) => void
}

export function Board({ projects, teamMembers, onMoveProject }: BoardProps) {
  const router = useRouter()
  const [captainFilter, setCaptainFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [overdueOnly, setOverdueOnly] = useState(false)

  const filtered = useMemo(() => {
    return projects.filter(p => {
      if (captainFilter && p.captain?.id !== captainFilter) return false
      if (typeFilter && p.project_type !== typeFilter) return false
      if (overdueOnly && getDueDateStatus(p.due_date) !== 'overdue') return false
      return true
    })
  }, [projects, captainFilter, typeFilter, overdueOnly])

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const newColumn = result.destination.droppableId as BoardColumnType
    if (newColumn !== result.source.droppableId) {
      onMoveProject(result.draggableId, newColumn)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <BoardFilters
        captains={teamMembers}
        captainFilter={captainFilter}
        typeFilter={typeFilter}
        overdueOnly={overdueOnly}
        onCaptainChange={setCaptainFilter}
        onTypeChange={setTypeFilter}
        onOverdueOnly={setOverdueOnly}
      />
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGE_ORDER.map(stage => (
            <BoardColumn
              key={stage}
              id={stage}
              title={stage}
              projects={filtered.filter(p => p.board_column === stage)}
              onCardClick={id => router.push(`/projects/${id}`)}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}

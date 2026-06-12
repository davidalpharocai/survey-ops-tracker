'use client'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { useRouter } from 'next/navigation'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useIsNewForMe } from '@/lib/hooks/useSeenProjects'
import { boardOrder } from '@/lib/utils/ordering'
import type { SlimProject } from '@/lib/hooks/useProjects'
import type { Database } from '@/lib/supabase/types'

type ScopingStage = Database['public']['Enums']['scoping_stage']

export const SCOPING_STAGES: ScopingStage[] = [
  'New Inquiry',
  'Proposal Sent',
  'Pricing Discussion',
  'Awaiting Approval',
]

interface ScopingBoardProps {
  projects: SlimProject[]
  // Full View provides a page-level DragDropContext shared with the pipeline
  // so cards can be dragged from scoping straight into a pipeline column
  wrapInContext?: boolean
}

export function ScopingBoard({ projects, wrapInContext = true }: ScopingBoardProps) {
  const router = useRouter()
  const updateProject = useUpdateProject()
  const isNewForMe = useIsNewForMe()

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const newStage = result.destination.droppableId as ScopingStage
    if (newStage !== result.source.droppableId) {
      updateProject.mutate({
        id: result.draggableId,
        updates: { scoping_stage: newStage },
      })
    }
  }

  const columns = (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {SCOPING_STAGES.map(stage => (
        <BoardColumn
          key={stage}
          id={stage}
          title={stage}
          projects={projects
            .filter(p => (p.scoping_stage ?? 'New Inquiry') === stage)
            .sort(boardOrder)}
          onCardClick={id => router.push(`/projects/${id}`)}
          isNewFor={isNewForMe}
        />
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          Scoping
        </h2>
        <span className="text-xs bg-violet-500/15 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full">
          {projects.length}
        </span>
        <span className="text-xs text-muted-foreground/60">
          drag a card into the pipeline below to approve it
        </span>
      </div>
      {wrapInContext ? (
        <DragDropContext onDragEnd={handleDragEnd}>{columns}</DragDropContext>
      ) : (
        columns
      )}
    </div>
  )
}

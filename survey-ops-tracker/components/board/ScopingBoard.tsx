'use client'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { useRouter } from 'next/navigation'
import { useUpdateProject } from '@/lib/hooks/useProjects'
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
}

export function ScopingBoard({ projects }: ScopingBoardProps) {
  const router = useRouter()
  const updateProject = useUpdateProject()

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
          Scoping
        </h2>
        <span className="text-xs bg-violet-500/15 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full">
          {projects.length}
        </span>
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {SCOPING_STAGES.map(stage => (
            <BoardColumn
              key={stage}
              id={stage}
              title={stage}
              projects={projects.filter(
                p => (p.scoping_stage ?? 'New Inquiry') === stage
              )}
              onCardClick={id => router.push(`/projects/${id}`)}
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  )
}

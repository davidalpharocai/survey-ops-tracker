'use client'
import { Droppable, Draggable } from '@hello-pangea/dnd'
import { ProjectCard } from './ProjectCard'
import { STAGE_DESCRIPTIONS } from '@/lib/utils/stage'
import type { SlimProject } from '@/lib/hooks/useProjects'

interface BoardColumnProps {
  id: string
  title: string
  projects: SlimProject[]
  onCardClick: (id: string) => void
  /** Predicate from useIsNewForMe — marks cards newly assigned to the viewer */
  isNewFor?: (p: SlimProject) => boolean
}

export function BoardColumn({ id, title, projects, onCardClick, isNewFor }: BoardColumnProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-2 min-w-[158px] max-w-[253px] flex-1 basis-0 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span
          className="text-xs text-muted-foreground uppercase tracking-widest font-medium"
          title={STAGE_DESCRIPTIONS[title]}
        >
          {title}
        </span>
        <span
          className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full"
          title="Number of projects in this column"
        >
          {projects.length}
        </span>
      </div>
      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-col gap-2 min-h-[80px] max-h-[calc(100vh-15rem)] overflow-y-auto thin-scroll rounded-lg transition-colors ${
              snapshot.isDraggingOver ? 'bg-accent/50' : ''
            }`}
          >
            {projects.map((project, index) => (
              <Draggable key={project.id} draggableId={project.id} index={index}>
                {(provided) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <ProjectCard
                      project={project}
                      onClick={() => onCardClick(project.id)}
                      isNew={isNewFor?.(project)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}

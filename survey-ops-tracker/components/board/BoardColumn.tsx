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
  /** Extra classes for the card list (e.g. a fixed lane height + scroll). The
   *  pipeline passes a uniform height so every column is the same size and
   *  scrolls on its own; scoping leaves it unset (natural height). */
  bodyClassName?: string
}

export function BoardColumn({ id, title, projects, onCardClick, isNewFor, bodyClassName = '' }: BoardColumnProps) {
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
            className={`flex flex-col gap-2 min-h-[80px] rounded-lg transition-colors ${bodyClassName} ${
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

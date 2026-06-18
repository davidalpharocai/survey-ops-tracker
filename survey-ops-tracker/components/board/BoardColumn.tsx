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
  /** Pipeline opt-in: when a column has no cards, shrink it to a narrow rail
   *  with a short placeholder instead of a full-width, full-height empty lane. */
  collapseWhenEmpty?: boolean
}

export function BoardColumn({ id, title, projects, onCardClick, isNewFor, bodyClassName = '', collapseWhenEmpty = false }: BoardColumnProps) {
  const collapsed = collapseWhenEmpty && projects.length === 0
  return (
    <div
      className={`bg-card border border-border rounded-xl p-2 flex flex-col gap-2 ${
        collapsed ? 'min-w-[116px] max-w-[140px] flex-none' : 'min-w-[158px] max-w-[253px] flex-1 basis-0'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs uppercase tracking-widest font-medium ${collapsed ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
          title={STAGE_DESCRIPTIONS[title]}
        >
          {title}
        </span>
        <span
          className={`text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full ${collapsed ? 'opacity-50' : ''}`}
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
            className={`flex flex-col gap-2 rounded-lg transition-colors ${
              collapsed ? 'min-h-[60px]' : `min-h-[80px] ${bodyClassName}`
            } ${snapshot.isDraggingOver ? 'bg-accent/50' : ''}`}
          >
            {collapsed && !snapshot.isDraggingOver && (
              <span className="text-[11px] text-muted-foreground/40 text-center py-3 px-1 border border-dashed border-border/50 rounded leading-snug">
                No projects
              </span>
            )}
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

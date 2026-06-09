'use client'
import { Droppable, Draggable } from '@hello-pangea/dnd'
import { ProjectCard } from './ProjectCard'
import type { SurveyProject } from '@/lib/hooks/useProjects'

interface BoardColumnProps {
  id: string
  title: string
  projects: SurveyProject[]
  onCardClick: (id: string) => void
}

export function BoardColumn({ id, title, projects, onCardClick }: BoardColumnProps) {
  return (
    <div className="bg-slate-900 rounded-xl p-3 min-w-[200px] flex flex-col gap-3 flex-shrink-0">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase tracking-widest font-medium">
          {title}
        </span>
        <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
          {projects.length}
        </span>
      </div>
      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-col gap-2 min-h-[80px] rounded-lg transition-colors ${
              snapshot.isDraggingOver ? 'bg-slate-800/50' : ''
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

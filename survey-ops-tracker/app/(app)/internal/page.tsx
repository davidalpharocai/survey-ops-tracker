'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useInternalProjects, useUpdateProject, type SlimProject } from '@/lib/hooks/useProjects'
import { useTeamMembers } from '@/lib/hooks/useTeamMembers'
import { useSprintConfig } from '@/lib/hooks/useSprintConfig'
import { useQueryClient } from '@tanstack/react-query'
import { columnSortRank } from '@/components/board/Board'
import { InternalCard } from '@/components/internal/InternalCard'
import { NewInternalProjectModal } from '@/components/internal/NewInternalProjectModal'
import { SkeletonCard } from '@/components/shared/Skeleton'
import { INTERNAL_STAGES } from '@/lib/utils/internal'
import { sprintLabel, currentSprintNumber } from '@/lib/utils/sprints'
import { boardOrder, sortOrderBetween } from '@/lib/utils/ordering'
import type { Database } from '@/lib/supabase/types'

declare global {
  interface Window { __sotDragging?: boolean }
}

export default function InternalProjectsPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading } = useInternalProjects()
  const { data: teamMembers = [] } = useTeamMembers()
  const { data: sprintCfg } = useSprintConfig()
  const updateProject = useUpdateProject()
  const [showNew, setShowNew] = useState(false)

  const active = projects.filter(p => p.status !== 'Closed')

  function handleDragEnd(result: DropResult) {
    window.__sotDragging = false
    if (!result.destination) return
    const to = result.destination.droppableId as Database['public']['Enums']['board_column']
    const id = result.draggableId
    const sameCol = to === result.source.droppableId
    if (sameCol && result.destination.index === result.source.index) return

    const destCards = active
      .filter(p => p.board_column === to && p.id !== id)
      .sort((a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b))
    const i = result.destination.index
    const sortOrder = sortOrderBetween(destCards[i - 1]?.sort_order, destCards[i]?.sort_order)

    // Same-tick optimistic patch so the drop animation targets the new home
    queryClient.setQueriesData<SlimProject[]>({ queryKey: ['internal-projects'] }, old =>
      old?.map(p => (p.id === id ? ({ ...p, board_column: to, sort_order: sortOrder } as SlimProject) : p))
    )
    updateProject.mutate({ id, updates: { board_column: to, sort_order: sortOrder } })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">Internal Projects</h1>
        {sprintCfg && (
          <span
            className="text-xs border border-border rounded-lg px-2.5 py-1 text-muted-foreground"
            title="The current sprint. Manage the cadence in Admin → Sprint cadence."
          >
            {sprintLabel(currentSprintNumber(sprintCfg), sprintCfg)}
          </span>
        )}
        <button
          onClick={() => setShowNew(true)}
          title="Create an internal project (defaults to AlphaROC, starts in Backlog)"
          className="ml-auto text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg transition-colors"
        >
          + New internal project
        </button>
      </div>

      {isLoading ? (
        <div className="flex gap-2">
          {INTERNAL_STAGES.map(s => (
            <div key={s} className="flex-1 bg-card border border-border rounded-xl p-2 flex flex-col gap-2">
              <SkeletonCard />
            </div>
          ))}
        </div>
      ) : (
        <DragDropContext onDragStart={() => { window.__sotDragging = true }} onDragEnd={handleDragEnd}>
          <div className="flex gap-2 overflow-x-auto pb-4">
            {INTERNAL_STAGES.map(stage => {
              const cards = active
                .filter(p => p.board_column === stage)
                .sort((a, b) => columnSortRank(a) - columnSortRank(b) || boardOrder(a, b))
              return (
                <div key={stage} className="bg-card border border-border rounded-xl p-2 min-w-[180px] flex-1 basis-0 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">{stage}</span>
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">{cards.length}</span>
                  </div>
                  <Droppable droppableId={stage}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`flex flex-col gap-2 min-h-[80px] h-[calc(100vh-13rem)] overflow-y-auto thin-scroll rounded-lg transition-colors ${snapshot.isDraggingOver ? 'bg-accent/50' : ''}`}
                      >
                        {cards.map((p, index) => (
                          <Draggable key={p.id} draggableId={p.id} index={index}>
                            {prov => (
                              <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}>
                                <InternalCard project={p} sprintConfig={sprintCfg ?? null} onClick={() => router.push(`/projects/${p.id}`)} />
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
            })}
          </div>
        </DragDropContext>
      )}

      {active.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground/60 -mt-2">No internal projects yet — create one to get started.</p>
      )}

      {showNew && <NewInternalProjectModal teamMembers={teamMembers} onClose={() => setShowNew(false)} />}
    </div>
  )
}

'use client'
import { useMemo } from 'react'
import { Caret } from '@/components/shared/Caret'
import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { BoardColumn } from './BoardColumn'
import { ScopingSignalsContext } from './ProjectCard'
import { InfoTooltip } from '@/components/shared/InfoTooltip'
import { useRouter } from 'next/navigation'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useIsNewForMe } from '@/lib/hooks/useSeenProjects'
import { useStoredFlag } from '@/lib/hooks/useStoredFlag'
import { type BoardSortMode } from '@/lib/utils/ordering'
import { fmtNum } from '@/lib/utils/number'
import {
  SCOPING_STAGES,
  collapsedLaneText,
  fieldActivityOf,
  laneCounts,
  laneStageOf,
  scopingLaneOrder,
  type FieldActivity,
  type ScopingStage,
} from '@/lib/board/sections'
import { useScopingFieldRows } from '@/lib/board/useScopingFieldRows'
import type { SlimProject } from '@/lib/hooks/useProjects'

// The columns now live with the classifier (lib/board/sections.ts), which has
// to know them to list a card whose stage is not a column. Re-exported because
// the project page's stage track and Full View import them from here.
export { SCOPING_STAGES }

interface ScopingBoardProps {
  // Every survey the board's section classifier puts in the Scoping lane
  // (lib/board/sections.ts): open AND held scoping deals. Held ones render in
  // their stage column like any other, greyed with an "On hold" badge.
  projects: SlimProject[]
  // Full View provides a page-level DragDropContext shared with the pipeline
  // so cards can be dragged from scoping straight into a pipeline column
  wrapInContext?: boolean
  // Card sort mode — shared with the pipeline board so both lanes on the page
  // obey one control, and so Full View's drop math matches what's rendered here.
  sortMode?: BoardSortMode
}

export function ScopingBoard({ projects, wrapInContext = true, sortMode = 'due' }: ScopingBoardProps) {
  const router = useRouter()
  const updateProject = useUpdateProject()
  const isNewForMe = useIsNewForMe()
  const [collapsed, setCollapsed] = useStoredFlag('sot.collapse.scoping', false)

  // Which of these deals already has fielding on record while its phase still
  // says Scoping. The child-row counts are read once for the whole lane (ids
  // only, never an amount); responses come straight off the slim row, so that
  // part of the flag shows even before the counts arrive.
  const fieldRows = useScopingFieldRows(projects.map(p => p.id))
  const signals = useMemo(() => {
    const m = new Map<string, FieldActivity>()
    for (const p of projects) {
      const a = fieldActivityOf(p, fieldRows.data?.rows.get(p.id))
      if (a) m.set(p.id, a)
    }
    return m
  }, [projects, fieldRows.data])
  // Open and held deals counted apart: the lane's number is its open work, the
  // holds get their own chip (see laneCounts for why).
  const counts = laneCounts(projects)
  const heldCount = counts.held
  // A table that did not load means "unknown", not "no fielding": say which,
  // so a missing amber flag is never read as a clean bill of health.
  const blockedTables = fieldRows.isError
    ? ['project_blasts', 'project_suppliers', 'project_costs']
    : (fieldRows.data?.blocked ?? []).map(b => b.table)

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
          // laneStageOf and scopingLaneOrder, not ad hoc: Full View's drop math
          // (app/(app)/page.tsx) picks the column and sorts through the same
          // two functions, so a drop lands where it was aimed. Held deals sink
          // to the bottom. A stage that is no column never reaches this lane:
          // the classifier lists that row above the board instead.
          projects={projects
            .filter(p => laneStageOf(p) === stage)
            .sort(scopingLaneOrder<SlimProject>(sortMode))}
          // Whole-card convenience click ONLY — the card wrapper is the dnd drag
          // handle, so it must not become an <a>. ProjectCard's TITLE carries the
          // real <a href> (new-tab / middle-click / cmd-click).
          onCardClick={id => router.push(`/projects/${id}`)}
          isNewFor={isNewForMe}
        />
      ))}
    </div>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand the scoping board' : 'Collapse the scoping board (your choice is remembered)'}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground uppercase tracking-widest font-semibold transition-colors"
        >
          <Caret open={!collapsed} className="text-foreground" />
          Scoping
        </button>
        <span
          className="text-xs bg-violet-500/15 text-violet-600 dark:text-violet-400 px-2 py-0.5 rounded-full"
          title="Open deals in Scoping. Deals on hold are not in this number; they are counted next to it."
        >
          {fmtNum(counts.open)}
        </span>
        {/* Held deals are counted out loud: David is working the number of
            holds down, so they must be visible, not buried in the total. */}
        {heldCount > 0 && (
          <span className="inline-flex items-center text-xs pl-2 pr-1 py-0.5 rounded-full bg-muted border border-muted-foreground/40 text-muted-foreground whitespace-nowrap">
            ⏸ {fmtNum(heldCount)} on hold
            <InfoTooltip text="Deals paused while still in Scoping. Each one stays in its column, greyed out and sorted to the bottom. Open it and press ▶ Resume to restart it, or use More → Cancel project if it is not coming back." />
          </span>
        )}
        {signals.size > 0 && (
          <span className="inline-flex items-center text-xs pl-2 pr-1 py-0.5 rounded-full border bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300 whitespace-nowrap">
            {fmtNum(signals.size)} with field activity
            <InfoTooltip text="Surveys still marked Scoping that already have blasts, panel suppliers, send fees or responses on record. Each card says what was found. If a survey is being fielded, drag it down into the pipeline so every report counts it as live work." />
          </span>
        )}
        <span className="text-xs text-muted-foreground/60">
          {collapsed ? collapsedLaneText(counts) : 'drag a card into the pipeline below to approve it'}
        </span>
      </div>
      {blockedTables.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Could not check for field activity: {blockedTables.join(', ')} did not load. A card without the
          amber flag may still have fielding on record.
        </p>
      )}
      {/* The cards read their "has field activity" flag from here (see
          ScopingSignalsContext in ProjectCard). */}
      {!collapsed && (
        <ScopingSignalsContext.Provider value={signals}>
          {wrapInContext ? (
            <DragDropContext onDragEnd={handleDragEnd}>{columns}</DragDropContext>
          ) : (
            columns
          )}
        </ScopingSignalsContext.Provider>
      )}
    </div>
  )
}

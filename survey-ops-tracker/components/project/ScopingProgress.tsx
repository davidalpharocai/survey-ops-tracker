'use client'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { getCheckboxesForColumn, STAGE_DESCRIPTIONS } from '@/lib/utils/stage'
import { SCOPING_STAGES } from '@/components/board/ScopingBoard'
import type { SurveyProject } from '@/lib/hooks/useProjects'

interface ScopingProgressProps {
  project: SurveyProject
}

export function ScopingProgress({ project }: ScopingProgressProps) {
  const updateProject = useUpdateProject()
  const current = project.scoping_stage ?? 'New Inquiry'

  function setStage(stage: (typeof SCOPING_STAGES)[number]) {
    updateProject.mutate({ id: project.id, updates: { scoping_stage: stage } })
  }

  function promote() {
    const today = new Date().toISOString().split('T')[0]
    updateProject.mutate({
      id: project.id,
      updates: {
        phase: 'Active',
        board_column: 'Submitted',
        submitted_date: today,
        ...getCheckboxesForColumn('Submitted'),
      },
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SCOPING_STAGES.map(stage => {
          const isCurrent = stage === current
          const isPast = SCOPING_STAGES.indexOf(stage) < SCOPING_STAGES.indexOf(current)
          return (
            <button
              key={stage}
              onClick={() => setStage(stage)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                isCurrent
                  ? 'bg-violet-500/20 border-violet-500 text-violet-600 dark:text-violet-300 font-medium'
                  : isPast
                  ? 'bg-muted border-border text-foreground/70'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-ring'
              }`}
              title={
                STAGE_DESCRIPTIONS[stage]
                  ? `${STAGE_DESCRIPTIONS[stage]} Click to set this stage.`
                  : 'Click to set stage'
              }
            >
              {isPast ? '✓ ' : ''}
              {stage}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={promote}
          className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition-colors"
        >
          ✓ Approved — move to pipeline
        </button>
        <span className="text-xs text-muted-foreground">
          Moves this project into the operations pipeline at &quot;Submitted&quot;.
        </span>
      </div>
    </div>
  )
}

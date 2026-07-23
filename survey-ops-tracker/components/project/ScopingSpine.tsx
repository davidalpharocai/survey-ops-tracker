'use client'
import { getCheckboxesForColumn, STAGE_DESCRIPTIONS } from '@/lib/utils/stage'
import { SCOPING_STAGES } from '@/components/board/ScopingBoard'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import type { SurveyProject } from '@/lib/hooks/useProjects'

interface ScopingSpineProps {
  project: SurveyProject
}

/**
 * Command-bar "Cockpit Spine" for the Scoping phase — the pre-sale mirror of
 * PipelineSpine. A horizontal dot progress path across the scoping stages plus a
 * success-toned "Approve" CTA that graduates the project into the operations
 * pipeline at Submitted. Reuses the exact setStage + promote mechanics from the
 * legacy ScopingProgress card, so clicking a dot or the CTA behaves identically.
 */
export function ScopingSpine({ project }: ScopingSpineProps) {
  const updateProject = useUpdateProject()

  const current = project.scoping_stage ?? 'New Inquiry'
  const idx = SCOPING_STAGES.indexOf(current)

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
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
      {/* Dot path */}
      <div className="flex items-start min-w-0 flex-1">
        {SCOPING_STAGES.map((stage, i) => {
          // Display state is derived purely from the scoping-stage index: nodes
          // before the current stage read done, the current node is the accent
          // dot, and later nodes stay hollow. Every node is clickable and sets
          // that stage (mirror of ScopingProgress's setStage).
          const nodeState: 'done' | 'current' | 'upcoming' =
            i < idx ? 'done' : i === idx ? 'current' : 'upcoming'
          const isCurrent = nodeState === 'current'
          const leftFilled = i > 0 && i <= idx
          const rightFilled = i < idx

          return (
            <div key={stage} className="flex flex-col items-center min-w-0 flex-1">
              {/* connector + dot row */}
              <div className="flex items-center w-full">
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 rounded-full ${
                    i === 0 ? 'invisible' : leftFilled ? 'bg-emerald-500/60' : 'bg-border'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setStage(stage)}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={`${STAGE_DESCRIPTIONS[stage] ?? stage} Click to set this stage.${isCurrent ? ' (Current stage.)' : ''}`}
                  className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full border text-xs leading-none transition-colors cursor-pointer hover:border-ring ${
                    nodeState === 'done'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : nodeState === 'current'
                      ? 'bg-primary border-primary text-primary-foreground ring-2 ring-primary/40'
                      : 'bg-muted border-border text-muted-foreground'
                  }`}
                >
                  <span aria-hidden>{nodeState === 'done' ? '✓' : nodeState === 'current' ? '▶' : ''}</span>
                </button>
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 rounded-full ${
                    i === SCOPING_STAGES.length - 1 ? 'invisible' : rightFilled ? 'bg-emerald-500/60' : 'bg-border'
                  }`}
                />
              </div>
              {/* label */}
              <span
                className={`mt-1.5 text-[10px] leading-tight whitespace-nowrap ${
                  isCurrent
                    ? 'text-primary font-semibold'
                    : nodeState === 'done'
                    ? 'text-foreground/70'
                    : 'text-muted-foreground'
                }`}
              >
                {stage}
              </span>
            </div>
          )
        })}
      </div>

      {/* Terminal scoping action: graduate into the pipeline. Emerald-toned so it
          reads as a "graduate" success action, not a mid-pipeline advance. */}
      <div className="flex flex-col items-start gap-1 shrink-0">
        <button
          type="button"
          onClick={promote}
          title="Approve this scoping deal and move it into the operations pipeline at Submitted."
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shrink-0"
        >
          <span aria-hidden>✓</span> Approve — move to pipeline
        </button>
        <span className="text-[11px] text-muted-foreground">
          Moves this project into the pipeline at &quot;Submitted&quot;.
        </span>
      </div>
    </div>
  )
}

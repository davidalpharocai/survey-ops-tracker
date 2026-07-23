'use client'
import { STAGE_ORDER, STAGE_DESCRIPTIONS, stageLabel } from '@/lib/utils/stage'
import { usePipelineStage, STAGE_TO_FIELD } from '@/lib/hooks/usePipelineStage'
import { ComplianceGateModal } from './ComplianceGateModal'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// The two-word programming stages have the longest labels, so give them extra
// width; Delivery's label is short, so it can be narrower. Others stay even.
const STAGE_GROW: Record<string, string> = {
  'Doc Programming': 'flex-[1.35]',
  'Survey Programming': 'flex-[1.35]',
  'Delivery': 'flex-[0.8]',
}

interface PipelineProgressProps {
  project: SurveyProject
}

export function PipelineProgress({ project }: PipelineProgressProps) {
  // Advance mechanism + compliance gate live in the shared hook so this legacy
  // checkbox row and the command-bar PipelineSpine behave identically.
  const { toggleStage, gate, setGate } = usePipelineStage(project)

  return (
    <div>
      {/* One row: each bubble shares the width and wraps its own label (e.g.
          "Survey Programming" stacks to two short lines) so all seven stages
          fit without horizontal scrolling. */}
      <div className="flex items-stretch gap-1">
        {STAGE_ORDER.map((stage, i) => {
          const field = STAGE_TO_FIELD[stage]
          const isDone = field ? project[field] : false
          const isCurrent = stage === project.board_column
          const isClickable = stage !== 'Submitted'

          return (
            <div key={stage} className={`flex items-center gap-1 ${STAGE_GROW[stage] ?? 'flex-1'} min-w-0`}>
              <button
                onClick={() => isClickable && toggleStage(stage)}
                disabled={!isClickable}
                title={
                  isClickable
                    ? `${STAGE_DESCRIPTIONS[stage] ?? stage} Click to toggle this stage done/undone.${isCurrent ? ' (Current stage.)' : ''}`
                    : `${STAGE_DESCRIPTIONS[stage]}${isCurrent ? ' (Current stage.)' : ''}`
                }
                className={`w-full min-w-0 flex flex-col items-center justify-center text-center gap-0.5 px-1.5 py-1.5 rounded-lg text-xs leading-tight border transition-colors ${
                  isDone
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-medium'
                    : isCurrent
                    ? 'bg-amber-500/25 border-amber-500/70 ring-1 ring-amber-500/50 text-amber-700 dark:text-amber-300 font-semibold'
                    : 'bg-muted border-border text-muted-foreground font-medium'
                } ${isClickable ? 'hover:border-ring cursor-pointer' : 'cursor-default'}`}
              >
                <span aria-hidden>{isDone ? '✓' : isCurrent ? '▶' : '○'}</span>
                <span className="break-words">{stageLabel(stage)}</span>
              </button>
              {i < STAGE_ORDER.length - 1 && (
                <span className="shrink-0 text-muted-foreground/40 text-xs select-none">→</span>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground/50 mt-2">
        Checking a stage advances the project card on the board. Uncheck to move it back.
      </p>
      {gate && (
        <ComplianceGateModal
          message={gate.message}
          contact={gate.contact}
          onCancel={() => setGate(null)}
          onOverride={gate.onOverride}
        />
      )}
    </div>
  )
}

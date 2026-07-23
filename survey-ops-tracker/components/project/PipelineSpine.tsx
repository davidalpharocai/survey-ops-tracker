'use client'
import { STAGE_ORDER, STAGE_DESCRIPTIONS, stageLabel, type BoardColumn } from '@/lib/utils/stage'
import { usePipelineStage } from '@/lib/hooks/usePipelineStage'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { HelpTip } from '@/components/shared/InfoTooltip'
import { ComplianceGateModal } from './ComplianceGateModal'
import type { SurveyProject } from '@/lib/hooks/useProjects'

interface PipelineSpineProps {
  project: SurveyProject
}

/**
 * Command-bar "Cockpit Spine": a horizontal dot progress path across the seven
 * pipeline stages plus a state-aware primary CTA that advances the project. It
 * reuses the exact advance + compliance-gate mechanism (via usePipelineStage),
 * so clicking a dot or the CTA behaves identically to the legacy checkbox row.
 */
export function PipelineSpine({ project }: PipelineSpineProps) {
  const { toggleStage, gate, setGate } = usePipelineStage(project)
  const updateProject = useUpdateProject()

  // CTA state: the next stage to advance into is the one right after the
  // current board column. Delivery is terminal (shows a chip, not a button).
  const currentIdx = STAGE_ORDER.indexOf(project.board_column as BoardColumn)
  const isDelivered = project.board_column === 'Delivery'
  const nextStage =
    currentIdx >= 0 && currentIdx < STAGE_ORDER.length - 1
      ? STAGE_ORDER[currentIdx + 1]
      : null
  const willDeliver = nextStage === 'Delivery'

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
      {/* Dot path */}
      <div className="flex items-start min-w-0 flex-1">
        {STAGE_ORDER.map((stage, i) => {
          // Display state is derived purely from the board-column index (the
          // source of truth for where the project *is*), not the per-stage
          // checkbox fields: nodes before the current stage read done, the
          // current node is ALWAYS the accent dot, and later nodes stay hollow
          // even if a later checkbox was toggled. Delivered is terminal, so its
          // (last) node reads done rather than "current". Click behavior below
          // is unchanged — every node still calls toggleStage(stage).
          const nodeState: 'done' | 'current' | 'upcoming' =
            i < currentIdx
              ? 'done'
              : i === currentIdx
              ? isDelivered
                ? 'done'
                : 'current'
              : 'upcoming'
          const isCurrent = nodeState === 'current'
          const isClickable = stage !== 'Submitted'
          const leftFilled = i > 0 && i <= currentIdx
          const rightFilled = i < currentIdx

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
                  onClick={() => isClickable && toggleStage(stage)}
                  disabled={!isClickable}
                  aria-current={isCurrent ? 'step' : undefined}
                  title={
                    isClickable
                      ? `${STAGE_DESCRIPTIONS[stage] ?? stage} Click to toggle this stage done/undone.${isCurrent ? ' (Current stage.)' : ''}`
                      : `${STAGE_DESCRIPTIONS[stage] ?? stage}${isCurrent ? ' (Current stage.)' : ''}`
                  }
                  className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full border text-xs leading-none transition-colors ${
                    nodeState === 'done'
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : nodeState === 'current'
                      ? 'bg-primary border-primary text-primary-foreground ring-2 ring-primary/40'
                      : 'bg-muted border-border text-muted-foreground'
                  } ${isClickable ? 'cursor-pointer hover:border-ring' : 'cursor-default'}`}
                >
                  <span aria-hidden>{nodeState === 'done' ? '✓' : nodeState === 'current' ? '▶' : ''}</span>
                </button>
                <span
                  aria-hidden
                  className={`h-0.5 flex-1 rounded-full ${
                    i === STAGE_ORDER.length - 1 ? 'invisible' : rightFilled ? 'bg-emerald-500/60' : 'bg-border'
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
                {stageLabel(stage)}
              </span>
            </div>
          )
        })}
      </div>

      {/* State-aware primary CTA + Back to Scoping */}
      <div className="flex items-center gap-3 shrink-0">
        {isDelivered ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <span aria-hidden>✓</span> Delivered
          </span>
        ) : willDeliver ? (
          <button
            type="button"
            onClick={() => toggleStage('Delivery')}
            title="Mark this project delivered — the deliverable has been sent to the client."
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shrink-0"
          >
            Mark delivered <span aria-hidden>✓</span>
          </button>
        ) : nextStage ? (
          <button
            type="button"
            onClick={() => toggleStage(nextStage)}
            title={`${STAGE_DESCRIPTIONS[nextStage] ?? ''} Advances this project to ${stageLabel(nextStage)}.`}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors shrink-0"
          >
            Advance to {stageLabel(nextStage)} <span aria-hidden>→</span>
          </button>
        ) : null}

        {project.status !== 'Closed' && (
          <HelpTip text="Moves this project back to the Scoping board — for deals that reopened (pricing changed, approval fell through). Stage checkboxes are kept, so promoting it again picks up right where it left off. You can also drag the card onto a scoping column in Full View.">
            <button
              type="button"
              onClick={() =>
                updateProject.mutate({
                  id: project.id,
                  updates: {
                    phase: 'Scoping',
                    scoping_stage: project.scoping_stage ?? 'Awaiting Approval',
                  },
                })
              }
              className="text-xs text-muted-foreground hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer whitespace-nowrap"
            >
              ↩ Back to Scoping
            </button>
          </HelpTip>
        )}
      </div>

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

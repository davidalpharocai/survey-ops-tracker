'use client'
import { useState } from 'react'
import { STAGE_ORDER, STAGE_DESCRIPTIONS, stageLabel } from '@/lib/utils/stage'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import { complianceGate } from '@/lib/utils/compliance'
import { autoStamp } from '@/lib/utils/date'
import { ComplianceGateModal } from './ComplianceGateModal'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { BoardColumn } from '@/lib/utils/stage'

const STAGE_TO_FIELD: Record<string, keyof Pick<SurveyProject,
  'stage_doc_programming' | 'stage_survey_programming' | 'stage_edwin_qa' |
  'stage_fielding' | 'stage_data_qa' | 'stage_delivery'>> = {
  'Doc Programming': 'stage_doc_programming',
  'Survey Programming': 'stage_survey_programming',
  'EdWin QA': 'stage_edwin_qa',
  'Fielding': 'stage_fielding',
  'Data QA': 'stage_data_qa',
  'Delivery': 'stage_delivery',
}

// The two-word programming stages have the longest labels, so give them extra
// width; Delivery's label is short, so it can be narrower. Others stay even.
const STAGE_GROW: Record<string, string> = {
  'Doc Programming': 'flex-[1.35]',
  'Survey Programming': 'flex-[1.35]',
  'Delivery': 'flex-[0.8]',
}

function deriveColumn(updates: Record<string, boolean>): BoardColumn {
  if (!updates['stage_doc_programming']) return 'Submitted'
  if (!updates['stage_survey_programming']) return 'Doc Programming'
  if (!updates['stage_edwin_qa']) return 'Survey Programming'
  if (!updates['stage_fielding']) return 'EdWin QA'
  if (!updates['stage_data_qa']) return 'Fielding'
  if (!updates['stage_delivery']) return 'Data QA'
  return 'Delivery'
}

interface PipelineProgressProps {
  project: SurveyProject
}

export function PipelineProgress({ project }: PipelineProgressProps) {
  const updateProject = useUpdateProject()
  const { data: currentMember } = useCurrentMember()
  const { data: compliance } = useComplianceState(project.id, project.client, project.compliance_override ?? null)
  const [gate, setGate] = useState<{ message: string; contact: string | null; onOverride: (reason: string) => void } | null>(null)

  // Apply a stage move; `overrideNote`, when present, is stamped into the
  // project's Latest/Next Steps (attributed + timestamped + captured by the
  // audit trigger) to record a compliance override.
  function applyMove(newState: Record<string, boolean>, newColumn: BoardColumn, overrideNote?: string) {
    const userName = currentMember?.name ?? 'Someone'
    updateProject.mutate({
      id: project.id,
      updates: {
        ...newState,
        board_column: newColumn,
        ...(overrideNote ? { latest_next_steps: autoStamp(userName, project.latest_next_steps, overrideNote) } : {}),
      },
    })
  }

  function toggleStage(stage: string) {
    const field = STAGE_TO_FIELD[stage]
    if (!field) return // Submitted has no checkbox

    const newValue = !project[field]

    // Build new checkbox state: if checking, also check all prior stages
    const newState: Record<string, boolean> = {
      stage_doc_programming: project.stage_doc_programming,
      stage_survey_programming: project.stage_survey_programming,
      stage_edwin_qa: project.stage_edwin_qa,
      stage_fielding: project.stage_fielding,
      stage_data_qa: project.stage_data_qa,
      stage_delivery: project.stage_delivery,
    }

    if (newValue) {
      // Check this stage and all prior stages
      for (const s of STAGE_ORDER.slice(1)) { // skip 'Submitted'
        const f = STAGE_TO_FIELD[s]
        if (!f) continue
        newState[f] = true
        if (s === stage) break
      }
    } else {
      // Uncheck this stage and all subsequent stages
      let unchecking = false
      for (const s of STAGE_ORDER.slice(1)) {
        const f = STAGE_TO_FIELD[s]
        if (!f) continue
        if (s === stage) unchecking = true
        if (unchecking) newState[f] = false
      }
    }

    const newColumn = deriveColumn(newState)

    // Compliance guardrail: block fielding/delivery when the client's review
    // isn't approved; allow an explicit, recorded override.
    const willMarkDelivered = newState.stage_delivery === true && !project.stage_delivery
    const g = complianceGate({
      targetColumn: newColumn,
      willMarkDelivered,
      client: compliance?.client ?? null,
      override: project.compliance_override ?? null,
      submissions: compliance?.submissions ?? [],
    })
    if (g.blocked) {
      setGate({
        message: g.message,
        contact: compliance?.contact ?? null,
        onOverride: (reason: string) => {
          applyMove(newState, newColumn, `⚠ Compliance override (${g.phase}): ${reason}`)
          setGate(null)
        },
      })
      return
    }

    applyMove(newState, newColumn)
  }

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

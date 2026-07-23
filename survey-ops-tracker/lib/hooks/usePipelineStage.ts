'use client'
import { useState } from 'react'
import { STAGE_ORDER } from '@/lib/utils/stage'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import { complianceGate } from '@/lib/utils/compliance'
import { autoStamp } from '@/lib/utils/date'
import type { SurveyProject } from '@/lib/hooks/useProjects'
import type { BoardColumn } from '@/lib/utils/stage'

// Map a pipeline stage label to its boolean "done" column. 'Submitted' has no
// checkbox, so it is intentionally absent. Exported so presentation components
// (PipelineProgress, PipelineSpine) can read the same per-stage done flag.
export const STAGE_TO_FIELD: Record<string, keyof Pick<SurveyProject,
  'stage_doc_programming' | 'stage_survey_programming' | 'stage_edwin_qa' |
  'stage_fielding' | 'stage_data_qa' | 'stage_delivery'>> = {
  'Doc Programming': 'stage_doc_programming',
  'Survey Programming': 'stage_survey_programming',
  'EdWin QA': 'stage_edwin_qa',
  'Fielding': 'stage_fielding',
  'Data QA': 'stage_data_qa',
  'Delivery': 'stage_delivery',
}

// Derive the board column from the six stage booleans: the current column is
// the first stage whose checkbox is still unchecked (all delivered => Delivery).
function deriveColumn(updates: Record<string, boolean>): BoardColumn {
  if (!updates['stage_doc_programming']) return 'Submitted'
  if (!updates['stage_survey_programming']) return 'Doc Programming'
  if (!updates['stage_edwin_qa']) return 'Survey Programming'
  if (!updates['stage_fielding']) return 'EdWin QA'
  if (!updates['stage_data_qa']) return 'Fielding'
  if (!updates['stage_delivery']) return 'Data QA'
  return 'Delivery'
}

export interface PipelineGate {
  message: string
  contact: string | null
  onOverride: (reason: string) => void
}

/**
 * The shared pipeline-advance mechanism used by both PipelineProgress (the
 * legacy checkbox row) and PipelineSpine (the command-bar dot path). It owns
 * the exact toggle → derive-column → compliance-gate → mutate flow so the two
 * surfaces behave identically. `gate` holds pending compliance-modal state;
 * the consumer renders `<ComplianceGateModal>` from it.
 */
export function usePipelineStage(project: SurveyProject) {
  const updateProject = useUpdateProject()
  const { data: currentMember } = useCurrentMember()
  const { data: compliance } = useComplianceState(project.id, project.client, project.compliance_override ?? null)
  const [gate, setGate] = useState<PipelineGate | null>(null)

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

  return { toggleStage, gate, setGate }
}

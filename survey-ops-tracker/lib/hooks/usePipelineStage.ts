'use client'
import { useState } from 'react'
import { getCheckboxesForColumn } from '@/lib/utils/stage'
import { useUpdateProject } from '@/lib/hooks/useProjects'
import { useCurrentMember } from '@/lib/hooks/useCurrentMember'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import { useRequestedByContact, useMarkOccamInvited } from '@/lib/hooks/useOccamOnboarding'
import { complianceGate } from '@/lib/utils/compliance'
import { occamOnboardingGate } from '@/lib/utils/occam'
import { nFloorDeliveryGate } from '@/lib/utils/nFloor'
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

// deriveColumn used to live here — a verbatim second copy of
// deriveCurrentStage in lib/utils/stage.ts. It is gone: goToStage below sets the
// flags with getCheckboxesForColumn, which IS that function's inverse (proved by
// lib/utils/stage.test.ts), so the destination column is simply the stage
// clicked and nothing needs deriving. One fewer copy of a definition that had
// already drifted once.

export interface PipelineGate {
  message: string
  contact: string | null
  onOverride: (reason: string) => void
}

export interface OccamGate {
  contactName: string
  contactEmail: string | null
  onConfirmSent: () => void
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
  const { data: requestedByContact } = useRequestedByContact(project.requested_by_contact_id ?? null)
  const markOccamInvited = useMarkOccamInvited()
  const [gate, setGate] = useState<PipelineGate | null>(null)
  const [occamGate, setOccamGate] = useState<OccamGate | null>(null)

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

  // After compliance clears (or is overridden), run the Occam onboarding gate on the
  // deliver transition: block the first delivery to a requested-by contact until the
  // Occam invite is confirmed sent. `complianceNote`, if present, is carried through so
  // an override is still recorded even if the Occam prompt also fires.
  function proceedToDelivery(
    newState: Record<string, boolean>,
    newColumn: BoardColumn,
    willMarkDelivered: boolean,
    complianceNote?: string,
  ) {
    if (willMarkDelivered) {
      const og = occamOnboardingGate({
        willMarkDelivered,
        requestedByContactId: project.requested_by_contact_id ?? null,
        projectUsesOccam: project.occam ?? false,
        contactHasPriorDelivery: requestedByContact?.hasPriorDelivery ?? false,
        contactOccamInvited: requestedByContact?.occam_invited ?? false,
      })
      if (og.blocked) {
        setOccamGate({
          contactName: requestedByContact?.name ?? 'the requested-by contact',
          contactEmail: requestedByContact?.email ?? null,
          onConfirmSent: () => {
            const contactId = project.requested_by_contact_id
            if (contactId) markOccamInvited.mutate({ contactId, invitedBy: currentMember?.name ?? 'Someone' })
            applyMove(newState, newColumn, complianceNote)
            setOccamGate(null)
          },
          onOverride: (reason: string) => {
            const note = [complianceNote, `⚠ Delivered without confirming the Occam invite: ${reason}`]
              .filter(Boolean)
              .join(' · ')
            applyMove(newState, newColumn, note)
            setOccamGate(null)
          },
        })
        return
      }
    }
    applyMove(newState, newColumn, complianceNote)
  }

  /**
   * Move the project TO `stage`. Clicking a stage lands the project in it,
   * whether that is forwards or backwards.
   *
   * IT USED TO BE A TOGGLE, and David asked for this change on 2026-09-03 after
   * hitting the consequence: "when i move a survey back to fielding, it goes to
   * EdwinQA instead and only then can i move it to fielding". Clicking a
   * COMPLETED stage flipped its flag off, and a project with stage_fielding
   * false is by definition before Fielding — so a backwards click landed one
   * stage early while a forwards click landed on the stage clicked. The same
   * gesture did two different things depending on direction, which is what made
   * it feel broken rather than merely surprising.
   *
   * The whole body is now getCheckboxesForColumn(stage): every stage up to and
   * including the destination reached, everything after it not. That function is
   * the tested inverse of deriveCurrentStage, so the flags and the column cannot
   * disagree — which is the bug fixed in the same change (10 live rows were
   * self-contradictory).
   *
   * WHAT YOU LOSE: clicking the CURRENT stage is now a no-op rather than
   * un-ticking it. To step back, click the earlier stage — which is the gesture
   * David expected in the first place. Every stage stays reachable in one click
   * from anywhere.
   */
  function goToStage(stage: string) {
    if (!STAGE_TO_FIELD[stage]) return // Submitted has no node to click

    const newColumn = stage as BoardColumn
    const newState: Record<string, boolean> = getCheckboxesForColumn(newColumn)

    // Compliance guardrail: block fielding/delivery when the client's review
    // isn't approved; allow an explicit, recorded override.
    const willMarkDelivered = newState.stage_delivery === true && !project.stage_delivery
    const g = complianceGate({
      targetColumn: newColumn,
      willMarkDelivered,
      client: compliance?.client ?? null,
      override: project.compliance_override ?? null,
      submissions: compliance?.submissions ?? [],
      rerunNumber: project.rerun_number,
      complianceRequiredOverride: project.compliance_required_override,
    })
    if (g.blocked) {
      setGate({
        message: g.message,
        contact: compliance?.contact ?? null,
        onOverride: (reason: string) => {
          setGate(null)
          proceedToDelivery(newState, newColumn, willMarkDelivered, `⚠ Compliance override (${g.phase}): ${reason}`)
        },
      })
      return
    }

    // Gen-pop N floor, re-checked at the last possible moment. The card in the
    // N & Audience section already advises during fielding, but the number that
    // matters is the one we are about to deliver — so a population-representative
    // study whose cleaned N came in under our own standard asks for a recorded
    // sign-off here rather than going out quietly. Same soft shape as the two
    // gates above: it never hard-blocks, it just makes someone say why.
    const nf = nFloorDeliveryGate({
      willMarkDelivered,
      audience: project.audience,
      project_type: project.project_type,
      n_internal_target: project.n_internal_target,
      n_collected: project.n_collected,
      n_actual: project.n_actual,
      n_floor_override: project.n_floor_override,
    })
    if (nf.blocked) {
      setGate({
        message: nf.message,
        contact: null,
        onOverride: (reason: string) => {
          setGate(null)
          proceedToDelivery(newState, newColumn, willMarkDelivered, `⚠ Gen-pop N floor override: ${reason}`)
        },
      })
      return
    }

    proceedToDelivery(newState, newColumn, willMarkDelivered)
  }

  return { goToStage, gate, setGate, occamGate, setOccamGate }
}

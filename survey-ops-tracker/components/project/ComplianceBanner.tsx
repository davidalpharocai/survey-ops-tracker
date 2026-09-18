'use client'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import {
  beforeFieldingRequired,
  afterFieldingRequired,
  beforeFieldingMet,
  afterFieldingMet,
} from '@/lib/utils/compliance'
import { STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// Amber heads-up on the project page when a required compliance review is still
// outstanding, so the Fielding/Delivery gate is never a surprise. Renders
// nothing when compliance isn't required or everything required is approved.
export function ComplianceBanner({ project }: { project: SurveyProject }) {
  const { data: cs } = useComplianceState(project.id, project.client, project.compliance_override ?? null)
  if (!cs) return null

  const beforeOutstanding =
    beforeFieldingRequired(cs.client, cs.override, project.rerun_number, project.compliance_required_override) &&
    !beforeFieldingMet(cs.submissions)
  // The after-fielding review is a PRE-DELIVERY step, and this banner used to
  // announce it from the moment the survey existed. David, 2026-09-17:
  // "surveys under some accounts flag a compliance stage between fielding and
  // data qa. theres no client that has that. its only after qa pre delivery."
  //
  // The GATE was always correct — complianceGate only blocks on the move to
  // Delivered — but a permanently-amber banner reads as a stage of its own
  // sitting in the pipeline, which is exactly what he saw. So the prompt now
  // waits until the survey has reached Data QA, which is the first moment
  // anyone could actually send questions AND results for review.
  const stageIdx = STAGE_ORDER.indexOf(project.board_column as BoardColumn)
  const atOrPastDataQa = stageIdx >= STAGE_ORDER.indexOf('Data QA')
  const afterRequired =
    afterFieldingRequired(cs.client, cs.override, project.rerun_number, project.compliance_required_override) &&
    !afterFieldingMet(cs.submissions)
  const afterOutstanding = afterRequired && atOrPastDataQa

  // Nothing outstanding — if that's because a rerun wave waived a review this
  // client would otherwise require, say so explicitly so the missing gate
  // never reads as a bug. Only the two explicit force signals win over the waiver.
  if (!beforeOutstanding && !afterOutstanding) {
    const waived =
      (project.rerun_number ?? 1) >= 2 &&
      project.compliance_override !== true &&
      !project.compliance_required_override
    if (!waived) return null
    return (
      <div className="mb-4 flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
        <span className="text-lg leading-none mt-0.5">🛡️</span>
        <div className="flex-1 text-sm text-muted-foreground">
          Compliance not required — rerun wave (waived after Wave 1). Force with the per-wave override.
        </div>
      </div>
    )
  }

  const firm = project.client.split(' - ')[0].trim()

  return (
    <div className="mb-4 flex items-start gap-3 bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3">
      <span className="text-lg leading-none mt-0.5">🛡️</span>
      <div className="flex-1 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-300">
          Compliance review outstanding for {firm}
        </p>
        <ul className="text-muted-foreground mt-0.5 leading-relaxed list-disc pl-4">
          {beforeOutstanding && (
            <li>
              <span className="text-foreground">Before fielding:</span> the questionnaire must be approved before this survey can be fielded.
            </li>
          )}
          {afterOutstanding && (
            <li>
              <span className="text-foreground">Before delivery:</span> the questions + results must be approved before this survey can be delivered.
            </li>
          )}
        </ul>
        {cs.contact && (
          <p className="text-xs text-muted-foreground mt-1">
            Compliance contact: <span className="text-foreground">{cs.contact}</span>
          </p>
        )}
        {cs.notes && <p className="text-xs text-muted-foreground/80 mt-0.5">Note: {cs.notes}</p>}
        <p className="text-xs text-muted-foreground/70 mt-1">Use the Compliance Review panel below to send for review.</p>
      </div>
    </div>
  )
}

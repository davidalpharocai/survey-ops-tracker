'use client'
import { useComplianceState } from '@/lib/hooks/useComplianceState'
import {
  beforeFieldingRequired,
  afterFieldingRequired,
  beforeFieldingMet,
  afterFieldingMet,
} from '@/lib/utils/compliance'
import type { SurveyProject } from '@/lib/hooks/useProjects'

// Amber heads-up on the project page when a required compliance review is still
// outstanding, so the Fielding/Delivery gate is never a surprise. Renders
// nothing when compliance isn't required or everything required is approved.
export function ComplianceBanner({ project }: { project: SurveyProject }) {
  const { data: cs } = useComplianceState(project.id, project.client, project.compliance_override ?? null)
  if (!cs) return null

  const beforeOutstanding = beforeFieldingRequired(cs.client, cs.override) && !beforeFieldingMet(cs.submissions)
  const afterOutstanding = afterFieldingRequired(cs.client, cs.override) && !afterFieldingMet(cs.submissions)
  if (!beforeOutstanding && !afterOutstanding) return null

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
              <span className="text-foreground">After fielding:</span> the questions + results must be approved before delivery.
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

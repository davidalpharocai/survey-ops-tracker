import { STAGE_ORDER, type BoardColumn } from './stage'

export interface ClientCompliance {
  compliance_before_fielding: boolean
  compliance_after_fielding: boolean
}
export interface SubmissionLite {
  phase: string
  status: string
}

// Precedence (top to bottom):
//   1. override === true            -> force required (per-project force)
//   2. override === false           -> force skip (per-project skip)
//   3. requiredOverride === true    -> force required (per-WAVE force)
//   4. rerunNumber >= 2             -> waived (a rerun wave is the same survey
//                                      Wave 1 was already compliance-approved
//                                      for — the client flag still gates Wave 1)
//   5. else                         -> follow the client's flag
export function beforeFieldingRequired(
  client: ClientCompliance | null,
  override: boolean | null,
  rerunNumber?: number,
  requiredOverride?: boolean | null
): boolean {
  if (override === true) return true
  if (override === false) return false
  if (requiredOverride === true) return true
  if ((rerunNumber ?? 1) >= 2) return false
  return !!client?.compliance_before_fielding
}
export function afterFieldingRequired(
  client: ClientCompliance | null,
  override: boolean | null,
  rerunNumber?: number,
  requiredOverride?: boolean | null
): boolean {
  if (override === true) return true
  if (override === false) return false
  if (requiredOverride === true) return true
  if ((rerunNumber ?? 1) >= 2) return false
  return !!client?.compliance_after_fielding
}

const approvedOf = (subs: SubmissionLite[], phase: string) =>
  subs.some(s => s.phase === phase && s.status === 'approved')

export const beforeFieldingMet = (subs: SubmissionLite[]) => approvedOf(subs, 'before_fielding')
export const afterFieldingMet = (subs: SubmissionLite[]) => approvedOf(subs, 'after_fielding')

const FIELDING_IDX = STAGE_ORDER.indexOf('Fielding')

export interface GateInput {
  targetColumn: BoardColumn
  willMarkDelivered: boolean
  client: ClientCompliance | null
  override: boolean | null
  submissions: SubmissionLite[]
  /** The project's rerun wave number (1 = original). >= 2 waives the compliance
   *  gate unless requiredOverride forces it back on. Undefined/null treated as 1. */
  rerunNumber?: number
  /** Per-wave force-required override (survey_projects.compliance_required_override). */
  complianceRequiredOverride?: boolean | null
}
export interface GateResult {
  blocked: boolean
  phase: 'before_fielding' | 'after_fielding' | null
  message: string
}

export function complianceGate(input: GateInput): GateResult {
  const { targetColumn, willMarkDelivered, client, override, submissions, rerunNumber, complianceRequiredOverride } = input
  // After-fielding gate: marking the final Delivered box.
  if (willMarkDelivered && afterFieldingRequired(client, override, rerunNumber, complianceRequiredOverride) && !afterFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'after_fielding',
      message:
        'This client requires an after-fielding compliance review (questions + results) before delivery, and it has not been approved yet.',
    }
  }
  // Before-fielding gate: advancing into Fielding or later.
  const targetIdx = STAGE_ORDER.indexOf(targetColumn)
  if (targetIdx >= FIELDING_IDX && beforeFieldingRequired(client, override, rerunNumber, complianceRequiredOverride) && !beforeFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'before_fielding',
      message:
        'This client requires the questionnaire to be approved by compliance before the survey is fielded, and it has not been approved yet.',
    }
  }
  return { blocked: false, phase: null, message: '' }
}

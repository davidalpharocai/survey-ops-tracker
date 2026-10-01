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
  /**
   * Where the study is NOW. Without it the before-fielding gate cannot tell
   * "this move starts the fielding" from "this study is already fielding and is
   * moving on", and it re-asks on every forward step — David, 2026-10-01:
   * "between fielding and data QA there is no compliance requirement. DE Shaw
   * keeps asking for compliance approval when I try to move from fielding to
   * data qa."
   *
   * OPTIONAL, AND ITS ABSENCE FAILS CLOSED. A caller that does not pass it gets
   * the old behaviour — blocked on any target at or past Fielding — because a
   * compliance gate that degrades into "allow" is worse than one that degrades
   * into "ask again". Every caller in the app passes it; the type keeps it
   * optional so an unported one cannot silently open the gate.
   */
  currentColumn?: BoardColumn | null
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
  const { targetColumn, currentColumn, willMarkDelivered, client, override, submissions, rerunNumber, complianceRequiredOverride } = input
  // After-fielding gate: marking the final Delivered box.
  if (willMarkDelivered && afterFieldingRequired(client, override, rerunNumber, complianceRequiredOverride) && !afterFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'after_fielding',
      message:
        'This client requires an after-fielding compliance review (questions + results) before delivery, and it has not been approved yet.',
    }
  }
  // Before-fielding gate: the move that STARTS the fielding.
  //
  // The test is on the step, not on the destination. `targetIdx >= FIELDING_IDX`
  // alone is wrong in one direction and right in the other, which is why it
  // survived so long:
  //   · right  — it catches a jump straight from Submitted to Data QA, which
  //              would otherwise field the study without ever naming Fielding.
  //   · wrong  — it also catches Fielding -> Data QA, where the study has
  //              ALREADY been fielded. Blocking there asks for approval after
  //              the thing the approval exists to prevent has happened, and
  //              stops the one person who could fix it from closing the study
  //              out. DE Shaw hit this on every forward move.
  // Requiring the step to CROSS the line keeps the first and drops the second.
  //
  // An unknown current column reads as -1, i.e. before fielding, so the gate
  // still fires — see `currentColumn`.
  const targetIdx = STAGE_ORDER.indexOf(targetColumn)
  const currentIdx = currentColumn ? STAGE_ORDER.indexOf(currentColumn) : -1
  const startsFielding = currentIdx < FIELDING_IDX && targetIdx >= FIELDING_IDX
  if (startsFielding && beforeFieldingRequired(client, override, rerunNumber, complianceRequiredOverride) && !beforeFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'before_fielding',
      message:
        'This client requires the questionnaire to be approved by compliance before the study is fielded, and it has not been approved yet.',
    }
  }
  return { blocked: false, phase: null, message: '' }
}

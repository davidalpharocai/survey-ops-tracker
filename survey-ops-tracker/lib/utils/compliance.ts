import { STAGE_ORDER, type BoardColumn } from './stage'

export interface ClientCompliance {
  compliance_before_fielding: boolean
  compliance_after_fielding: boolean
}
export interface SubmissionLite {
  phase: string
  status: string
}

export function beforeFieldingRequired(client: ClientCompliance | null, override: boolean | null): boolean {
  if (override === true) return true
  if (override === false) return false
  return !!client?.compliance_before_fielding
}
export function afterFieldingRequired(client: ClientCompliance | null, override: boolean | null): boolean {
  if (override === true) return true
  if (override === false) return false
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
}
export interface GateResult {
  blocked: boolean
  phase: 'before_fielding' | 'after_fielding' | null
  message: string
}

export function complianceGate(input: GateInput): GateResult {
  const { targetColumn, willMarkDelivered, client, override, submissions } = input
  // After-fielding gate: marking the final Delivered box.
  if (willMarkDelivered && afterFieldingRequired(client, override) && !afterFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'after_fielding',
      message:
        'This client requires an after-fielding compliance review (questions + results) before delivery, and it has not been approved yet.',
    }
  }
  // Before-fielding gate: advancing into Fielding or later.
  const targetIdx = STAGE_ORDER.indexOf(targetColumn)
  if (targetIdx >= FIELDING_IDX && beforeFieldingRequired(client, override) && !beforeFieldingMet(submissions)) {
    return {
      blocked: true,
      phase: 'before_fielding',
      message:
        'This client requires the questionnaire to be approved by compliance before the survey is fielded, and it has not been approved yet.',
    }
  }
  return { blocked: false, phase: null, message: '' }
}

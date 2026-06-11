/**
 * Derives who the project is waiting on from status, phase, blocked-by
 * override, stage checkboxes, and fielding progress.
 * Ported from the Google Sheets "Waiting On" formula.
 */
export type WaitingOnInput = {
  status: string
  phase: string
  blocked_by?: string | null
  stage_doc_programming: boolean
  stage_survey_programming: boolean
  stage_edwin_qa: boolean
  stage_fielding: boolean
  stage_data_qa: boolean
  stage_delivery: boolean
  n_target: number | null
  n_collected: number
}

export function deriveWaitingOn(p: WaitingOnInput): string {
  if (p.status === 'Closed') return '—'
  if (p.blocked_by === 'client') return 'Client'
  if (p.blocked_by === 'internal') return 'Us'
  if (p.status === 'Hold') return '—'
  if (p.phase === 'Scoping') return 'Us — scoping'
  if (!p.stage_doc_programming) return 'Us — doc programming'
  if (!p.stage_survey_programming) return 'Us — survey programming'
  if (!p.stage_edwin_qa) return 'Us — EdWin QA'
  if (!p.stage_fielding) return 'Us — launch'
  if (p.n_target != null && p.n_target > 0 && p.n_collected < p.n_target) {
    return 'Field — collecting'
  }
  if (!p.stage_data_qa) return 'Us — data QA'
  if (!p.stage_delivery) return 'Us — delivery'
  return '—'
}

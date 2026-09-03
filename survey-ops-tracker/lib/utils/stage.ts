export type BoardColumn =
  | 'Submitted'
  | 'Doc Programming'
  | 'Survey Programming'
  | 'EdWin QA'
  | 'Fielding'
  | 'Data QA'
  | 'Delivery'

export const STAGE_ORDER: BoardColumn[] = [
  'Submitted',
  'Doc Programming',
  'Survey Programming',
  'EdWin QA',
  'Fielding',
  'Data QA',
  'Delivery',
]

/** One-line hover descriptions for pipeline and scoping stages (used for title= tooltips). */
export const STAGE_DESCRIPTIONS: Record<string, string> = {
  // Pipeline stages
  'Submitted': 'Accepted into operations — work not started yet.',
  'Doc Programming': 'The questionnaire document is being programmed.',
  'Survey Programming': 'The survey is being built in the survey tool.',
  'EdWin QA': 'Internal QA pass in Edwin before fielding.',
  'Fielding': 'Live and collecting responses.',
  'Data QA': 'Cleaning and validating the collected data.',
  'Delivery': 'Preparing and sending the deliverable.',
  // Scoping (pre-sale) stages
  'New Inquiry': 'New pre-sale inquiry — scoping just started.',
  'Proposal Sent': 'A proposal has been sent to the client.',
  'Pricing Discussion': 'Pricing is being discussed with the client.',
  'Awaiting Approval': 'Waiting on client approval — approval moves the project into operations at Submitted.',
}

/** User-facing label for a board column. The final stage reads as "Delivered"
 * (the deliverable is sent) while the underlying enum value stays 'Delivery'. */
export function stageLabel(column: string): string {
  return column === 'Delivery' ? 'Delivered' : column
}

export type StageFields = {
  stage_doc_programming: boolean
  stage_survey_programming: boolean
  stage_edwin_qa: boolean
  stage_fielding: boolean
  stage_data_qa: boolean
  stage_delivery: boolean
}

export function deriveCurrentStage(fields: StageFields): BoardColumn {
  if (!fields.stage_doc_programming) return 'Submitted'
  if (!fields.stage_survey_programming) return 'Doc Programming'
  if (!fields.stage_edwin_qa) return 'Survey Programming'
  if (!fields.stage_fielding) return 'EdWin QA'
  if (!fields.stage_data_qa) return 'Fielding'
  if (!fields.stage_delivery) return 'Data QA'
  return 'Delivery'
}

/**
 * The stage flags for a project sitting in `column` — the exact inverse of
 * `deriveCurrentStage` above, and stage.test.ts asserts that round-trip for
 * every column.
 *
 * A flag means "this stage has been REACHED", so being in column X requires X's
 * own flag true and the next stage's flag false. Hence `>=`, not `>`.
 *
 * IT USED TO BE `>`, with a docstring claiming "the destination stage itself is
 * NOT checked (it becomes the new current stage)". That is the opposite of what
 * deriveCurrentStage, fifteen lines above, has always said — and the two were
 * never compared. Every column but Submitted came out one stage early: asking
 * for Fielding produced flags meaning EdWin QA.
 *
 * The damage was silent because callers write board_column EXPLICITLY as well,
 * so the row ended up self-contradictory rather than visibly wrong: the card sat
 * in Fielding while the stage spine read EdWin QA, and the next spine click
 * re-derived from the flags and pulled the card backwards. David reported it as
 * "when i move a survey back to fielding, it goes to EdwinQA instead". Five of
 * twenty-five open projects were in that state on 2026-09-02 (PR00388, PR00362,
 * PR00310, PR00311 and one more), via the board drag, useMoveProjectToColumn and
 * the connector's advance_project — all three route through here.
 *
 * `stage_delivery` was hardcoded false, which also contradicted
 * stageColumnsFor's markDelivered branch (writes.ts), where all six true IS
 * Delivery. Now consistent. Note this does NOT let a board drag deliver
 * something silently: the Delivery column is retired from the board (folded into
 * Data QA) and the drop handler runs complianceGate with
 * willMarkDelivered anyway.
 */
export function getCheckboxesForColumn(column: BoardColumn): StageFields {
  const idx = STAGE_ORDER.indexOf(column)
  return {
    stage_doc_programming: idx >= 1,
    stage_survey_programming: idx >= 2,
    stage_edwin_qa: idx >= 3,
    stage_fielding: idx >= 4,
    stage_data_qa: idx >= 5,
    stage_delivery: idx >= 6,
  }
}

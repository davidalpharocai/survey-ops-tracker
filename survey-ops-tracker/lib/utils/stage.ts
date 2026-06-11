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
 * When dragging a card to a column, auto-check all stages BEFORE it.
 * The destination stage itself is NOT checked (it becomes the new current stage).
 */
export function getCheckboxesForColumn(column: BoardColumn): StageFields {
  const idx = STAGE_ORDER.indexOf(column)
  return {
    stage_doc_programming: idx > 1,
    stage_survey_programming: idx > 2,
    stage_edwin_qa: idx > 3,
    stage_fielding: idx > 4,
    stage_data_qa: idx > 5,
    stage_delivery: false,
  }
}

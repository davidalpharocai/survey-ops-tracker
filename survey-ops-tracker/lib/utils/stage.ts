export type BoardColumn =
  | 'Study Questions Review'
  | 'Submitted'
  | 'Doc Programming'
  | 'Survey Programming'
  | 'EdWin QA'
  | 'Fielding'
  | 'Data QA'
  | 'Delivery'

export const STAGE_ORDER: BoardColumn[] = [
  'Study Questions Review',
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
  'Study Questions Review': 'The questionnaire is still going back and forth with the client. Approving it greenlights the study.',
  'Submitted': 'Questions approved and accepted into operations — work not started yet.',
  'Doc Programming': 'The questionnaire document is being programmed.',
  'Survey Programming': 'The study is being built in the survey tool.',
  'EdWin QA': 'Internal QA pass in Edwin before fielding.',
  'Fielding': 'Live and collecting responses.',
  'Data QA': 'Cleaning and validating the collected data.',
  'Delivery': 'Preparing and sending the deliverable.',
  // Scoping (pre-sale) stages
  'New Inquiry': 'New pre-sale inquiry — scoping just started.',
  'Proposal Sent': 'A proposal has been sent to the client.',
  'Pricing Discussion': 'Pricing is being discussed with the client.',
  'Awaiting Approval': 'Waiting on the client to approve the work commercially — approval moves the project into operations at Study Questions Review, where the questionnaire itself is agreed.',
}

/**
 * The user-facing label for a board column.
 *
 * THE ENUM VALUES ARE THE DATA. `public.board_column` (002) is a Postgres enum;
 * every project row stores one of these strings, and two live trigger functions
 * name them as SQL literals -- log_stage_entry (063) and
 * set_launch_date_on_fielding (072). Renaming a value in the database therefore
 * means a migration that also rebuilds both functions in the same transaction,
 * because the moment the value changes those literals stop casting and every
 * stage move fails. No display name is worth that.
 *
 * So the rename lives here. It is the same trade 'Delivery' has always made:
 * the stage reads as "Delivered", because that is what has happened to the
 * survey, while the stored value stays 'Delivery'. 'Survey Programming' now
 * reads as "Study Programming" for the same reason -- front-facing we say
 * Study; the column keeps its name.
 *
 * EVERY DISPLAY SITE ROUTES THROUGH HERE. What must NOT is a value: a filter's
 * <option value>, a drill-down query key, an MCP argument, a CSV the sheet
 * reads back. Those are the enum, and a label passed where a value belongs
 * matches nothing and does it silently.
 */
const STAGE_LABEL: Record<string, string> = {
  'Survey Programming': 'Study Programming',
  'Delivery': 'Delivered',
}

export function stageLabel(column: string): string {
  return STAGE_LABEL[column] ?? column
}

export type StageFields = {
  /**
   * OPTIONAL ON PURPOSE, and read with an explicit `=== false` below.
   *
   * Migrations are hand-applied here, so this column does not exist until David
   * runs 128, and ~117 read sites name their columns explicitly. A project read
   * before that lands arrives with this undefined — and undefined must mean
   * "past the gate", because the alternative is every one of them derives as
   * Study Questions Review and the entire board falls back a column on deploy.
   *
   * So: absent behaves exactly as this file behaved yesterday. Only an explicit
   * false — which nothing can produce until the column is really there — opens
   * the new rung.
   */
  stage_questions_approved?: boolean | null
  stage_doc_programming: boolean
  stage_survey_programming: boolean
  stage_edwin_qa: boolean
  stage_fielding: boolean
  stage_data_qa: boolean
  stage_delivery: boolean
}

export function deriveCurrentStage(fields: StageFields): BoardColumn {
  // `=== false`, never `!`. See the note on StageFields.stage_questions_approved:
  // undefined is "this database has not got the column yet", not "not approved".
  if (fields.stage_questions_approved === false) return 'Study Questions Review'
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
 * stageColumnsFor's markDelivered branch (writes.ts), where every flag true IS
 * Delivery. Now consistent — and that branch no longer keeps its own list of
 * flags at all, it calls this function, so migration 128's seventh flag could
 * not be forgotten there. Note this does NOT let a board drag deliver
 * something silently: the Delivery column is retired from the board (folded into
 * Data QA) and the drop handler runs complianceGate with
 * willMarkDelivered anyway.
 */
export function getCheckboxesForColumn(column: BoardColumn): StageFields & { stage_questions_approved: boolean } {
  const idx = STAGE_ORDER.indexOf(column)
  return {
    stage_questions_approved: idx >= 1,
    stage_doc_programming: idx >= 2,
    stage_survey_programming: idx >= 3,
    stage_edwin_qa: idx >= 4,
    stage_fielding: idx >= 5,
    stage_data_qa: idx >= 6,
    stage_delivery: idx >= 7,
  }
}

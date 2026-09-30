import { describe, it, expect } from 'vitest'
import {
  STAGE_ORDER,
  STAGE_DESCRIPTIONS,
  deriveCurrentStage,
  getCheckboxesForColumn,
  stageLabel,
  type BoardColumn,
  type StageFields,
} from './stage'

/**
 * THE INVARIANT THESE TWO FUNCTIONS EXIST TO SATISFY, and did not.
 *
 * `getCheckboxesForColumn(X)` answers "what should the stage flags be for a
 * project sitting in column X" (six of them until migration 128 added
 * stage_questions_approved, seven since). `deriveCurrentStage(flags)` answers "which
 * column do these flags mean". They are inverses, so composing them must be the
 * identity — and it was not, for six of the seven columns.
 *
 * The failure was one stage in every case: asking for Fielding produced flags
 * that meant EdWin QA. Every write path that used it therefore stored a project
 * whose board_column and stage flags contradicted each other — the board drag
 * (app/(app)/page.tsx), useMoveProjectToColumn, and the connector's
 * advance_project via stageColumnsFor. On 2026-09-02 five of twenty-five open
 * projects were in that state: PR00388 and PR00362 sitting in Fielding with
 * flags meaning EdWin QA, PR00310 and PR00311 in Doc Programming with flags
 * meaning Submitted.
 *
 * The cause is visible in the old docstring, which claimed "the destination
 * stage itself is NOT checked (it becomes the new current stage)".
 * deriveCurrentStage says the opposite: to BE in column X, X's own flag must be
 * true and the NEXT stage's flag false. Two readings of one boolean, written
 * fifteen lines apart, and nothing compared them until now.
 */
describe('getCheckboxesForColumn / deriveCurrentStage are inverses', () => {
  it.each(STAGE_ORDER)('round-trips %s', (column: BoardColumn) => {
    expect(deriveCurrentStage(getCheckboxesForColumn(column))).toBe(column)
  })

  // The regression David actually hit, named explicitly so it cannot come back
  // quietly: "when i move a survey back to fielding, it goes to EdwinQA instead".
  it('asking for Fielding does not produce EdWin QA', () => {
    const flags = getCheckboxesForColumn('Fielding')
    expect(deriveCurrentStage(flags)).toBe('Fielding')
    // Being IN Fielding means fielding is reached and Data QA is not.
    expect(flags.stage_fielding).toBe(true)
    expect(flags.stage_data_qa).toBe(false)
  })

  it('agrees with the delivered convention used by stageColumnsFor', () => {
    // writes.ts's markDelivered branch and deriveCurrentStage must not
    // disagree about what Delivery looks like. That branch no longer keeps its
    // own list of flags — it calls getCheckboxesForColumn — precisely because a
    // hand-written list could not gain migration 128's seventh flag, and a
    // delivered study missing it would derive as Study Questions Review.
    const allTrue: StageFields = {
      stage_questions_approved: true,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      stage_data_qa: true,
      stage_delivery: true,
    }
    expect(deriveCurrentStage(allTrue)).toBe('Delivery')
    expect(getCheckboxesForColumn('Delivery')).toEqual(allTrue)
  })

  // RENAMED WITH THE MEANING IT NOW HAS. Submitted used to be the floor of the
  // ladder, so it meant "nothing reached". Since migration 128 it sits one rung
  // up and means something specific and new: the client has approved the
  // questionnaire and no operational work has started. The distinction is the
  // entire point of the stage — it is what separates weeks of questionnaire
  // drafting from the cycle time of the work.
  it('Submitted means the questions are approved and nothing else has started', () => {
    expect(getCheckboxesForColumn('Submitted')).toEqual({
      stage_questions_approved: true,
      stage_doc_programming: false,
      stage_survey_programming: false,
      stage_edwin_qa: false,
      stage_fielding: false,
      stage_data_qa: false,
      stage_delivery: false,
    })
  })

  // Monotonic: a project cannot have reached a later stage without the earlier
  // ones. Guards against a future edit fixing one column and breaking the shape.
  it.each(STAGE_ORDER)('%s has no gaps in the flags it sets', (column: BoardColumn) => {
    const f = getCheckboxesForColumn(column)
    const seq = [
      f.stage_questions_approved,
      f.stage_doc_programming,
      f.stage_survey_programming,
      f.stage_edwin_qa,
      f.stage_fielding,
      f.stage_data_qa,
      f.stage_delivery,
    ]
    const firstFalse = seq.indexOf(false)
    if (firstFalse !== -1) expect(seq.slice(firstFalse).every(v => v === false)).toBe(true)
  })
})

/**
 * THE DEPLOY-BEFORE-MIGRATION CASE, which is not hypothetical here: migrations
 * are applied by hand in the Supabase SQL editor, so there is always a window
 * where this code is live and the column is not. ~117 read sites name their
 * columns explicitly, so in that window every project arrives with
 * stage_questions_approved undefined.
 *
 * If undefined were read as "not approved", the ladder's new floor would catch
 * every project in the database at once and the entire board would fall back a
 * column on deploy — roughly 400 studies, including delivered ones, reading as
 * though their questionnaire were still in draft.
 */
describe('a database that has not run migration 128 yet', () => {
  const legacy = {
    stage_doc_programming: true,
    stage_survey_programming: true,
    stage_edwin_qa: false,
    stage_fielding: false,
    stage_data_qa: false,
    stage_delivery: false,
  } as StageFields

  it('derives exactly what it derived before the stage existed', () => {
    expect(legacy.stage_questions_approved).toBeUndefined()
    expect(deriveCurrentStage(legacy)).toBe('Survey Programming')
  })

  it('reads a delivered study as Delivered, not as questions-in-draft', () => {
    const delivered = {
      stage_doc_programming: true, stage_survey_programming: true, stage_edwin_qa: true,
      stage_fielding: true, stage_data_qa: true, stage_delivery: true,
    } as StageFields
    expect(deriveCurrentStage(delivered)).toBe('Delivery')
  })

  // The other half of the same coin: an EXPLICIT false is the only thing that
  // opens the new rung, and nothing can produce one until the column is real.
  it('opens the new stage only on an explicit false', () => {
    expect(deriveCurrentStage({ ...legacy, stage_questions_approved: false })).toBe('Study Questions Review')
    expect(deriveCurrentStage({ ...legacy, stage_questions_approved: null })).toBe('Survey Programming')
    expect(deriveCurrentStage({ ...legacy, stage_questions_approved: true })).toBe('Survey Programming')
  })
})

/**
 * The display layer is where the survey->Study rename happens for a stage,
 * because the stage name is an ENUM VALUE in the database, not a string in this
 * repo -- see the note on stageLabel. These tests pin both halves of that: what
 * a person reads, and what is still stored.
 */
describe('stageLabel', () => {
  it('says Study Programming, and Delivered', () => {
    expect(stageLabel('Survey Programming')).toBe('Study Programming')
    expect(stageLabel('Delivery')).toBe('Delivered')
  })

  // The point of doing it here rather than in a migration: board_column keeps
  // its value, so the two trigger functions that name it as a SQL literal
  // (063 log_stage_entry, 072 set_launch_date_on_fielding) keep working.
  it('leaves the stored enum values alone', () => {
    expect(STAGE_ORDER).toContain('Survey Programming')
    expect(STAGE_ORDER).toContain('Delivery')
    expect(STAGE_ORDER as readonly string[]).not.toContain('Study Programming')
  })

  it('passes through anything it has no opinion about', () => {
    for (const s of ['Submitted', 'Doc Programming', 'EdWin QA', 'Fielding', 'Data QA', 'Study Questions Review']) {
      expect(stageLabel(s)).toBe(s)
    }
    // Insights buckets everything off-pipeline as 'Other' and renders it
    // through the same function.
    expect(stageLabel('Other')).toBe('Other')
  })

  // Every stage a person can see has to have a label AND a tooltip, or the
  // rename leaves a stage explaining itself in the old words.
  it('describes every stage without calling the study a survey', () => {
    for (const s of STAGE_ORDER) {
      expect(STAGE_DESCRIPTIONS[s], `no description for ${s}`).toBeTruthy()
    }
    expect(STAGE_DESCRIPTIONS['Survey Programming']).not.toMatch(/The survey/)
  })
})

import { describe, it, expect } from 'vitest'
import {
  STAGE_ORDER,
  deriveCurrentStage,
  getCheckboxesForColumn,
  type BoardColumn,
  type StageFields,
} from './stage'

/**
 * THE INVARIANT THESE TWO FUNCTIONS EXIST TO SATISFY, and did not.
 *
 * `getCheckboxesForColumn(X)` answers "what should the six stage flags be for a
 * project sitting in column X". `deriveCurrentStage(flags)` answers "which
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
    // writes.ts's markDelivered branch sets all six true, and
    // deriveCurrentStage reads all-true as Delivery. getCheckboxesForColumn
    // must not disagree with its own sibling about what Delivery looks like.
    const allTrue: StageFields = {
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

  it('Submitted means nothing has been reached yet', () => {
    expect(getCheckboxesForColumn('Submitted')).toEqual({
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

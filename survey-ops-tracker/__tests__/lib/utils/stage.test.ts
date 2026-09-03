import { describe, it, expect } from 'vitest'
import { deriveCurrentStage, getCheckboxesForColumn, STAGE_ORDER } from '@/lib/utils/stage'

const noStages = {
  stage_doc_programming: false,
  stage_survey_programming: false,
  stage_edwin_qa: false,
  stage_fielding: false,
  stage_data_qa: false,
  stage_delivery: false,
}

describe('STAGE_ORDER', () => {
  it('has 7 stages in correct order', () => {
    expect(STAGE_ORDER).toEqual([
      'Submitted', 'Doc Programming', 'Survey Programming',
      'EdWin QA', 'Fielding', 'Data QA', 'Delivery',
    ])
  })
})

describe('deriveCurrentStage', () => {
  it('returns Submitted when no stages checked', () => {
    expect(deriveCurrentStage(noStages)).toBe('Submitted')
  })
  it('returns Doc Programming when only doc checked', () => {
    expect(deriveCurrentStage({ ...noStages, stage_doc_programming: true }))
      .toBe('Doc Programming')
  })
  it('returns Survey Programming when doc + survey checked', () => {
    expect(deriveCurrentStage({ ...noStages, stage_doc_programming: true, stage_survey_programming: true }))
      .toBe('Survey Programming')
  })
  it('returns EdWin QA when first 3 checked', () => {
    expect(deriveCurrentStage({
      ...noStages,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
    })).toBe('EdWin QA')
  })
  it('returns Fielding when first 4 checked', () => {
    expect(deriveCurrentStage({
      ...noStages,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
    })).toBe('Fielding')
  })
  it('returns Data QA when first 5 checked', () => {
    expect(deriveCurrentStage({
      ...noStages,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      stage_data_qa: true,
    })).toBe('Data QA')
  })
  it('returns Delivery when all checked', () => {
    expect(deriveCurrentStage({
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      stage_data_qa: true,
      stage_delivery: true,
    })).toBe('Delivery')
  })
})

// THESE FOUR ASSERTIONS WERE REVERSED ON 2026-09-02, deliberately, because they
// asserted the bug.
//
// They encoded "the destination stage itself is NOT checked", taken from
// getCheckboxesForColumn's old docstring. The deriveCurrentStage block IN THIS
// SAME FILE asserts the opposite — "returns Fielding when first 4 checked", the
// fourth being stage_fielding — so the file contradicted itself and nobody ever
// composed the two halves. Composing them is now its own test
// (lib/utils/stage.test.ts): deriveCurrentStage(getCheckboxesForColumn(X)) must
// equal X, which failed for six of seven columns.
//
// Which half was right was settled by the live data, not by argument: 20 of 25
// open projects matched deriveCurrentStage, and the 5 that did not were exactly
// the rows written through getCheckboxesForColumn — self-contradictory rows
// sitting in one column with flags meaning the previous one. David hit it as
// "when i move a survey back to fielding, it goes to EdwinQA instead".
describe('getCheckboxesForColumn', () => {
  it('returns all false for Submitted', () => {
    const r = getCheckboxesForColumn('Submitted')
    expect(r.stage_doc_programming).toBe(false)
    expect(r.stage_survey_programming).toBe(false)
    expect(r.stage_delivery).toBe(false)
  })
  it('checks doc for Doc Programming — a flag means the stage is REACHED', () => {
    const r = getCheckboxesForColumn('Doc Programming')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(false)
  })
  it('checks doc + survey for Survey Programming', () => {
    const r = getCheckboxesForColumn('Survey Programming')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(true)
    expect(r.stage_edwin_qa).toBe(false)
  })
  it('checks Fielding itself, and not Data QA', () => {
    const r = getCheckboxesForColumn('Fielding')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(true)
    expect(r.stage_edwin_qa).toBe(true)
    expect(r.stage_fielding).toBe(true)
    expect(r.stage_data_qa).toBe(false)
    expect(r.stage_delivery).toBe(false)
  })
  it('checks all six for Delivery, matching stageColumnsFor(markDelivered)', () => {
    const r = getCheckboxesForColumn('Delivery')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(true)
    expect(r.stage_edwin_qa).toBe(true)
    expect(r.stage_fielding).toBe(true)
    expect(r.stage_data_qa).toBe(true)
    expect(r.stage_delivery).toBe(true)
  })
})

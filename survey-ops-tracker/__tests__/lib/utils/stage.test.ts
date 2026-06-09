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

describe('getCheckboxesForColumn', () => {
  it('returns all false for Submitted', () => {
    const r = getCheckboxesForColumn('Submitted')
    expect(r.stage_doc_programming).toBe(false)
    expect(r.stage_survey_programming).toBe(false)
    expect(r.stage_delivery).toBe(false)
  })
  it('returns all false for Doc Programming (no prior checkboxes)', () => {
    const r = getCheckboxesForColumn('Doc Programming')
    expect(r.stage_doc_programming).toBe(false)  // Doc Programming is the destination, not yet done
    expect(r.stage_survey_programming).toBe(false)
  })
  it('checks doc=true for Survey Programming (doc is prior stage)', () => {
    const r = getCheckboxesForColumn('Survey Programming')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(false)
  })
  it('checks all stages before Fielding (not Fielding itself)', () => {
    const r = getCheckboxesForColumn('Fielding')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(true)
    expect(r.stage_edwin_qa).toBe(true)
    expect(r.stage_fielding).toBe(false)
    expect(r.stage_data_qa).toBe(false)
    expect(r.stage_delivery).toBe(false)
  })
  it('checks all 5 before Delivery', () => {
    const r = getCheckboxesForColumn('Delivery')
    expect(r.stage_doc_programming).toBe(true)
    expect(r.stage_survey_programming).toBe(true)
    expect(r.stage_edwin_qa).toBe(true)
    expect(r.stage_fielding).toBe(true)
    expect(r.stage_data_qa).toBe(true)
    expect(r.stage_delivery).toBe(false)
  })
})

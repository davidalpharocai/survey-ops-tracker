import { describe, it, expect } from 'vitest'
import { deriveWaitingOn, type WaitingOnInput } from '@/lib/utils/waitingOn'

const base: WaitingOnInput = {
  status: 'Open',
  phase: 'Active',
  blocked_by: 'none',
  stage_doc_programming: false,
  stage_survey_programming: false,
  stage_edwin_qa: false,
  stage_fielding: false,
  stage_data_qa: false,
  stage_delivery: false,
  n_target: null,
  n_collected: 0,
}

describe('deriveWaitingOn', () => {
  it('returns — for Closed projects regardless of blocking', () => {
    expect(deriveWaitingOn({ ...base, status: 'Closed', blocked_by: 'client' })).toBe('—')
  })

  it('returns Client when blocked by client', () => {
    expect(deriveWaitingOn({ ...base, blocked_by: 'client' })).toBe('Client')
  })

  it('returns Us when blocked internally', () => {
    expect(deriveWaitingOn({ ...base, blocked_by: 'internal' })).toBe('Us')
  })

  it('blocked_by override beats Hold status', () => {
    expect(deriveWaitingOn({ ...base, status: 'Hold', blocked_by: 'client' })).toBe('Client')
  })

  it('returns — for projects on Hold without an override', () => {
    expect(deriveWaitingOn({ ...base, status: 'Hold' })).toBe('—')
  })

  it('returns Us — scoping during the Scoping phase', () => {
    expect(deriveWaitingOn({ ...base, phase: 'Scoping' })).toBe('Us — scoping')
  })

  it('walks the pipeline stages in order', () => {
    expect(deriveWaitingOn(base)).toBe('Us — doc programming')
    expect(deriveWaitingOn({ ...base, stage_doc_programming: true }))
      .toBe('Us — survey programming')
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
    })).toBe('Us — EdWin QA')
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
    })).toBe('Us — launch')
  })

  it('returns Field — collecting while fielding and under target', () => {
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      n_target: 1000,
      n_collected: 400,
    })).toBe('Field — collecting')
  })

  it('skips Field — collecting when target is met', () => {
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      n_target: 1000,
      n_collected: 1000,
    })).toBe('Us — data QA')
  })

  it('skips Field — collecting when there is no target', () => {
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      n_target: null,
      n_collected: 0,
    })).toBe('Us — data QA')
  })

  it('returns Us — delivery when only delivery remains', () => {
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      stage_data_qa: true,
    })).toBe('Us — delivery')
  })

  it('returns — when all stages are complete', () => {
    expect(deriveWaitingOn({
      ...base,
      stage_doc_programming: true,
      stage_survey_programming: true,
      stage_edwin_qa: true,
      stage_fielding: true,
      stage_data_qa: true,
      stage_delivery: true,
    })).toBe('—')
  })

  it('treats missing blocked_by (pre-migration) as not blocked', () => {
    expect(deriveWaitingOn({ ...base, blocked_by: undefined })).toBe('Us — doc programming')
  })
})

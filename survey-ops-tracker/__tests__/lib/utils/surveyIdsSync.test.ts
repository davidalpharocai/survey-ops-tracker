import { describe, it, expect } from 'vitest'
import { resolveSurveyIds } from '@/lib/utils/surveyIdsSync'

describe('resolveSurveyIds', () => {
  it('fills a blank field from the sheet', () => {
    expect(resolveSurveyIds(null, null, 'SV-1, SV-2')).toEqual({
      next: 'SV-1, SV-2',
      changed: true,
    })
    expect(resolveSurveyIds('', null, 'SV-1')).toEqual({ next: 'SV-1', changed: true })
  })

  it('does nothing when the sheet has no IDs', () => {
    expect(resolveSurveyIds('SV-9', 'SV-9', null)).toEqual({ next: 'SV-9', changed: false })
    expect(resolveSurveyIds('SV-9', 'SV-9', '  ')).toEqual({ next: 'SV-9', changed: false })
  })

  it('sheet wins when the sheet value changed since last sync', () => {
    expect(resolveSurveyIds('SV-1', 'SV-1', 'SV-1, SV-2')).toEqual({
      next: 'SV-1, SV-2',
      changed: true,
    })
  })

  it('overwrites a manual edit when the sheet changes', () => {
    // user manually set SV-99, then the sheet changed from SV-1 to SV-2
    expect(resolveSurveyIds('SV-99', 'SV-1', 'SV-2')).toEqual({
      next: 'SV-2',
      changed: true,
    })
  })

  it('preserves a manual edit when the sheet is unchanged', () => {
    // user manually set SV-99; sheet still says SV-1 (same as last sync)
    expect(resolveSurveyIds('SV-99', 'SV-1', 'SV-1')).toEqual({
      next: 'SV-99',
      changed: false,
    })
  })

  it('reports no change when sheet matches current', () => {
    expect(resolveSurveyIds('SV-1', null, 'SV-1')).toEqual({ next: 'SV-1', changed: false })
  })
})

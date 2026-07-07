import { describe, it, expect } from 'vitest'
import { pickProjectPatch, stageColumnsFor, diffSummary, PROJECT_WRITE_FIELDS } from './writes'

describe('pickProjectPatch', () => {
  it('keeps only whitelisted, present keys and rejects forbidden ones', () => {
    const { patch, rejected } = pickProjectPatch({ n_target: 900, actual_spend: 5, compliance_override: false, id: 'x' })
    expect(patch).toEqual({ n_target: 900 })
    expect(rejected.sort()).toEqual(['actual_spend', 'compliance_override', 'id'])
  })
  it('allows explicit null for a whitelisted field', () => {
    const { patch } = pickProjectPatch({ due_date: null })
    expect(patch).toEqual({ due_date: null })
  })
})

describe('stageColumnsFor', () => {
  it('mark_delivered sets all six stage booleans true + Delivery', () => {
    const s = stageColumnsFor({ markDelivered: true })
    expect(s.board_column).toBe('Delivery')
    expect(s.stage_delivery).toBe(true)
    expect(s.stage_fielding).toBe(true)
  })
})

describe('diffSummary', () => {
  it('reports only changed fields as [old,new]', () => {
    expect(diffSummary({ n_target: 500, due_date: '2026-07-20' }, { n_target: 900 }))
      .toEqual({ n_target: [500, 900] })
  })
})

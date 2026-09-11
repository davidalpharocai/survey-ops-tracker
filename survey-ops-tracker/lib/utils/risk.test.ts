import { describe, it, expect } from 'vitest'
import { riskOf, RISK_STYLE, type RiskInput, type RiskVerdict } from './risk'

/**
 * Guards the per-project risk flag. Like nFloor and overTarget, the tests that
 * matter most assert SILENCE: a flag that lights up on healthy work is a flag
 * the team learns to ignore, and then it is worse than not having one.
 */

const TODAY = '2026-09-11'
const base: RiskInput = { status: 'Open', phase: 'Active', board_column: 'Fielding', today: TODAY }
/* Accepts an input OR an already-computed verdict. The first version took only
   an input, and four call sites passed it a verdict — riskOf then judged an
   object with no recognisable fields and returned nothing, so the assertions
   failed against an empty list rather than against what the code actually does.
   A test helper that silently accepts the wrong shape is its own bug. */
const codes = (x: RiskInput | RiskVerdict) =>
  ('reasons' in x ? x : riskOf(x)).reasons.map(r => r.code).sort()

describe('riskOf: silence on work that is fine', () => {
  it('says nothing about a healthy fielding project', () => {
    const v = riskOf({ ...base, due_date: '2026-10-01', n_target: 100, n_collected: 40, actual_spend: 500 })
    expect(v.level).toBe('none')
    expect(v.reasons).toEqual([])
    expect(v.headline).toBeNull()
  })

  it('says nothing about a project with no dates and no numbers', () => {
    expect(riskOf({ ...base }).level).toBe('none')
  })

  it('does not call a DELIVERED project overdue — it cannot be rescued', () => {
    const v = riskOf({ ...base, board_column: 'Delivery', due_date: '2026-08-01' })
    expect(codes(v)).not.toContain('overdue')
  })

  it('goes quiet on closed or paused work', () => {
    expect(riskOf({ ...base, status: 'Closed', due_date: '2026-08-01' }).level).toBe('none')
    expect(riskOf({ ...base, phase: 'Hold', due_date: '2026-08-01' }).level).toBe('none')
  })

  it('does not call a SUBMITTED project behind pace — it has not started', () => {
    const v = riskOf({ ...base, board_column: 'Submitted', due_date: '2026-09-12', n_target: 100, n_collected: 0 })
    expect(codes(v)).not.toContain('fielding-behind')
  })
})

describe('riskOf: the delivery risks', () => {
  it('overdue is critical and counts the days', () => {
    const v = riskOf({ ...base, due_date: '2026-09-04' })
    expect(v.level).toBe('critical')
    expect(v.reasons[0].code).toBe('overdue')
    expect(v.reasons[0].label).toContain('7 days')
  })

  it('due within three days is a watch, not a crisis', () => {
    expect(riskOf({ ...base, due_date: '2026-09-13' }).level).toBe('watch')
    expect(riskOf({ ...base, due_date: '2026-09-11' }).reasons[0].label).toBe('Due today')
    // Four days out is not yet anything.
    expect(riskOf({ ...base, due_date: '2026-09-15' }).level).toBe('none')
  })

  it('behind pace only counts when the clock is nearly out', () => {
    const short = { ...base, n_target: 100, n_collected: 20 }
    expect(codes({ ...short, due_date: '2026-09-13' })).toContain('fielding-behind')
    // Plenty of time left: being short is normal mid-field, not a risk.
    expect(codes({ ...short, due_date: '2026-10-01' })).not.toContain('fielding-behind')
  })

  it('behind pace AND past the date is critical, not merely at risk', () => {
    const v = riskOf({ ...base, n_target: 100, n_collected: 20, due_date: '2026-09-09' })
    expect(v.level).toBe('critical')
    expect(codes(v)).toContain('fielding-behind')
  })
})

describe('riskOf: the money risks', () => {
  it('over budget only surfaces for a caller who may see the ceiling', () => {
    const over = { ...base, budget: 1000, actual_spend: 1500, due_date: '2026-10-01' }
    expect(codes({ ...over, includeBudget: true })).toContain('over-budget')
    // Without finance access the reason is ABSENT, and the level drops with it —
    // you cannot act on a risk whose evidence you are not allowed to see.
    expect(codes({ ...over, includeBudget: false })).not.toContain('over-budget')
    expect(riskOf({ ...over, includeBudget: false }).level).toBe('none')
  })

  it('flags over-delivery as a margin watch while spend can still be prevented', () => {
    const v = riskOf({ ...base, n_target: 50, n_internal_target: 60, n_collected: 90, due_date: '2026-10-01' })
    expect(codes(v)).toContain('over-target')
    expect(v.level).toBe('watch')
  })

  it('flags a project collecting N with no cost recorded', () => {
    // 143 PS projects sat exactly like this until the 2026-09-11 import; every
    // margin number that included them read as pure profit.
    const v = riskOf({ ...base, n_target: 500, n_collected: 200, actual_spend: 0, due_date: '2026-10-01' })
    expect(codes(v)).toContain('no-cost-recorded')
  })

  it('does not flag missing cost before anything has been collected', () => {
    expect(codes({ ...base, n_target: 500, n_collected: 0, actual_spend: 0 })).not.toContain('no-cost-recorded')
  })
})

describe('riskOf: the verdict', () => {
  it('takes the WORST reason as the level and the headline', () => {
    const v = riskOf({
      ...base, due_date: '2026-09-04', n_target: 100, n_collected: 10,
      budget: 100, actual_spend: 900, includeBudget: true,
    })
    expect(v.level).toBe('critical')
    expect(v.reasons.length).toBeGreaterThan(2)
    expect(v.headline).toContain('past its due date')
  })

  it('keeps every reason, because the captain needs to know WHICH thing to fix', () => {
    const v = riskOf({
      ...base, due_date: '2026-09-12', n_target: 100, n_collected: 10,
      budget: 100, actual_spend: 900, includeBudget: true,
    })
    expect(codes(v)).toEqual(['due-soon', 'fielding-behind', 'over-budget'])
  })

  it('has a style for every level it can return', () => {
    for (const lvl of ['watch', 'at-risk', 'critical'] as const) {
      expect(RISK_STYLE[lvl].label).toBeTruthy()
      expect(RISK_STYLE[lvl].className).toContain('border')
    }
  })
})

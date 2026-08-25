import { describe, it, expect } from 'vitest'
import { auditLabel, formatAuditValue, actorName, isRestrictedAuditField } from './auditFormat'

describe('auditFormat', () => {
  it('labels known fields and falls back to the raw key', () => {
    expect(auditLabel('due_date')).toBe('Due Date')
    expect(auditLabel('captain')).toBe('Captain')
    expect(auditLabel('mystery_field')).toBe('mystery_field')
  })

  it('formats booleans, money, dates, and blanks', () => {
    expect(formatAuditValue('longitudinal', 'true')).toBe('Yes')
    expect(formatAuditValue('longitudinal', 'false')).toBe('No')
    expect(formatAuditValue('budget', '15000')).toBe('$15,000')
    expect(formatAuditValue('due_date', '2026-07-15')).toBe('Jul 15, 2026')
    expect(formatAuditValue('n_collected', null)).toBe('—')
    expect(formatAuditValue('n_collected', '')).toBe('—')
    expect(formatAuditValue('n_collected', '180')).toBe('180')
  })

  it('truncates very long values', () => {
    expect(formatAuditValue('latest_next_steps', 'x'.repeat(100))).toHaveLength(81)
  })

  it('shows the email prefix as the actor, keeping system as-is', () => {
    expect(actorName('david@alpharoc.ai')).toBe('david')
    expect(actorName('system')).toBe('system')
  })
})

describe('isRestrictedAuditField', () => {
  it('restricts the budget ceiling', () => {
    expect(isRestrictedAuditField('budget')).toBe(true)
  })

  it('leaves actual_spend alone — cost to run is public', () => {
    expect(isRestrictedAuditField('actual_spend')).toBe(false)
  })

  it('restricts every price field 082 writes, by prefix', () => {
    // The four real trigger names, plus a fifth that does not exist yet: the
    // prefix match is the point, so a name added in SQL is covered on day one.
    expect(isRestrictedAuditField('price_per_n_set')).toBe(true)
    expect(isRestrictedAuditField('price_per_n_changed')).toBe(true)
    expect(isRestrictedAuditField('segment_price_set')).toBe(true)
    expect(isRestrictedAuditField('segment_price_changed')).toBe(true)
    expect(isRestrictedAuditField('price_per_n_cleared')).toBe(true)
  })

  it('lets ordinary ops fields through', () => {
    expect(isRestrictedAuditField('n_target')).toBe(false)
    expect(isRestrictedAuditField('due_date')).toBe(false)
    expect(isRestrictedAuditField('supplier_changed')).toBe(false)
    expect(isRestrictedAuditField('(created)')).toBe(false)
  })

  it('anchors the prefix so a lookalike suffix is not caught', () => {
    // Only a field that STARTS with the prefix is money; 'client_price_per_n_note'
    // would be someone's free text, not a rate.
    expect(isRestrictedAuditField('client_price_per_n_note')).toBe(false)
    expect(isRestrictedAuditField('budget_note')).toBe(false)
  })
})

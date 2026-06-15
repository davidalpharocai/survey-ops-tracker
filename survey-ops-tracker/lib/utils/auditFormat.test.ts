import { describe, it, expect } from 'vitest'
import { auditLabel, formatAuditValue, actorName } from './auditFormat'

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

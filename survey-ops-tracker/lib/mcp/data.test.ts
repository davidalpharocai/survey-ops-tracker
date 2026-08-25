import { describe, it, expect } from 'vitest'
import {
  sanitizeQuery, decodeSurveyId, isActiveOperational,
  isRestrictedMoneyField, redactRestrictedMoney, slimProject,
  redactFutureDefaults, restrictedAuditNote,
} from './data'
// The connector's money gate spans three modules (reads here, the report layer,
// the write whitelist) plus the telemetry row every tool call writes. They are
// tested together in this one file because the gate only holds if all four
// agree — a leak on any one path is the same leak.
import {
  REPORT_FIELD_KEYS, DEFAULT_REPORT_FIELDS,
  reportFieldsFor, reportFieldKeysFor, defaultReportFieldsFor,
  projectRow, aggregate,
} from './reports'
import { alignNRangePatch, PROJECT_WRITE_FIELDS, UNDOABLE_FIELDS } from './writes'
import { isRestrictedAuditField } from '@/lib/utils/auditFormat'
import { scrubDetail } from './telemetry'

describe('sanitizeQuery', () => {
  it('strips PostgREST-reserved and escapes LIKE wildcards', () => {
    expect(sanitizeQuery('acme, (test) 50%_x')).toBe('acme test 50\\%\\_x')
  })
  it('caps length at 100', () => {
    expect(sanitizeQuery('a'.repeat(500)).length).toBeLessThanOrEqual(100)
  })
})

describe('decodeSurveyId', () => {
  const initials = ['AL', 'SR', 'JC']
  it('parses owner + abbreviation + date + region', () => {
    expect(decodeSurveyId('ALBNFOF20260529UK', initials)).toEqual({
      owner: 'AL', abbreviation: 'BNFOF', date: '2026-05-29', region: 'UK', note: null,
    })
  })
  it('handles no region and unknown owner', () => {
    expect(decodeSurveyId('SRACME20260601', initials)).toEqual({
      owner: 'SR', abbreviation: 'ACME', date: '2026-06-01', region: null, note: null,
    })
    const r = decodeSurveyId('ZZACME20260601', initials)
    expect(r?.owner).toBeNull()
    expect(r?.abbreviation).toBe('ZZACME')
    expect(r?.note).toBe('owner initials not recognized')
  })
  it('parses abbreviations containing digits', () => {
    expect(decodeSurveyId('ALB2B20260529US', ['AL'])).toEqual({
      owner: 'AL', abbreviation: 'B2B', date: '2026-05-29', region: 'US', note: null,
    })
  })
  it('returns null when no date anchor', () => {
    expect(decodeSurveyId('NODATEHERE', initials)).toBeNull()
  })
})

describe('isActiveOperational', () => {
  it('accepts an in-flight Open/Active project', () => {
    expect(isActiveOperational({ status: 'Open', phase: 'Active', board_column: 'Fielding' })).toBe(true)
  })
  it('rejects Closed, On-Hold (Hold), and pre-sale Scoping', () => {
    expect(isActiveOperational({ status: 'Closed', phase: 'Active', board_column: 'Fielding' })).toBe(false)
    expect(isActiveOperational({ status: 'Hold', phase: 'Active', board_column: 'Fielding' })).toBe(false)
    expect(isActiveOperational({ status: 'Open', phase: 'Scoping', board_column: 'Submitted' })).toBe(false)
  })
  it('rejects a delivered project even while status is still Open', () => {
    expect(isActiveOperational({ status: 'Open', phase: 'Active', board_column: 'Delivery' })).toBe(false)
  })
})

describe('restricted money (connector output)', () => {
  it('restricts the cost ceiling and the revenue side, not the cost to run', () => {
    // Restricted: the ceiling, and everything 082 adds on the revenue side.
    expect(isRestrictedMoneyField('budget')).toBe(true)
    expect(isRestrictedMoneyField('price_per_n')).toBe(true)
    expect(isRestrictedMoneyField('client_price_per_n')).toBe(true)
    expect(isRestrictedMoneyField('contract_value_min')).toBe(true)
    expect(isRestrictedMoneyField('margin_pct')).toBe(true)
    // Public: what it costs us to run the work.
    expect(isRestrictedMoneyField('actual_spend')).toBe(false)
    expect(isRestrictedMoneyField('cpi')).toBe(false)
    expect(isRestrictedMoneyField('bid')).toBe(false)
    // And no false positives on ordinary columns.
    expect(isRestrictedMoneyField('n_target')).toBe(false)
    expect(isRestrictedMoneyField('project_name')).toBe(false)
    expect(isRestrictedMoneyField('deliver_date')).toBe(false)
  })

  it('DELETES a restricted key rather than nulling it', () => {
    const out = redactRestrictedMoney({ project_code: 'PR00123', budget: 5000, actual_spend: 4000 }, false)
    // A null budget would read to the model as "no budget set" — a different,
    // false claim. The key has to be absent.
    expect('budget' in out).toBe(false)
    expect(out).toEqual({ project_code: 'PR00123', actual_spend: 4000 })
  })

  it('passes the row through untouched for a capability holder', () => {
    const row = { project_code: 'PR00123', budget: 5000, actual_spend: 4000 }
    expect(redactRestrictedMoney(row, true)).toEqual(row)
  })

  it('slimProject fails closed — no flag means no budget, on both shapes', () => {
    const open = { status: 'Open', project_code: 'PR1', budget: 100, actual_spend: 40, created_at: 'x' }
    expect('budget' in slimProject(open)).toBe(false)
    expect(slimProject(open, true).budget).toBe(100)
    // Archived projects take the hand-written slim branch — same rule there.
    const closed = { status: 'Closed', project_code: 'PR2', budget: 200, actual_spend: 150 }
    expect('budget' in slimProject(closed)).toBe(false)
    expect(slimProject(closed, true).budget).toBe(200)
  })

  it('slimProject still strips the noise fields and keeps the N range', () => {
    const slim = slimProject({ status: 'Open', n_target: 1000, n_target_max: 1200, created_at: 'x', updated_at: 'y' }, true)
    expect(slim.n_target).toBe(1000)
    expect(slim.n_target_max).toBe(1200)
    expect('created_at' in slim).toBe(false)
  })
})

describe('restricted audit fields (get_change_history / undo_last_change)', () => {
  it('drops the audit rows whose VALUES are restricted money', () => {
    // project_audit rows carry BOTH values as text, so a history read is the
    // widest door onto a restricted number. The connector shares this predicate
    // with the app's audit feeds so both hide the same rows.
    expect(isRestrictedAuditField('budget')).toBe(true)
    expect(isRestrictedAuditField('price_per_n_changed')).toBe(true)
    expect(isRestrictedAuditField('segment_price_changed')).toBe(true)
    // Cost-to-run audit rows stay public, and no ordinary field is caught by
    // accident (priority starts with "pri", not "price").
    expect(isRestrictedAuditField('actual_spend')).toBe(false)
    expect(isRestrictedAuditField('priority')).toBe(false)
    expect(isRestrictedAuditField('blast_added')).toBe(false)
    expect(isRestrictedAuditField('supplier_changed')).toBe(false)
    expect(isRestrictedAuditField('n_target_max')).toBe(false)
  })

  it('names what was withheld and forbids the "unchanged" reading', () => {
    const note = restrictedAuditNote(['price_per_n', 'budget'])
    expect(note).toContain('budget, price_per_n')   // sorted, so the note is stable
    expect(note).toMatch(/did not change/)
  })
})

describe('redactFutureDefaults (rerun series blob)', () => {
  it('drops the budget key a next wave would inherit', () => {
    const fd = { n_target: 500, audience: 'Gen pop', budget: 12000 }
    expect(redactFutureDefaults(fd, false)).toEqual({ n_target: 500, audience: 'Gen pop' })
    expect(redactFutureDefaults(fd, true)).toEqual(fd)
  })
  it('treats a non-object jsonb as empty rather than passing it through unread', () => {
    expect(redactFutureDefaults(null, false)).toEqual({})
    expect(redactFutureDefaults('nope', true)).toEqual({})
    expect(redactFutureDefaults([1, 2], false)).toEqual({})
  })
})

describe('report field gating (survey_report / ops_metrics)', () => {
  it('budget is the only restricted report column, and it is declared once', () => {
    const holder = reportFieldKeysFor(true)
    const analyst = reportFieldKeysFor(false)
    expect(holder).toEqual(REPORT_FIELD_KEYS)
    expect(holder.filter(k => !analyst.includes(k))).toEqual(['budget'])
    // actual_spend is what a project COSTS TO RUN — public on purpose.
    expect(analyst).toContain('actual_spend')
  })

  it('advertises only the fields it can actually deliver', () => {
    // A model told 'budget' is available keeps asking for a column it can never get.
    expect(reportFieldKeysFor(false)).not.toContain('budget')
    expect(reportFieldsFor(false).some(f => f.restricted)).toBe(false)
    expect(defaultReportFieldsFor(false)).toEqual(DEFAULT_REPORT_FIELDS)
  })

  it('projectRow cannot resolve a restricted key against a gated field list', () => {
    const row = { project_code: 'PR00123', budget: 6000, actual_spend: 4000 }
    const out = projectRow(row, ['project_code', 'budget', 'actual_spend'], reportFieldsFor(false))
    expect(out).toEqual({ 'Project ID': 'PR00123', 'Actual Spend': 4000 })
    expect(projectRow(row, ['budget'], reportFieldsFor(true))).toEqual({ Budget: 6000 })
  })

  it('the aggregate OMITS the budget three rather than zeroing them', () => {
    const rows = [{ project_type: 'PS', n_target: 100, n_collected: 90, budget: 5000, actual_spend: 6000 }]
    const gated = aggregate(rows, false)
    // A budget of 0 / over_budget of 0 would read as "nothing over budget",
    // which is a false claim, not a missing one.
    expect('budget' in gated).toBe(false)
    expect('over_budget' in gated).toBe(false)
    expect('budget_used_pct' in gated).toBe(false)
    expect(gated.actual_spend).toBe(6000)
    const full = aggregate(rows, true)
    expect(full.budget).toBe(5000)
    expect(full.over_budget).toBe(1)
    expect(full.budget_used_pct).toBe(120)
  })
})

describe('N range writes (update_project / update_segment)', () => {
  it('both ends are writable and undoable', () => {
    // Without n_target_max the connector could only ever write the range's
    // floor, and 078's trigger raises the moment that floor passes the ceiling.
    expect(PROJECT_WRITE_FIELDS).toContain('n_target_max')
    expect(UNDOABLE_FIELDS.has('n_target_max')).toBe(true)
  })

  it('widening past the stored max pulls the max along', () => {
    const before = { n_target: 1000, n_target_max: 1200 }
    expect(alignNRangePatch(before, { n_target: 2000 })).toEqual({ n_target: 2000, n_target_max: 2000 })
  })

  it('lowering the max below the stored min pulls the min along', () => {
    const before = { n_target: 1000, n_target_max: 1200 }
    expect(alignNRangePatch(before, { n_target_max: 800 })).toEqual({ n_target: 800, n_target_max: 800 })
  })

  it('leaves a patch alone when the range stays consistent', () => {
    const before = { n_target: 1000, n_target_max: 1200 }
    expect(alignNRangePatch(before, { n_target: 1100 })).toEqual({ n_target: 1100 })
    expect(alignNRangePatch(before, { n_target_max: 1500 })).toEqual({ n_target_max: 1500 })
    expect(alignNRangePatch(before, { due_date: '2026-09-01' })).toEqual({ due_date: '2026-09-01' })
  })

  it('does not touch a pair the caller sent whole, or one with a null end', () => {
    // Both ends given → the caller owns it, and the trigger can still refuse a
    // genuinely transposed pair. A null end is nothing to invert.
    const both = { n_target: 2000, n_target_max: 1000 }
    expect(alignNRangePatch({ n_target: 1, n_target_max: 2 }, both)).toEqual(both)
    expect(alignNRangePatch({ n_target: 1000, n_target_max: null }, { n_target: 2000 })).toEqual({ n_target: 2000 })
    expect(alignNRangePatch({ n_target: 1000, n_target_max: 1200 }, { n_target: null })).toEqual({ n_target: null })
  })
})

describe('scrubDetail (mcp_tool_calls.detail)', () => {
  it('strips restricted values at any depth, whoever made the call', () => {
    // migration 045 makes mcp_tool_calls analyst-readable, so no caller's
    // capability makes it safe to persist a ceiling here.
    expect(scrubDetail({ changed: { budget: [6000, 8000], due_date: ['a', 'b'] } }))
      .toEqual({ changed: { due_date: ['a', 'b'] } })
    expect(scrubDetail({ created: { project_code: 'PR1' }, extras: { budget: 5000, audience: 'Gen pop' } }))
      .toEqual({ created: { project_code: 'PR1' }, extras: { audience: 'Gen pop' } })
  })

  it('keeps field NAMES — the name is not the number', () => {
    expect(scrubDetail({ undo: { fields: ['budget', 'due_date'] } }))
      .toEqual({ undo: { fields: ['budget', 'due_date'] } })
  })

  it('passes scalars and public detail through untouched', () => {
    expect(scrubDetail({ series_id: 'x', defaults: { n_target: 500 } }))
      .toEqual({ series_id: 'x', defaults: { n_target: 500 } })
    expect(scrubDetail(undefined)).toBeUndefined()
    expect(scrubDetail('text')).toBe('text')
  })
})

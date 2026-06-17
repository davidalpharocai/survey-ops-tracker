import { describe, it, expect } from 'vitest'
import {
  beforeFieldingRequired, afterFieldingRequired,
  beforeFieldingMet, afterFieldingMet,
  complianceGate, type ClientCompliance, type SubmissionLite,
} from './compliance'

const client = (o: Partial<ClientCompliance> = {}): ClientCompliance => ({
  compliance_before_fielding: false, compliance_after_fielding: false, ...o,
})
const sub = (phase: string, status: string): SubmissionLite => ({ phase, status })

describe('compliance requirement', () => {
  it('uses client flags when override is null', () => {
    expect(beforeFieldingRequired(client({ compliance_before_fielding: true }), null)).toBe(true)
    expect(afterFieldingRequired(client({ compliance_after_fielding: true }), null)).toBe(true)
    expect(beforeFieldingRequired(client(), null)).toBe(false)
  })
  it('override=false skips compliance even if the client requires it', () => {
    expect(beforeFieldingRequired(client({ compliance_before_fielding: true }), false)).toBe(false)
    expect(afterFieldingRequired(client({ compliance_after_fielding: true }), false)).toBe(false)
  })
  it('override=true forces both even if the client requires neither', () => {
    expect(beforeFieldingRequired(client(), true)).toBe(true)
    expect(afterFieldingRequired(client(), true)).toBe(true)
  })
  it('a missing client (null) means no requirement', () => {
    expect(beforeFieldingRequired(null, null)).toBe(false)
    expect(afterFieldingRequired(null, null)).toBe(false)
  })
})

describe('requirement met', () => {
  it('met only when an approved submission of that phase exists', () => {
    expect(beforeFieldingMet([sub('before_fielding', 'approved')])).toBe(true)
    expect(beforeFieldingMet([sub('before_fielding', 'pending_review')])).toBe(false)
    expect(beforeFieldingMet([sub('after_fielding', 'approved')])).toBe(false)
    expect(afterFieldingMet([sub('after_fielding', 'approved')])).toBe(true)
    expect(afterFieldingMet([])).toBe(false)
  })
})

describe('complianceGate', () => {
  const reqBoth = client({ compliance_before_fielding: true, compliance_after_fielding: true })
  it('blocks advancing to Fielding when before-fielding required and not met', () => {
    const g = complianceGate({ targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [] })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })
  it('allows Fielding once before-fielding is approved', () => {
    const g = complianceGate({ targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [sub('before_fielding', 'approved')] })
    expect(g.blocked).toBe(false)
  })
  it('blocks marking Delivered when after-fielding required and not met', () => {
    const g = complianceGate({ targetColumn: 'Delivery', willMarkDelivered: true, client: reqBoth, override: null, submissions: [sub('before_fielding', 'approved')] })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('after_fielding')
  })
  it('does not gate stages before Fielding', () => {
    const g = complianceGate({ targetColumn: 'Doc Programming', willMarkDelivered: false, client: reqBoth, override: null, submissions: [] })
    expect(g.blocked).toBe(false)
  })
  it('never blocks when nothing is required', () => {
    const g = complianceGate({ targetColumn: 'Delivery', willMarkDelivered: true, client: client(), override: null, submissions: [] })
    expect(g.blocked).toBe(false)
  })
})

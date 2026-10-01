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

describe('rerun-wave compliance waiver', () => {
  const strict = client({ compliance_before_fielding: true, compliance_after_fielding: true })

  it('waives a strict client on a rerun wave (rerunNumber >= 2) with no force-required override', () => {
    expect(beforeFieldingRequired(strict, null, 2, null)).toBe(false)
    expect(afterFieldingRequired(strict, null, 2, null)).toBe(false)
  })
  it('per-WAVE requiredOverride:true forces it back on for a rerun wave', () => {
    expect(beforeFieldingRequired(strict, null, 2, true)).toBe(true)
    expect(afterFieldingRequired(strict, null, 2, true)).toBe(true)
  })
  it('per-project override:true forces it back on for a rerun wave (wins over the waiver)', () => {
    expect(beforeFieldingRequired(strict, true, 2, null)).toBe(true)
    expect(afterFieldingRequired(strict, true, 2, null)).toBe(true)
  })
  it('rerunNumber 1 (or absent) is unaffected — still blocks a strict client', () => {
    expect(beforeFieldingRequired(strict, null, 1, null)).toBe(true)
    expect(afterFieldingRequired(strict, null, 1, null)).toBe(true)
    expect(beforeFieldingRequired(strict, null, undefined, null)).toBe(true)
    expect(afterFieldingRequired(strict, null, undefined, null)).toBe(true)
  })
  it('override:false always skips, on any wave, regardless of requiredOverride', () => {
    expect(beforeFieldingRequired(strict, false, 1, true)).toBe(false)
    expect(afterFieldingRequired(strict, false, 1, true)).toBe(false)
    expect(beforeFieldingRequired(strict, false, 2, true)).toBe(false)
    expect(afterFieldingRequired(strict, false, 2, true)).toBe(false)
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
  it('waives the gate on a rerun wave even for a strict client with no approval', () => {
    const g = complianceGate({
      targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [], rerunNumber: 2,
    })
    expect(g.blocked).toBe(false)
  })
  it('per-wave complianceRequiredOverride forces the gate back on for a rerun wave', () => {
    const g = complianceGate({
      targetColumn: 'Fielding', willMarkDelivered: false, client: reqBoth, override: null, submissions: [],
      rerunNumber: 2, complianceRequiredOverride: true,
    })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })
})

/**
 * The before-fielding gate blocks the STEP that starts the fielding, not every
 * step after it.
 *
 * David, 2026-10-01: "between fielding and data QA there is no compliance
 * requirement. after fielding = pre delivery. DE shaw keeps asking for
 * compliance approval when i try to move from fielding to data qa."
 *
 * The old test was `targetIdx >= FIELDING_IDX`, which is right about a jump
 * that skips Fielding and wrong about every move made after fielding has
 * already begun. DE Shaw is flagged before AND after, so PR00466 tripped it on
 * each forward step — asking for approval to prevent something that had already
 * happened, and stopping the only person who could close the study out.
 *
 * Both halves are pinned here, because fixing one by breaking the other is the
 * obvious way to get this wrong.
 */
describe('complianceGate: before-fielding fires on the crossing, not the destination', () => {
  const reqBoth = client({ compliance_before_fielding: true, compliance_after_fielding: true })
  const strict = (o: Partial<Parameters<typeof complianceGate>[0]>) =>
    complianceGate({
      willMarkDelivered: false, client: reqBoth, override: null, submissions: [],
      targetColumn: 'Data QA', ...o,
    })

  // The reported bug.
  it('does not block Fielding -> Data QA, because the study is already fielding', () => {
    expect(strict({ currentColumn: 'Fielding', targetColumn: 'Data QA' }).blocked).toBe(false)
  })

  it('does not block any later forward step either', () => {
    expect(strict({ currentColumn: 'Data QA', targetColumn: 'Delivery' }).blocked).toBe(false)
  })

  // The reason the old rule was written the way it was. Keep it.
  it('still blocks a jump that skips Fielding entirely', () => {
    const g = strict({ currentColumn: 'Submitted', targetColumn: 'Data QA' })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })

  it('still blocks the move that actually starts the fielding', () => {
    const g = strict({ currentColumn: 'Doc Programming', targetColumn: 'Fielding' })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })

  // Sending a study back does not re-ask: it has already been fielded, and the
  // gate exists to stop that happening unapproved, not to punish it afterwards.
  it('does not block a move backwards from Data QA to Fielding', () => {
    expect(strict({ currentColumn: 'Data QA', targetColumn: 'Fielding' }).blocked).toBe(false)
  })

  // A gate that degrades into "allow" is worse than one that degrades into
  // "ask again", so an unported caller keeps the old behaviour.
  it('still blocks when the caller does not say where the study is', () => {
    const g = strict({ currentColumn: undefined, targetColumn: 'Data QA' })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('before_fielding')
  })

  // "after fielding = pre delivery": relaxing the mid-pipeline gate must not
  // touch the one that guards delivery. DE Shaw requires both, and this is the
  // one that still has work to do.
  it('still blocks delivery on the after-fielding review, with no before-fielding approval in sight', () => {
    const g = strict({ currentColumn: 'Data QA', targetColumn: 'Delivery', willMarkDelivered: true })
    expect(g.blocked).toBe(true)
    expect(g.phase).toBe('after_fielding')
  })

  it('lets a fielded study through to delivery once the after-fielding review is approved', () => {
    const g = strict({
      currentColumn: 'Data QA', targetColumn: 'Delivery', willMarkDelivered: true,
      submissions: [sub('after_fielding', 'approved')],
    })
    expect(g.blocked).toBe(false)
  })
})

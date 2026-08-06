import { describe, it, expect } from 'vitest'
import { occamOnboardingGate, type OccamGateInput } from './occam'

const input = (o: Partial<OccamGateInput> = {}): OccamGateInput => ({
  willMarkDelivered: true,
  requestedByContactId: 'contact-1',
  contactOccamInvited: false,
  ...o,
})

describe('occamOnboardingGate', () => {
  it('blocks the first delivery for a not-yet-invited requested-by contact', () => {
    const r = occamOnboardingGate(input())
    expect(r.blocked).toBe(true)
    expect(r.message).toMatch(/Occam/i)
  })

  it('does not gate anything but the deliver transition', () => {
    expect(occamOnboardingGate(input({ willMarkDelivered: false })).blocked).toBe(false)
  })

  it('does not gate when the contact is already invited', () => {
    expect(occamOnboardingGate(input({ contactOccamInvited: true })).blocked).toBe(false)
  })

  it('does not gate when there is no requested-by contact to onboard', () => {
    expect(occamOnboardingGate(input({ requestedByContactId: null })).blocked).toBe(false)
  })
})

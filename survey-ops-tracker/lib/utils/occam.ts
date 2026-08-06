// Occam onboarding gate: before we DELIVER data, the external client contact who
// requested the survey (the project's "requested by") must have an Occam account —
// they need the welcome email + a sign-in to view the results. We prompt the internal
// user to confirm the invite was sent the FIRST time we deliver to a given contact,
// tracked by client_contacts.occam_invited so we never re-nag once confirmed.
//
// Pure + side-effect-free (mirrors complianceGate) so the app hook and the connector
// share one definition and it's unit-testable.

export interface OccamGateInput {
  /** True only on the transition that marks the project delivered. */
  willMarkDelivered: boolean
  /** The project's requested-by contact id, or null if none is set. */
  requestedByContactId: string | null
  /** Whether that contact has already been confirmed as invited to Occam. */
  contactOccamInvited: boolean
}

export interface OccamGateResult {
  blocked: boolean
  message: string
}

export function occamOnboardingGate(input: OccamGateInput): OccamGateResult {
  // Only gate the actual delivery transition.
  if (!input.willMarkDelivered) return { blocked: false, message: '' }
  // No requested-by contact recorded → no external user to onboard; don't gate.
  if (!input.requestedByContactId) return { blocked: false, message: '' }
  // Already invited (confirmed once) → never prompt again for this contact.
  if (input.contactOccamInvited) return { blocked: false, message: '' }
  return {
    blocked: true,
    message:
      "This is the first delivery for this project's requested-by contact, and they haven't been confirmed as invited to Occam. They need the Occam welcome email + a sign-in to view the data — confirm the invite was sent before delivering.",
  }
}

import { describe, it, expect } from 'vitest'
import { sanitizeFields } from './sanitize'

/**
 * The AI quick edit's last gate.
 *
 * Two rules are pinned here because both were wrong in a way nobody would see
 * until a project landed somewhere odd: the model could set a scoping stage
 * that is not one of the lane's columns, and it spoke the stored word 'Closed'
 * while every screen says 'Archived'.
 */
describe('sanitizeFields', () => {
  it('stores Archived as the Closed the column actually holds', () => {
    expect(sanitizeFields({ status: 'Archived' }, false)).toEqual({ status: 'Closed' })
  })

  it('still accepts the stored word, so nothing that already worked breaks', () => {
    expect(sanitizeFields({ status: 'Closed' }, false)).toEqual({ status: 'Closed' })
  })

  it('leaves the other statuses alone', () => {
    expect(sanitizeFields({ status: 'Open' }, false)).toEqual({ status: 'Open' })
    expect(sanitizeFields({ status: 'Hold' }, false)).toEqual({ status: 'Hold' })
  })

  it('drops a status the enum does not carry', () => {
    // Cancelling is a decision with a reason behind it, not a parse of prose.
    expect(sanitizeFields({ status: 'Cancelled' }, false)).toEqual({})
  })

  it('refuses the legacy Closed scoping stage, which is no column', () => {
    expect(sanitizeFields({ scoping_stage: 'Closed' }, false)).toEqual({})
  })

  it('keeps the real scoping stages', () => {
    expect(sanitizeFields({ scoping_stage: 'Proposal Sent' }, false)).toEqual({ scoping_stage: 'Proposal Sent' })
  })

  it('keeps money out of a non-holder’s parse', () => {
    expect(sanitizeFields({ budget: 15000, n_target: 500 }, false)).toEqual({ n_target: 500 })
    expect(sanitizeFields({ budget: 15000 }, true)).toEqual({ budget: 15000 })
  })

  it('drops negative counts and never lets both lanes be set at once', () => {
    expect(sanitizeFields({ n_target: -5 }, false)).toEqual({})
    expect(sanitizeFields({ scoping_stage: 'New Inquiry', board_column: 'Fielding' }, false))
      .toEqual({ scoping_stage: 'New Inquiry' })
  })
})

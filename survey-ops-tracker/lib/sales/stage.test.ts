import { describe, it, expect } from 'vitest'
import { stageOf, stageTone } from './stage'

/**
 * The measurement this file exists for: every delivered survey in production is
 * also `status='Closed'` — 334 of 334 — and three of the four surfaces that
 * showed a stage tested status first, so every one of them read "Closed".
 */

const row = (o: Partial<Parameters<typeof stageOf>[0]> = {}) => ({
  status: 'Open', phase: null, board_column: 'Fielding', ...o,
})

describe('a delivered survey says Delivered, whatever its status', () => {
  it('does not say Closed — the whole delivered book is also Closed', () => {
    expect(stageOf(row({ board_column: 'Delivery', status: 'Closed' }))).toBe('Delivered')
  })

  it('says Delivered before it has been closed, too', () => {
    // The app leaves a delivered project Open until somebody archives it, so
    // both spellings of a delivered survey have to land on the same word.
    expect(stageOf(row({ board_column: 'Delivery', status: 'Open' }))).toBe('Delivered')
  })
})

describe('a survey that ended some other way says how', () => {
  it.each([
    ['Hold', 'On hold'],
    ['Cancelled', 'Cancelled'],
    ['Closed', 'Archived'],
  ])('status %s reads as %s', (status, expected) => {
    expect(stageOf(row({ status }))).toBe(expected)
  })

  it('says Archived, not Closed — the word the rest of the app uses', () => {
    expect(stageOf(row({ status: 'Closed' }))).toBe('Archived')
  })
})

describe('a running survey says where it is, not that it is running', () => {
  it('gives the pipeline position', () => {
    expect(stageOf(row({ board_column: 'Data QA' }))).toBe('Data QA')
  })

  it('never renders the bucket word "Active", which says nothing', () => {
    expect(stageOf(row())).toBe('Fielding')
  })

  it('renders an em dash rather than an empty cell when there is no column', () => {
    expect(stageOf(row({ board_column: null }))).toBe('—')
  })
})

describe('scoping', () => {
  it('shows the pre-sale sub-stage when there is one', () => {
    expect(stageOf(row({ phase: 'Scoping', status: 'Open', scoping_stage: 'Proposal Sent' })))
      .toBe('Proposal Sent')
  })

  it('falls back to the word Scoping rather than an empty cell', () => {
    expect(stageOf(row({ phase: 'Scoping', status: 'Open', scoping_stage: null }))).toBe('Scoping')
  })

  it('IGNORES scoping_stage outside the Scoping bucket', () => {
    // 330 of 374 non-null rows still read "New Inquiry" and 271 of those are
    // already delivered, so reading it everywhere would relabel most of the
    // delivered book as a pre-sale inquiry.
    expect(stageOf(row({ board_column: 'Delivery', status: 'Closed', scoping_stage: 'New Inquiry' })))
      .toBe('Delivered')
  })

  it('a held deal that was being scoped reads as held, matching the tiles', () => {
    expect(stageOf(row({ phase: 'Scoping', status: 'Hold' }))).toBe('On hold')
  })
})

describe('stageTone', () => {
  it('colours a running survey by its pipeline stage, not by its bucket', () => {
    expect(stageTone(row({ board_column: 'Fielding' }))).toContain('blue')
    expect(stageTone(row({ board_column: 'Data QA' }))).toContain('violet')
    expect(stageTone(row({ board_column: 'Submitted' }))).toContain('slate')
  })

  it('reuses the bucket tone so a badge and its tile cannot disagree', () => {
    expect(stageTone(row({ board_column: 'Delivery', status: 'Closed' }))).toContain('emerald')
    expect(stageTone(row({ status: 'Cancelled' }))).toContain('red')
    expect(stageTone(row({ status: 'Hold' }))).toContain('amber')
  })

  it('a delivered survey is NOT coloured by the stage it sits in', () => {
    // board_column IS 'Delivery' on every delivered row, so a lookup that ran
    // first would give it the pipeline palette and quietly bypass the bucket.
    expect(stageTone(row({ board_column: 'Delivery', status: 'Closed' })))
      .toBe(stageTone(row({ board_column: 'Delivery', status: 'Open' })))
  })

  it('falls back to neutral rather than undefined for an unknown column', () => {
    expect(stageTone(row({ board_column: 'Something New' }))).toContain('bg-muted')
  })
})

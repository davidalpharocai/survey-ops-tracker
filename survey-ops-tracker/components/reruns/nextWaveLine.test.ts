import { describe, it, expect } from 'vitest'
import { nextWaveLine } from './RerunSeriesRecord'

// The callout above the waves list. It used to say
// "Wave N · auto-creates no date computed yet" for every series without a due
// date, which is two claims and both can be wrong: a MANUAL series auto-creates
// nothing, and "no date computed" names no reason. Each case below is a
// different thing for the reader to go and do.

const base = {
  effective_next: null as string | null,
  service_mode: 'auto',
  in_service: true,
  paused: false,
  cadence_months: 3 as number | null,
  next_due_override: null as string | null,
}

describe('nextWaveLine', () => {
  it('does not promise auto-creation on a manual series', () => {
    expect(nextWaveLine({ ...base, service_mode: 'manual', effective_next: '2026-10-15' })).toMatch(
      /^create by hand/
    )
    expect(nextWaveLine({ ...base, service_mode: 'manual', effective_next: '2026-10-15' })).not.toMatch(/auto/)
  })

  it('says auto-creates, with the date, on an auto series', () => {
    expect(nextWaveLine({ ...base, effective_next: '2026-10-15' })).toMatch(/^auto-creates/)
  })

  it('marks a hand-set date as one, so nobody hunts for the cadence that produced it', () => {
    const line = nextWaveLine({ ...base, effective_next: '2026-10-15', next_due_override: '2026-10-15' })
    expect(line).toMatch(/set by hand/)
    // …and does not, when the date came from the cadence.
    expect(nextWaveLine({ ...base, effective_next: '2026-10-15' })).not.toMatch(/set by hand/)
  })

  it('names the reason there is no date, and each reason is a different fix', () => {
    // Ended → reactivate.
    expect(nextWaveLine({ ...base, in_service: false })).toMatch(/ended/)
    // Paused → resume. Checked with in_service true so it cannot be the branch above.
    expect(nextWaveLine({ ...base, paused: true })).toMatch(/paused/)
    // No cadence → set one, or a date by hand. This is the state migration 124
    // deliberately left all sixteen backfilled series in.
    expect(nextWaveLine({ ...base, cadence_months: null })).toMatch(/set a cadence, or a next due date/)
    // Cadence set but nothing to count from → the anchor.
    expect(nextWaveLine(base)).toMatch(/fielding start/)
  })

  it('checks ended before paused — an ended series is not merely paused', () => {
    expect(nextWaveLine({ ...base, in_service: false, paused: true })).toMatch(/ended/)
  })

  it('never says "no date" when there is one', () => {
    for (const over of [null, '2026-10-15']) {
      const line = nextWaveLine({ ...base, effective_next: '2026-10-15', next_due_override: over })
      expect(line).not.toMatch(/no date/)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { edgeRoom, fitAxisLabels, fitText, labelIndices, labelRooms, labelStep, linear, niceDomain, niceStep, roundedBar, textWidth } from './scale'

describe('niceDomain', () => {
  it('rounds out to human ticks and includes zero', () => {
    const d = niceDomain(12, 97)
    expect(d.min).toBe(0)
    expect(d.max).toBe(100)
    expect(d.ticks).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('gives all-zero data a 0..1 axis so the baseline still draws', () => {
    const d = niceDomain(0, 0)
    expect(d.min).toBe(0)
    expect(d.max).toBeGreaterThan(0)
  })

  it('handles a single positive value and negative-only data', () => {
    expect(niceDomain(7, 7).min).toBe(0)
    expect(niceDomain(7, 7).max).toBeGreaterThanOrEqual(7)
    const neg = niceDomain(-1234, -56)
    expect(neg.max).toBe(0)
    expect(neg.min).toBeLessThanOrEqual(-1234)
  })

  it('spans a diverging range across zero', () => {
    const d = niceDomain(-450, 1200)
    expect(d.min).toBeLessThan(0)
    expect(d.ticks).toContain(0)
    expect(d.max).toBeGreaterThanOrEqual(1200)
  })

  it('never emits floating-point noise or -0 in ticks', () => {
    const d = niceDomain(0, 0.3)
    for (const t of d.ticks) expect(String(t)).not.toMatch(/0000|-0$/)
    expect(Object.is(niceDomain(-1, 1).ticks.find((t) => t === 0), -0)).toBe(false)
  })

  it('can leave zero out for a narrow band', () => {
    const d = niceDomain(0.9, 0.98, { includeZero: false })
    expect(d.min).toBeGreaterThan(0.5)
  })
})

describe('niceStep / linear', () => {
  it('picks 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceStep(100, 5)).toBe(20)
    expect(niceStep(1, 4)).toBe(0.25)
    expect(niceStep(0, 5)).toBe(1)
  })

  it('maps a domain onto pixels and survives a zero span', () => {
    const x = linear([0, 10], [0, 100])
    expect(x(5)).toBe(50)
    expect(linear([3, 3], [0, 100])(3)).toBe(50)
  })
})

describe('label fitting', () => {
  it('leaves a short label alone and cuts a long one with an ellipsis', () => {
    expect(fitText('Aug', 100, 11)).toEqual({ text: 'Aug', truncated: false })
    const cut = fitText('Prime Insights API Marketplace', 60, 11)
    expect(cut.truncated).toBe(true)
    expect(cut.text.endsWith('…')).toBe(true)
  })

  it('thins labels that would collide', () => {
    expect(labelStep(['Jan', 'Feb', 'Mar'], 80, 11)).toBe(1)
    expect(labelStep(['January 2026', 'February 2026'], 20, 11)).toBeGreaterThan(1)
  })
})

describe('labelIndices', () => {
  // The Last-12-months window: every label carries a year, so each one is
  // about half again as wide as the slot it sits in.
  const year = ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']

  it('always names both ends of the window, however hard it has to thin', () => {
    for (const slot of [10, 18, 29, 45, 120]) {
      const picks = labelIndices(year, slot, 11)
      expect(picks[0]).toBe(0)
      expect(picks[picks.length - 1]).toBe(year.length - 1)
    }
  })

  it('names the LAST period, which walking i % step from the left does not', () => {
    // 12 periods, every other one: i % 2 labels 0,2,…,10 and leaves the
    // newest month — the one the reader came for — unnamed.
    const slot = 29
    expect(labelStep(year, slot, 11)).toBe(2)
    expect((year.length - 1) % labelStep(year, slot, 11)).not.toBe(0)
    expect(labelIndices(year, slot, 11)).toContain(11)
  })

  it('never lets two kept labels overlap', () => {
    const slot = 29
    const picks = labelIndices(year, slot, 11)
    for (let k = 1; k < picks.length - 1; k++) {
      const gap = (picks[k] - picks[k - 1]) * slot
      expect(gap).toBeGreaterThanOrEqual((textWidth(year[picks[k]], 11) + textWidth(year[picks[k - 1]], 11)) / 2 + 6)
    }
  })

  it('keeps every label when they all fit', () => {
    expect(labelIndices(['Jan', 'Feb', 'Mar', 'Apr'], 80, 11)).toEqual([0, 1, 2, 3])
  })

  // A reader following a trend counts the columns between two named ones. If
  // the interval changes along the axis — because one month's NAME happened
  // to be a few pixels narrower — they have to re-learn it per chart, and the
  // two charts side by side on /insights named different months.
  it('keeps one constant interval, set by the widest label', () => {
    // "Jul 26" is 3px narrower than every other month, which per-label
    // measurement let slip through and made the rhythm 2,2,2,2,1,2.
    const short = ['Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26']
    const picks = labelIndices(short, 40.5, 11)
    const gaps = picks.slice(1).map((p, i) => p - picks[i])
    // Only the OLDEST interval may be short, where the pinned first label
    // lands off the rhythm; everything after it is one step.
    expect(new Set(gaps.slice(1)).size).toBe(1)
  })

  it('anchors the rhythm at the newest end, so any odd interval falls at the oldest', () => {
    // Twelve months over a 30px slot: the step is 2, and 12 months cannot be
    // walked in 2s from both ends at once. The odd one out goes at the far
    // left, where a reader is least likely to be counting.
    const months = Array.from({ length: 12 }, (_, i) => `Mmm ${20 + i}`)
    const picks = labelIndices(months, 30, 11)
    expect(picks[0]).toBe(0)
    expect(picks[picks.length - 1]).toBe(11)
    const gaps = picks.slice(1).map((p, i) => p - picks[i])
    expect(gaps[0]).toBe(3)
    expect(gaps.slice(1)).toEqual([2, 2, 2, 2])
  })

  it('handles the degenerate cases the real pages produce', () => {
    expect(labelIndices([], 40, 11)).toEqual([])
    expect(labelIndices(['Only'], 40, 11)).toEqual([0])
    // A collapsed tab measures 0 wide: still name the ends, never crash.
    expect(labelIndices(year, 0, 11)).toEqual([0, 11])
  })
})

describe('labelRooms', () => {
  const year = ['Oct 2025', 'Nov 2025', 'Dec 2025', 'Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026']

  it('never ellipsises a label the axis just decided fits', () => {
    for (const slot of [18, 29, 45, 120]) {
      const picks = labelIndices(year, slot, 11)
      const rooms = labelRooms(picks, year, slot, 11)
      for (const i of picks) expect(rooms[i]).toBeGreaterThanOrEqual(textWidth(year[i], 11))
    }
  })

  it('widens a kept label into the space its thinned neighbours left', () => {
    const rooms = labelRooms([0, 3, 5, 7, 9, 11], year, 30, 11)
    // Three empty slots to its right buy the first label far more than one.
    expect(rooms[0]).toBeGreaterThan(rooms[5])
    expect(rooms[5]).toBeGreaterThan(30)
    // An index with no label keeps a single slot; nothing is drawn there.
    expect(rooms[4]).toBe(30)
  })

  it('gives a lone label the whole axis', () => {
    expect(labelRooms([0], year, 30, 11)[0]).toBe(360)
  })

  // labelIndices promises both ends are named even when they have to touch.
  // The inward-gap arithmetic can reach 0 on a collapsed container, and a
  // room of 0 makes FitText render NOTHING — the invariant enforced in one
  // function and silently undone in the next.
  it('floors the two ends at their own width rather than letting them vanish', () => {
    const two = ['September 2026', 'October 2026']
    const picks = labelIndices(two, 20, 11)
    expect(picks).toEqual([0, 1])
    const rooms = labelRooms(picks, two, 20, 11)
    expect(rooms[0]).toBeGreaterThanOrEqual(textWidth(two[0], 11))
    expect(rooms[1]).toBeGreaterThanOrEqual(textWidth(two[1], 11))
  })
})

describe('fitAxisLabels', () => {
  const short = ['Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26', 'Mar 26', 'Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26']

  // The /insights trend pair: twelve "Oct 25" labels over a ~40px step.
  // At 11px they collide by under a pixel and five months lose their name at
  // every desktop width; at 10px all twelve fit with room to spare.
  it('shrinks one step rather than thin a single label away', () => {
    const at11 = fitAxisLabels(short, 40.5, 11)
    expect(at11.fontSize).toBe(11)
    expect(at11.picks.length).toBeLessThan(12)
    const fitted = fitAxisLabels(short, 40.5, 11, { minFontSize: 10 })
    expect(fitted.fontSize).toBe(10)
    expect(fitted.picks).toHaveLength(12)
    expect(fitted.rooms[11]).toBeGreaterThanOrEqual(textWidth('Sep 26', 10))
  })

  it('keeps the normal size when everything already fits', () => {
    expect(fitAxisLabels(short, 90, 11, { minFontSize: 10 }).fontSize).toBe(11)
  })

  // Two costs for one benefit: a smaller font that STILL thins reads worse
  // and looks arbitrary next to the chart beside it.
  it('will not shrink for a partial win', () => {
    const fitted = fitAxisLabels(short, 20, 11, { minFontSize: 10 })
    expect(fitted.fontSize).toBe(11)
    expect(fitted.picks.length).toBeLessThan(12)
  })
})

describe('edgeRoom', () => {
  it('caps a centred label at the room between it and the nearer edge', () => {
    // 10px from the right edge: it may draw 20px wide, not 200.
    expect(edgeRoom(200, 290, 300)).toBeCloseTo(21, 5)
    expect(edgeRoom(200, 10, 300)).toBeCloseTo(21, 5)
    expect(edgeRoom(40, 150, 300)).toBe(40)
  })

  it('leaves a pixel of slack, so a chart that reserved exactly enough keeps its label', () => {
    // A reserve computed from textWidth lands on the cap to the last float.
    const w = textWidth('21 Sep', 10)
    expect(edgeRoom(999, 300 - w / 2, 300)).toBeGreaterThanOrEqual(w)
  })
})

describe('roundedBar', () => {
  it('draws a closed path, and a plain rectangle when there is no length', () => {
    expect(roundedBar(0, 0, 20, 50, 'top')).toMatch(/^M.*Z$/)
    expect(roundedBar(0, 0, 0, 50, 'top')).toBe('M0,0h0v50h0Z')
  })
})

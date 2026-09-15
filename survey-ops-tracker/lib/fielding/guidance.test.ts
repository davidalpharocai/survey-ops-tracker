import { describe, it, expect } from 'vitest'
import {
  fieldingGuidance, measuredRoute, BUY_MULTIPLE, WAVE_LIMIT, type GuidanceInput,
} from './guidance'

/**
 * Guards the fielding guidance.
 *
 * The tests that matter are the SILENT ones, and more here than anywhere else:
 * this panel gives advice, and advice that appears on work it cannot help is
 * how a panel becomes wallpaper. 35 of the 47 candidate findings behind this
 * module were refuted on re-measurement — the discipline these tests encode is
 * the reason only four rules shipped.
 */

const base: GuidanceInput = { status: 'Open', phase: 'Active', board_column: 'Fielding' }
const codes = (i: GuidanceInput) => fieldingGuidance(i).map(g => g.code).sort()

describe('silence on work it cannot help', () => {
  it('says nothing about a delivered survey', () => {
    // The decisions are already made. Advice on a finished study is noise.
    expect(fieldingGuidance({ ...base, board_column: 'Delivery', n_target: 500 })).toEqual([])
  })

  it('says nothing about held or closed work', () => {
    expect(fieldingGuidance({ ...base, status: 'Hold', n_target: 500 })).toEqual([])
    expect(fieldingGuidance({ ...base, status: 'Closed', n_target: 500 })).toEqual([])
    expect(fieldingGuidance({ ...base, phase: 'Scoping', n_target: 500 })).toEqual([])
  })

  it('says nothing at all when there is no target and no field rows', () => {
    expect(fieldingGuidance({ ...base })).toEqual([])
  })

  it('does not mention channel on a survey with no email blasts', () => {
    expect(codes({ ...base, blasts: [{ channel: 'sms' }, { channel: 'sms' }] })).not.toContain('channel')
  })

  it('does not raise the buy multiple before it has been passed', () => {
    // Below 1.13x this would be a forecast, and this panel does not forecast.
    // Field rows are supplied because without them the route is unknown and the
    // rule is suppressed for a different (also correct) reason.
    const rows = { blasts: [{ completes: 200 }] }
    expect(codes({ ...base, ...rows, n_target: 100, n_collected: 112 })).not.toContain('buy-multiple')
    expect(codes({ ...base, ...rows, n_target: 100, n_collected: 200 })).toContain('buy-multiple')
  })
})

describe('measuredRoute: the rows, never the label', () => {
  it('reads the route off the rows a survey actually holds', () => {
    expect(measuredRoute({ blasts: [{}], suppliers: [] })).toBe('blast')
    expect(measuredRoute({ blasts: [], suppliers: [{}] })).toBe('panel')
    expect(measuredRoute({ blasts: [{}], suppliers: [{}] })).toBe('both')
    expect(measuredRoute({})).toBe('none')
  })

  it('calls a B2B-typed survey holding supplier rows a panel survey', () => {
    // PR00425 is exactly this: typed B2B, holding 294 PureSpectrum supplier
    // rows. project_type is wrong on 11 of the 117 projects with field rows, so
    // nothing in this module may consult it.
    expect(measuredRoute({ suppliers: [{ cpi: 1, n_collected: 995 }] })).toBe('panel')
  })
})

describe('route fit: the routes are not substitutes', () => {
  it('names the route that fits the audience and prices only that one', () => {
    // David, 2026-09-15: a B2B survey uses blasts, a PS survey uses PureSpectrum.
    // An earlier version priced BOTH and invited the reader to choose, which is
    // how a B2B study ends up sourced from a consumer panel.
    const b2b = fieldingGuidance({ ...base, project_type: 'B2B', n_target: 100 })[0]
    expect(b2b.code).toBe('route-fit')
    expect(b2b.headline).toContain('B2B blasts')
    expect(b2b.headline).not.toContain('PureSpectrum')

    const ps = fieldingGuidance({ ...base, project_type: 'PS', n_target: 1000 })[0]
    expect(ps.headline).toContain('PureSpectrum')
    expect(ps.headline).not.toContain('blast')
  })

  it('explains the gap as reach, not as a saving on offer', () => {
    const g = fieldingGuidance({ ...base, project_type: 'B2B', n_target: 100 })[0]
    expect(g.detail).toMatch(/does not reach this audience/)
  })

  it('says nothing when the type does not name an audience', () => {
    // Legacy 'Rerun' and untyped rows do not imply a route, and guessing one
    // would be the same mistake in the other direction.
    expect(codes({ ...base, project_type: 'Rerun', n_target: 500 })).not.toContain('route-fit')
    expect(codes({ ...base, project_type: null, n_target: 500 })).not.toContain('route-fit')
  })

  it('does not price a survey with no target', () => {
    expect(codes({ ...base, project_type: 'B2B', blasts: [{}] })).not.toContain('route-fit')
  })
})

describe('crossing routes needs screeners', () => {
  it('flags a B2B study being filled from the panel', () => {
    const g = fieldingGuidance({
      ...base, project_type: 'B2B', n_target: 1180,
      suppliers: [{ cpi: 1, n_collected: 1865 }],
    }).find(x => x.code === 'route-mismatch')
    expect(g?.level).toBe('act')
    expect(g?.detail).toContain('screeners')
    expect(g?.headline).toContain('1,865')
  })

  it('flags it on a mixed-route B2B study too', () => {
    expect(codes({
      ...base, project_type: 'B2B', n_target: 250,
      blasts: [{ completes: 25 }], suppliers: [{ cpi: 1, n_collected: 995 }],
    })).toContain('route-mismatch')
  })

  it('says nothing about a B2B study fielded the normal way', () => {
    expect(codes({
      ...base, project_type: 'B2B', n_target: 50, blasts: [{ completes: 40 }],
    })).not.toContain('route-mismatch')
  })

  it('does not flag a PS study on the panel — that IS the fit', () => {
    expect(codes({
      ...base, project_type: 'PS', n_target: 1000, suppliers: [{ cpi: 1, n_collected: 1000 }],
    })).not.toContain('route-mismatch')
  })
})

describe('the wave stop rule', () => {
  const blasts = (n: number) => Array.from({ length: n }, (_, k) => ({ blast_at: `2026-09-0${k + 1}` }))

  it('stays quiet for the first two blasts', () => {
    expect(codes({ ...base, blasts: blasts(2) })).not.toContain('wave-stop')
  })

  it('warns at the third and escalates past it', () => {
    const at = fieldingGuidance({ ...base, blasts: blasts(WAVE_LIMIT) }).find(g => g.code === 'wave-stop')
    expect(at?.level).toBe('watch')
    const past = fieldingGuidance({ ...base, blasts: blasts(WAVE_LIMIT + 2) }).find(g => g.code === 'wave-stop')
    expect(past?.level).toBe('act')
    expect(past?.headline).toContain('5 blasts')
  })

  it('counts a blast with no send date rather than dropping it', () => {
    // An undated blast still went out. Dropping it would under-count the waves
    // and silence the rule on exactly the projects with the sloppiest records.
    const g = fieldingGuidance({ ...base, blasts: [{ blast_at: '2026-09-01' }, {}, {}] })
    expect(g.find(x => x.code === 'wave-stop')?.headline).toContain('3 blasts')
  })
})

describe('the buy multiple', () => {
  it('prices the excess at the route the survey is actually using', () => {
    const panel = fieldingGuidance({
      ...base, n_target: 1000, n_collected: 2000, suppliers: [{ cpi: 1, n_collected: 2000 }],
    }).find(g => g.code === 'buy-multiple')
    // 2000 - ceil(1130) = 870 excess at the panel median $0.88 -> ~$766
    expect(panel?.headline).toContain('$766')

    const blast = fieldingGuidance({
      ...base, n_target: 100, n_collected: 200, blasts: [{ completes: 200 }],
    }).find(g => g.code === 'buy-multiple')
    // 200 - 113 = 87 excess at the blast median $49.69 -> ~$4,323
    expect(blast?.headline).toContain('$4,323')
  })

  it('names scrub as the bigger half, because "stop over-delivering" only fixes a third', () => {
    const g = fieldingGuidance({
      ...base, n_target: 100, n_collected: 300, blasts: [{ completes: 300 }],
    }).find(x => x.code === 'buy-multiple')
    expect(g?.detail).toContain('scrub')
    expect(g?.level).toBe('act')
  })
})

describe('every rule can be audited', () => {
  it('attaches evidence with a sample size to every item it emits', () => {
    // project_type supplied because route-fit is keyed on the audience the
    // survey is FOR — without it the rule correctly stays silent.
    const all = fieldingGuidance({
      ...base, project_type: 'B2B', n_target: 100, n_collected: 500,
      blasts: [{ channel: 'email' }, { channel: 'sms' }, { channel: 'sms' }, { channel: 'sms' }],
    })
    expect(all.length).toBeGreaterThan(3)
    for (const g of all) {
      expect(g.evidence).toBeTruthy()
      expect(g.evidence).toMatch(/n=\d+|\d+ (matched segments|campaigns|multi-blast)|surveys/)
    }
  })

  it('never claims anything about profit', () => {
    // Only 4 of 322 delivered surveys carry a client rate, so margin is not
    // computable. This module must talk about cost and never about profit.
    const all = fieldingGuidance({
      ...base, n_target: 100, n_collected: 500, blasts: [{ channel: 'email' }],
    })
    const text = all.map(g => `${g.headline} ${g.detail}`).join(' ').toLowerCase()
    expect(text).not.toMatch(/\bprofit|\bmargin\b|\brevenue\b/)
  })
})

describe('excess is priced at the survey own route, never a default', () => {
  it('prices a mixed-route survey at its own blend', () => {
    // PR00425: 294 PureSpectrum supplier rows alongside 11 blasts. An earlier
    // version fell through to the blast rate and reported $36,572 of unbilled N
    // against a true figure nearer $650 — a 56x overstatement, and exactly the
    // "trust the route default" mistake that cost us twice in one day.
    const g = fieldingGuidance({
      ...base, n_target: 250, n_collected: 1019,
      blasts: [{ completes: 10 }],
      suppliers: [{ cpi: 1, n_collected: 995 }],
    }).find(x => x.code === 'buy-multiple')
    expect(g).toBeTruthy()
    // blended: (10 x 49.69 + 995 x 0.88) / 1005 = ~1.37/complete on 736 excess
    const dollars = Number(String(g!.headline).match(/\$([\d,]+)/)![1].replace(/,/g, ''))
    expect(dollars).toBeGreaterThan(500)
    expect(dollars).toBeLessThan(2_000)
    expect(g!.evidence).toContain("own mix")
  })

  it('says NOTHING about excess when no field rows exist to reveal the route', () => {
    // The two routes are 57x apart. With no rows we do not know which one this
    // was, and picking one would be inventing the answer.
    expect(codes({ ...base, n_target: 100, n_collected: 500 })).not.toContain('buy-multiple')
  })

  it('still says nothing when both row types exist but neither recorded a complete', () => {
    expect(codes({
      ...base, n_target: 100, n_collected: 500,
      blasts: [{ completes: null }], suppliers: [{ n_collected: 0 }],
    })).not.toContain('buy-multiple')
  })

  it('a pure panel survey is priced at the panel median, not the blend', () => {
    const g = fieldingGuidance({
      ...base, n_target: 1000, n_collected: 2000, suppliers: [{ cpi: 1, n_collected: 2000 }],
    }).find(x => x.code === 'buy-multiple')
    expect(g!.headline).toContain('$766')
    expect(g!.evidence).toContain('panel median')
  })
})

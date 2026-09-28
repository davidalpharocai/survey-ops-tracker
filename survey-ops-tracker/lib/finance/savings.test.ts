import { describe, it, expect } from 'vitest'
import {
  bidPremiumLever, deadStreakLever, earnMore, firstSurveyIds, launchOverrunLever, priceGapLever,
  savings, sellRangeLever, smsRateLever, topUpLever, waveSpreadLever, waveTargetCoverage,
  EARN_KEYS, LEVER_TITLE, MIN_BENCHMARK_N, MIN_CLASS_N, PRICE_GAP_COST_FLOOR, SAVE_KEYS,
  type FinBlastDated, type FinLaunch, type FinSupplierRow, type Lever,
} from './savings'
import type { FinProject } from './hub'

/**
 * The savings engine had no tests at all. These pin the rules the audit found
 * wrong: the supplier-CPI lever took a median of distinct prices and counted
 * rows that bought nothing (replaced by the within-wave spread); the launch
 * lever told people to set SOCC's cap, which stops nothing, and hid the waves
 * it could not see; the bid lever called itself "costs nothing to try" while
 * its own risk text said otherwise; and figures typed into the words drifted.
 * The EARN MORE levers (6–8) are pinned too — above all that lever 6 never
 * tells anyone to bill over-delivery (David, 2026-09-24: it is never billable).
 */

const P = (id: string, o: Partial<FinProject> = {}): FinProject => ({
  id, project_code: id, project_name: null, client: null, client_id: 'acc', project_type: 'B2B',
  board_column: 'Delivery', status: 'Closed', phase: 'Active',
  deliver_date: '2026-07-01', launch_date: null, submitted_date: null,
  n_target: 100, n_collected: 100, n_actual: 90, ...o,
})
const B = (project_id: string, o: Partial<FinBlastDated> = {}): FinBlastDated => ({
  project_id, bid: 10, completes: 10, people: 1000, cost_per_send: 0.02, channel: 'sms', blast_at: '2026-07-01', ...o,
})
const S = (project_id: string, launch_id: string, supplier_id: string, cpi: number, n_collected: number): FinSupplierRow =>
  ({ project_id, launch_id, supplier_id, cpi, n_collected })

describe('smsRateLever', () => {
  it('prices the send rate on the population it is given, with the share computed', () => {
    const rows = [P('a'), P('b')]
    const blasts = [B('a'), B('b'), B('b', { channel: 'email' }), B('elsewhere')]
    const l = smsRateLever(rows, blasts, 200)!
    // 2 SMS blasts × 1,000 × $0.02 = $40 of send cost; email is free and the
    // survey outside the population does not count.
    expect(l.low).toBeCloseTo(40 * 0.125)
    expect(l.high).toBeCloseTo(40 * 0.25)
    expect(l.ids.sort()).toEqual(['a', 'b'])
    expect(l.why).toContain('20% of recorded cost in this view')
    expect(l.side).toBe('save')
    expect(l.free).toBe(true)
    expect(l.evidence).toBe('measured')
    expect(l.tooFew).toBe(true)
  })

  it('has nothing to say without text blasts', () => {
    expect(smsRateLever([P('a')], [B('a', { channel: 'email' })])).toBeNull()
  })
})

describe('deadStreakLever', () => {
  it('prices only the premium over the typical rate, never the whole spend', () => {
    const blasts = [
      B('a', { blast_at: '2026-07-01', completes: 0, people: 0 }),
      B('a', { blast_at: '2026-07-02', completes: 0, people: 0 }),
      // After two dead sends: $10 × 5 completes = $50, plus $20 of sends.
      B('a', { blast_at: '2026-07-03', completes: 5, people: 1000 }),
    ]
    const l = deadStreakLever([P('a')], blasts, 4)!
    // $70 for 5 completes against a typical $4 each: $50 premium.
    expect(l.high).toBeCloseTo(50)
    expect(l.low).toBeCloseTo(25)
    expect(l.forgoneCompletes).toBe(5)
    expect(l.riskTag).toBe('gives up 5 completes')
    expect(l.givesUp).toBe('about 5 completes, bought dear')
    expect(l.free).toBe(false)
  })

  it('needs two dead sends in a row followed by more sends', () => {
    const blasts = [B('a', { completes: 0 }), B('a', { completes: 3, blast_at: '2026-07-02' }), B('a', { completes: 0, blast_at: '2026-07-03' })]
    expect(deadStreakLever([P('a')], blasts, 4)).toBeNull()
  })
})

describe('bidPremiumLever', () => {
  it('measures the reward paid above each survey’s own opening bid, gross', () => {
    const blasts = [B('a', { bid: 10, completes: 10 }), B('a', { bid: 15, completes: 4 }), B('b', { bid: 20 })]
    const l = bidPremiumLever([P('a'), P('b')], blasts)!
    expect(l.high).toBe(20) // (15 − 10) × 4
    expect(l.low).toBe(0)
    expect(l.ids).toEqual(['a'])
  })

  it('is NOT "costs nothing to try": a raise can be the only way to fill a hard survey', () => {
    const l = bidPremiumLever([P('a')], [B('a', { bid: 10 }), B('a', { bid: 12 })])!
    expect(l.free).toBe(false)
    expect(l.riskTag).toBe('may leave a hard survey short')
    expect(l.forgoneCompletes).toBe(0)
  })
})

describe('waveSpreadLever: the within-wave price spread that replaces the supplier-CPI lever', () => {
  it('counts what was paid above the cheapest panel IN THE SAME WAVE', () => {
    const sup = [
      S('a', 'w1', 'prime', 0.8, 100),
      S('a', 'w1', 'social', 1.3, 50), // 0.5 × 50 = $25 above
      S('a', 'w2', 'prime', 1.0, 10),
      S('a', 'w2', 'disqo', 1.8, 10), // 0.8 × 10 = $8 above
    ]
    const l = waveSpreadLever([P('a')], sup)!
    expect(l.high).toBeCloseTo(33)
    expect(l.low).toBe(0)
    expect(l.evidence).toBe('direction')
    expect(l.population).toContain('2 waves')
  })

  it('names the rows its share is a share OF, so Tile 4 and Tile 5 cannot be read as one figure', () => {
    const sup = [S('a', 'w1', 'prime', 0.8, 100), S('a', 'w1', 'social', 1.3, 50)]
    expect(waveSpreadLever([P('a')], sup)!.why).toContain('% of panel spend on the work in view')
    expect(waveSpreadLever([P('a')], sup, 'the delivered and live work in view')!.why)
      .toContain('% of panel spend on the delivered and live work in view')
  })

  it('ignores rows that bought nothing — a zero-N row has a price nobody paid', () => {
    const sup = [S('a', 'w1', 'prime', 0.8, 100), S('a', 'w1', 'social', 3, 0)]
    expect(waveSpreadLever([P('a')], sup)).toBeNull()
  })

  it('ignores a wave bought from one panel, and panels in different waves', () => {
    const sup = [S('a', 'w1', 'prime', 0.8, 100), S('a', 'w1', 'prime', 1.2, 100), S('a', 'w2', 'social', 3, 10)]
    expect(waveSpreadLever([P('a')], sup)).toBeNull()
  })
})

describe('launchOverrunLever', () => {
  const launches: FinLaunch[] = [
    { id: 'w1', project_id: 'a', target: 100 },
    { id: 'w2', project_id: 'a', target: null },
  ]
  const sup = [S('a', 'w1', 'prime', 1, 130), S('a', 'w2', 'prime', 2, 50)]

  it('tells the user to set the PureSpectrum Goal — SOCC’s cap stops nothing', () => {
    const l = launchOverrunLever([P('a')], sup, launches)!
    expect(l.title).toContain('PureSpectrum survey Goal')
    expect(l.rule).toContain('Goal in PureSpectrum')
    expect(`${l.rule} ${l.why}`).not.toMatch(/set completes_cap/i)
    expect(l.high).toBeCloseTo(30)
    expect(l.forgoneCompletes).toBe(30)
  })

  it('states the share of waves it cannot see because they carry no target', () => {
    const l = launchOverrunLever([P('a')], sup, launches)!
    expect(l.riskTag).toBe('cannot see 50% of waves')
    expect(l.population).toContain('1 of 2 waves carry a target')
    expect(l.population).toContain('$100')
    expect(l.why).toContain('50% of waves')
  })

  it('has nothing to say when no wave with a target ran past it — and the coverage still counts the blind waves', () => {
    const quiet = [S('a', 'w1', 'prime', 1, 90), S('a', 'w2', 'prime', 2, 50)]
    expect(launchOverrunLever([P('a')], quiet, launches)).toBeNull()
    expect(waveTargetCoverage([P('a')], quiet, launches)).toMatchObject({ waves: 2, seen: 1, blind: 1, blindSpend: 100 })
  })
})

describe('every lever’s shape', () => {
  it('gives each lever one rule sentence, the evidence apart, and a "gives up" phrase', () => {
    const blasts = [
      B('a', { bid: 10, blast_at: '2026-07-01' }), B('a', { bid: 10, completes: 0, blast_at: '2026-07-02' }),
      B('a', { bid: 10, completes: 0, blast_at: '2026-07-03' }), B('a', { bid: 15, completes: 4, blast_at: '2026-07-04' }),
    ]
    const ls: Lever[] = [smsRateLever([P('a')], blasts)!, bidPremiumLever([P('a')], blasts)!, deadStreakLever([P('a')], blasts, 1)!]
    for (const l of ls) {
      // One sentence: nothing after the first full stop.
      expect(l.rule.trim().split(/(?<=[.!?])\s+/)).toHaveLength(1)
      expect(l.why.length).toBeGreaterThan(0)
      expect(l.givesUp).toMatch(/^[a-z]/)
      expect(l.title).toBe(LEVER_TITLE[l.key])
    }
  })

  it('numbers the levers the way the spec does: five to save cost, three to earn more', () => {
    expect(SAVE_KEYS).toHaveLength(5)
    expect(EARN_KEYS).toHaveLength(3)
    expect(new Set([...SAVE_KEYS, ...EARN_KEYS]).size).toBe(8)
  })
})

describe('savings: one declared population, no grand total', () => {
  it('computes every lever on the rows given and never on the whole book', () => {
    const inView = [P('a')]
    const blasts = [B('a', { bid: 10 }), B('a', { bid: 12 }), B('z', { bid: 10 }), B('z', { bid: 50 })]
    const v = savings(inView, blasts, [], [])
    const bid = v.levers.find(l => l.key === 'bid-premium')!
    expect(bid.ids).toEqual(['a'])
    expect(bid.high).toBe(20)
    expect(v.surveys).toBe(1)
    expect('totalLow' in v).toBe(false)
  })

  it('drops empty placeholders from the population', () => {
    const shell = P('shell', { is_placeholder: true, n_collected: 0, n_actual: null })
    expect(savings([shell, P('a')], [], [], []).surveys).toBe(1)
  })

  it('ranks levers by their high end and marks thin populations', () => {
    const blasts = [B('a', { bid: 10 }), B('a', { bid: 12 })]
    const v = savings([P('a')], blasts, [], [])
    const highs = v.levers.map(l => l.high)
    expect(highs).toEqual([...highs].sort((x, y) => y - x))
    expect(v.levers.every(l => l.tooFew === (l.ids.length < MIN_CLASS_N))).toBe(true)
  })

  it('judges the dead-streak lever against a MEASURED book rate, gross of recoveries', () => {
    // One reconciled delivered blast survey: $100 of reward for 10 completes,
    // $40 recovered. Gross $/complete = (100 + 20 sends) / 10 = $12.
    const p = P('a', { n_collected: 10 })
    const v = savings([p], [B('a')], [], [{ project_id: 'a', amount: -40 }])
    expect(v.bookRate).toBeCloseTo(12)
  })
})

/* ── EARN MORE ──────────────────────────────────────────────────────────── */

const many = (k: number, o: (i: number) => Partial<FinProject>) =>
  Array.from({ length: k }, (_, i) => P(`s${i}`, { deliver_date: `2026-07-${String(10 + i).padStart(2, '0')}`, ...o(i) }))

describe('firstSurveyIds', () => {
  it('marks each account’s earliest survey, the code breaking a tie and an undated one counting as latest', () => {
    const book = [
      P('late', { client_id: 'x', deliver_date: '2026-08-01' }),
      P('early', { client_id: 'x', deliver_date: '2026-02-01' }),
      P('undated', { client_id: 'x', deliver_date: null }),
      P('only', { client_id: 'y', deliver_date: null }),
    ]
    expect([...firstSurveyIds(book)].sort()).toEqual(['early', 'only'])
  })
})

describe('sellRangeLever (lever 6)', () => {
  const rows = many(9, () => ({ n_target: 100, n_actual: 130 }))
  const rates = new Map(rows.map(p => [p.id, 5]))
  const older = P('older', { deliver_date: '2026-01-01', n_target: 50, n_actual: 80 })

  it('prices respondents past the top of the N sold, on repeat work, at each client’s own price', () => {
    const l = sellRangeLever(rows, rates, [...rows, older])!
    expect(l.high).toBeCloseTo(9 * 30 * 5)
    expect(l.low).toBe(0)
    expect(l.evidence).toBe('direction')
    expect(l.side).toBe('earn')
    expect(l.tooFew).toBe(false)
  })

  it('caps at the TOP of the range: delivering inside a sold range is not over-delivery', () => {
    const ranged = rows.map(p => ({ ...p, n_target_max: 130 }))
    expect(sellRangeLever(ranged, rates, [...ranged, older])).toBeNull()
  })

  it('leaves the account’s first survey out, and counts it beside the figure', () => {
    const l = sellRangeLever(rows, rates, rows)!
    // Without an older survey in the book, s0 is the account's first.
    expect(l.ids).not.toContain('s0')
    expect(l.high).toBeCloseTo(8 * 30 * 5)
    expect(l.why).toContain('Another 30 on 1 first survey')
    expect(l.tooFew).toBe(false)
  })

  it('ignores $0 prices and undelivered work', () => {
    const free = new Map(rows.map(p => [p.id, 0]))
    expect(sellRangeLever(rows, free, [...rows, older])).toBeNull()
    const live = rows.map(p => ({ ...p, board_column: 'Fielding', status: 'Open' }))
    expect(sellRangeLever(live, rates, [...live, older])).toBeNull()
  })

  it('says to sell a range and price the cushion in — never to bill the over-delivery', () => {
    const l = sellRangeLever(rows, rates, [...rows, older])!
    expect(l.title).toBe('Sell a range on repeat work')
    expect(l.rule).toMatch(/price the cushion into the quote/i)
    const words = [l.title, l.rule, l.why, l.risk, l.population, l.givesUp].join(' ')
    expect(words).not.toMatch(/\bbill (it|them|the|for|over)/i)
    expect(words).not.toMatch(/\binvoice (it|them|the)\b/i)
    expect(words).not.toMatch(/\bcharge (for )?(it|them|the (extra|over))/i)
  })
})

describe('topUpLever (lever 7)', () => {
  const rows = many(8, i => ({ project_type: 'PS', n_target: 100, n_actual: 90 + (i % 2) }))
  const sups = rows.map(p => ({ project_id: p.id, cpi: 1, n_collected: 120 }))
  const rates = new Map(rows.map(p => [p.id, 4]))
  const cards = [{ route: 'panel' as const, median: 1.5, p75: 2.5 }]

  it('nets the missing respondents against the route’s typical and dear cost per qualified respondent', () => {
    const l = topUpLever(rows, rates, cards, [], sups)!
    // 4 surveys 10 short, 4 surveys 9 short: 76 respondents at $4.
    expect(l.why).toContain('76 respondents short on 8 surveys')
    expect(l.high).toBeCloseTo(76 * (4 - 1.5))
    expect(l.low).toBeCloseTo(76 * (4 - 2.5))
    expect(l.evidence).toBe('depends')
  })

  it('never nets below zero, and says when topping up would lose money', () => {
    const dear = [{ route: 'panel' as const, median: 5, p75: 6 }]
    const l = topUpLever(rows, rates, dear, [], sups)!
    expect(l.high).toBe(0)
    expect(l.why).toContain('topping up would lose money')
  })

  it('counts but does not size a survey on a route with no cost per respondent', () => {
    const l = topUpLever(rows, rates, [], [], sups)!
    expect(l.high).toBe(0)
    expect(l.ids).toHaveLength(8)
    expect(l.why).toContain('counted but not sized')
  })
})

describe('priceGapLever (lever 8)', () => {
  // Blast work for two accounts at the same cost: 'lo' pays $100, 'hi' $140.
  const acc = (id: string, k: number) => many(k, () => ({
    client_id: id, project_type: 'B2B', n_target: 10, n_actual: 10, n_collected: 10,
  })).map((p, i) => ({ ...p, id: `${id}-${i}`, project_code: `${id}-${i}` }))
  const build = (loN: number, hiN: number, hiBid = 5) => {
    const rows = [...acc('lo', loN), ...acc('hi', hiN)]
    const rates = new Map(rows.map(p => [p.id, p.client_id === 'lo' ? 100 : 140]))
    const blasts = rows.map(p => B(p.id, { bid: p.client_id === 'lo' ? 5 : hiBid, completes: 10, people: 0 }))
    return { rows, rates, blasts }
  }

  it('prices the lower payer’s billed respondents at the higher payer’s rate', () => {
    const { rows, rates, blasts } = build(MIN_CLASS_N, MIN_BENCHMARK_N)
    const l = priceGapLever(rows, rates, blasts, [], [], id => id.toUpperCase())!
    expect(l.title).toBe('Bring LO’s blast prices up to HI’s')
    expect(l.high).toBeCloseTo(40 * 10 * MIN_CLASS_N)
    expect(l.low).toBeCloseTo(l.high / 2)
    expect(l.ids).toHaveLength(MIN_CLASS_N)
    expect(l.benchmark).toMatchObject({ accountId: 'hi', rate: 140, surveys: MIN_BENCHMARK_N })
  })

  it('calls no gap where the lower payer is cheaper to serve', () => {
    // 'hi' costs us well past the floor more per billed respondent, so paying more is fair.
    const { rows, rates, blasts } = build(MIN_CLASS_N, MIN_BENCHMARK_N, (5 / PRICE_GAP_COST_FLOOR) * 1.2)
    const l = priceGapLever(rows, rates, blasts, [], [])!
    expect(l.high).toBe(0)
    expect(l.tooFew).toBe(false)
    expect(l.note).toContain('work that costs us as much')
  })

  it('reads too few when either side lacks the surveys to compare', () => {
    const { rows, rates, blasts } = build(MIN_CLASS_N - 1, MIN_BENCHMARK_N)
    const l = priceGapLever(rows, rates, blasts, [], [])!
    expect(l.tooFew).toBe(true)
    expect(l.note).toContain(`needs ${MIN_CLASS_N}`)
  })

  it('has nothing to compare with one account', () => {
    const { rows, rates, blasts } = build(MIN_CLASS_N, 0)
    expect(priceGapLever(rows, rates, blasts, [], [])).toBeNull()
  })

  it('leaves a $0 survey out of every price per respondent', () => {
    const { rows, rates, blasts } = build(MIN_CLASS_N, MIN_BENCHMARK_N)
    rates.set('lo-0', 0)
    const l = priceGapLever(rows, rates, blasts, [], [])!
    expect(l.ids).not.toContain('lo-0')
    expect(l.tooFew).toBe(true) // now one short of MIN_CLASS_N
  })
})

describe('earnMore', () => {
  it('returns only EARN MORE levers, dearest first, on the population it is given', () => {
    const rows = many(9, () => ({ n_target: 100, n_actual: 130 }))
    const rates = new Map(rows.map(p => [p.id, 5]))
    const ls = earnMore(rows, rates, [], [], [], { book: [P('older', { deliver_date: '2026-01-01' }), ...rows] })
    expect(ls.every(l => l.side === 'earn')).toBe(true)
    expect(ls.map(l => l.key)).toEqual(['sell-range'])
  })
})

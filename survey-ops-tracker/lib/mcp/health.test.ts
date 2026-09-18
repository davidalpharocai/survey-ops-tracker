import { describe, it, expect } from 'vitest'
import { buildChecks, type BlastRow, type CostRow, type SupRow, type SegRow } from './health'

/**
 * lib/mcp/health.ts had NO test file, and that is how check 7c came to sit
 * inside check 9's `if` — reachable only on a project that both computed send
 * cost from its blasts AND carried an sms_email_blast cost line, which is very
 * nearly the opposite of the condition it tests. Measured against production:
 * one project (PR00375) matches 7c's condition and the old nesting could reach
 * ZERO. The check was dead for its entire existence.
 *
 * These tests are therefore about INDEPENDENCE as much as correctness: each
 * money check must fire on its own condition alone, with nothing else true.
 */

const blast = (b: Partial<BlastRow> = {}): BlastRow => ({
  bid: 150, completes: 5, blast_at: '2026-09-01T12:00:00Z',
  people: 1000, cost_per_send: 0.02, ...b,
})

// A project shaped so that only the check under test can complain: spend
// reconciles, so check 1 stays quiet, and nothing is over budget.
function project(over: Record<string, unknown> = {}) {
  return {
    project_code: 'PR00001', project_name: 'T', project_type: 'B2B Blast',
    budget: 100_000, actual_spend: 0, n_target: 100, n_collected: 100,
    board_column: 'Fielding', status: 'Open', ...over,
  }
}

const names = (cs: { check: string }[]) => cs.map(c => c.check)

/** Spend as recompute_project_spend computes it, so check 1 never fires and
 *  cannot be mistaken for the check under test. */
const spendOf = (blasts: BlastRow[], costs: CostRow[] = [], sup: SupRow[] = []) =>
  blasts.reduce((s, b) => s + (b.bid ?? 0) * (b.completes ?? 0) + (b.cost_per_send ?? 0) * (b.people ?? 0), 0) +
  costs.reduce((s, c) => s + (c.amount ?? 0), 0) +
  sup.reduce((s, x) => s + (x.cpi ?? 0) * (x.n_collected ?? 0), 0)

const run = (blasts: BlastRow[], costs: CostRow[] = [], over: Record<string, unknown> = {}, segs: SegRow[] = []) =>
  buildChecks(project({ actual_spend: spendOf(blasts, costs), ...over }), [], blasts, costs, segs)

describe('check 7c — blast_sent_count_missing', () => {
  it('fires on 0 sent with completes recorded, with NO cost line present', () => {
    // THE REGRESSION TEST. This is PR00375's shape: two blasts at people = 0
    // with completes. sendSpend is 0, so check 9's condition is false — under
    // the old nesting this produced nothing at all.
    const cs = run([
      blast({ people: 0, completes: 39 }),
      blast({ people: 0, completes: 17 }),
    ])
    expect(names(cs)).toContain('blast_sent_count_missing')
    // And specifically NOT because the double-count check dragged it in.
    expect(names(cs)).not.toContain('send_cost_double_counted')
  })

  it('is not advisory — a completed send that reached nobody is provably wrong', () => {
    const c = run([blast({ people: 0, completes: 39 })]).find(x => x.check === 'blast_sent_count_missing')
    expect(c?.advisory).toBe(false)
  })

  it('stays quiet when a blast genuinely produced no completes', () => {
    // 0 sent AND 0 completes is a blast that did nothing, not a missing figure.
    expect(names(run([blast({ people: 0, completes: 0 })]))).not.toContain('blast_sent_count_missing')
  })

  it('stays quiet on a normal blast', () => {
    expect(names(run([blast()]))).not.toContain('blast_sent_count_missing')
  })

  it('treats a NULL sent count as unrecorded, not as zero', () => {
    // NULL vs 0: null goes to 7d's "not recorded yet" arm, never to 7c.
    expect(names(run([blast({ people: null, completes: 39 })]))).not.toContain('blast_sent_count_missing')
  })
})

describe('check 7d — blast_sent_count_unrecorded', () => {
  it('fires on a null sent count older than 7 days, with no cost line', () => {
    const cs = run([blast({ people: null, blast_at: '2020-01-01T00:00:00Z' })])
    expect(names(cs)).toContain('blast_sent_count_unrecorded')
    expect(names(cs)).not.toContain('send_cost_double_counted')
  })

  it('stays quiet on a blast sent in the last 7 days', () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
    expect(names(run([blast({ people: null, blast_at: recent })])))
      .not.toContain('blast_sent_count_unrecorded')
  })

  it('stays quiet when the send date itself is unrecorded', () => {
    // No date means no way to say it is overdue — silence beats a guess.
    expect(names(run([blast({ people: null, blast_at: null })])))
      .not.toContain('blast_sent_count_unrecorded')
  })
})

describe('check 9 — send_cost_double_counted', () => {
  it('fires when send cost is computed AND an sms_email_blast cost line exists', () => {
    // PR00362's shape, the incident this check was written for.
    const costs: CostRow[] = [{ kind: 'sms_email_blast', amount: 1876.7 }]
    const cs = run([blast({ people: 93_835, cost_per_send: 0.02, completes: 0, bid: 150 })], costs)
    expect(names(cs)).toContain('send_cost_double_counted')
  })

  it('is advisory — a fixed platform fee legitimately coexists with per-send cost', () => {
    const costs: CostRow[] = [{ kind: 'sms_email_blast', amount: 500 }]
    const c = run([blast()], costs).find(x => x.check === 'send_cost_double_counted')
    expect(c?.advisory).toBe(true)
  })

  it('ignores a contacts_export line — buying a list is not sending to it', () => {
    const costs: CostRow[] = [{ kind: 'contacts_export', amount: 1548.47 }]
    expect(names(run([blast()], costs))).not.toContain('send_cost_double_counted')
  })

  it('ignores a $0 sms_email_blast line, which asserts no charge', () => {
    // Two such rows exist in production (PR00378, PR00394). A zero line is not
    // a double count of anything.
    const costs: CostRow[] = [{ kind: 'sms_email_blast', amount: 0 }]
    expect(names(run([blast()], costs))).not.toContain('send_cost_double_counted')
  })

  it('stays quiet when no send cost is computed at all', () => {
    const costs: CostRow[] = [{ kind: 'sms_email_blast', amount: 500 }]
    expect(names(run([blast({ cost_per_send: 0 })], costs))).not.toContain('send_cost_double_counted')
  })
})

describe('the three checks are independent', () => {
  it('reports all of them together when all three conditions hold', () => {
    // One blast doubles the send cost, one has 0 sent with completes, one is an
    // old blast with no sent count. Nesting any of these inside another would
    // drop at least one from this list.
    const costs: CostRow[] = [{ kind: 'sms_email_blast', amount: 500 }]
    const cs = run([
      blast({ people: 10_000, cost_per_send: 0.02 }),
      blast({ people: 0, completes: 39 }),
      blast({ people: null, blast_at: '2020-01-01T00:00:00Z' }),
    ], costs)
    expect(names(cs)).toContain('send_cost_double_counted')
    expect(names(cs)).toContain('blast_sent_count_missing')
    expect(names(cs)).toContain('blast_sent_count_unrecorded')
  })

  it('reports no money checks on a clean project', () => {
    const cs = names(run([blast()]))
    for (const c of ['send_cost_double_counted', 'blast_sent_count_missing', 'blast_sent_count_unrecorded']) {
      expect(cs, c).not.toContain(c)
    }
  })
})

describe('check 11 — n_collected vs every source that could have produced it', () => {
  /** Full control of both halves: suppliers AND blasts, with spend reconciled so
   *  check 1 stays quiet and cannot be mistaken for the check under test. */
  const withSources = (
    sup: SupRow[], blasts: BlastRow[], over: Record<string, unknown> = {},
  ) => buildChecks(
    project({ actual_spend: spendOf(blasts, [], sup), ...over }), sup, blasts, [], [])

  it('THE REGRESSION CASE — PR00425: blast completes recorded, PureSpectrum ones not', () => {
    // 1,019 collected, 10 of them through blasts, the other 1,009 through
    // PureSpectrum rows that were never created. Every other check in this file
    // passed this project while a five-figure sum went unrecorded: check 1 sees
    // stored and computed spend agree, and 7b cannot fire because blast completes
    // are non-zero. This is the whole reason check 11 exists.
    const cs = withSources([], [blast({ completes: 10, bid: 25, people: 0, cost_per_send: 0 })],
                           { n_collected: 1019 })
    const c = cs.find(x => x.check === 'n_vs_sources')
    expect(c, 'check 11 did not fire').toBeDefined()
    expect(c!.advisory, 'missing money must not be advisory').toBe(false)
    expect(c!.expected).toBe(10)
    expect(c!.actual).toBe(1019)
    // and NOT via 7b, which is blind here because completes are non-zero
    expect(names(cs)).not.toContain('blast_completes_missing')
  })

  it('stays silent when the two halves add up to the project N', () => {
    // 60 from suppliers + 40 from blasts = the project's 100.
    const cs = withSources([{ cpi: 1, n_collected: 60 }], [blast({ completes: 40, people: 0, cost_per_send: 0 })])
    expect(names(cs)).not.toContain('n_vs_sources')
    expect(names(cs)).not.toContain('n_has_no_source')
  })

  it('SHORT of N is a real issue — a launch or blast was never logged', () => {
    const c = withSources([{ cpi: 1, n_collected: 10 }], [], { n_collected: 500 })
      .find(x => x.check === 'n_vs_sources')
    expect(c?.advisory).toBe(false)
    expect(c?.detail).toMatch(/missing from actual_spend/)
  })

  it('ABOVE N is advisory — richer detail than headline means a stale n_collected', () => {
    const c = withSources([{ cpi: 1, n_collected: 500 }], [], { n_collected: 100 })
      .find(x => x.check === 'n_vs_sources')
    expect(c?.advisory).toBe(true)
    expect(c?.detail).toMatch(/stale/)
  })

  it('tolerates a gap of 1% or one complete — completes trickle in for days', () => {
    // 2,229 against 2,230 is the shape three real projects were in on 2026-09-17.
    expect(names(withSources([{ cpi: 1, n_collected: 2229 }], [], { n_collected: 2230 })))
      .not.toContain('n_vs_sources')
    // but 2% of a small N still speaks
    expect(names(withSources([{ cpi: 1, n_collected: 80 }], [], { n_collected: 100 })))
      .toContain('n_vs_sources')
  })

  it('no sources at all is ADVISORY — 150 legacy projects are in that state', () => {
    const c = withSources([], [], { n_collected: 500, actual_spend: 0 })
      .find(x => x.check === 'n_has_no_source')
    expect(c, 'did not fire').toBeDefined()
    expect(c!.advisory, 'a backfill queue is not an accusation').toBe(true)
  })

  it('says nothing about a project that has collected nothing yet', () => {
    const cs = names(withSources([], [], { n_collected: 0 }))
    expect(cs).not.toContain('n_vs_sources')
    expect(cs).not.toContain('n_has_no_source')
  })

  it('names the unrecorded blasts that explain part of a shortfall', () => {
    // A blast with NULL completes drags `sourced` down; 7a already reports it, so
    // 11 should point at it rather than read as a second, separate defect.
    const c = withSources(
      [], [blast({ completes: null, blast_at: '2020-01-01T00:00:00Z', people: 0, cost_per_send: 0 })],
      { n_collected: 500 },
    ).find(x => x.check === 'n_vs_sources')
    expect(c?.detail).toMatch(/blast_completes_unrecorded/)
  })
})

/**
 * Checks 12 and 13 (migration 117) — the delivered-N route split and the cost
 * line that will not say which route it bought.
 *
 * Both exist because lib/finance FAILS CLOSED on them: a survey whose split does
 * not sum, or whose flat cost names no route, silently drops out of the
 * per-route cost per respondent and back into the coverage line. Without these
 * checks the only symptom is a number quietly going missing from a page.
 */
describe('check 12 — the delivered-N route split', () => {
  // Mixed by construction: one supplier row and one blast row, so check 13's
  // condition is also live and each test has to keep it quiet on purpose.
  const sup: SupRow[] = [{ cpi: 2, n_collected: 995 }]
  const blasts = [blast({ bid: 10, completes: 24, people: 0, cost_per_send: 0 })]
  const mixed = (over: Record<string, unknown> = {}, costs: CostRow[] = []) => buildChecks(
    project({
      actual_spend: spendOf(blasts, costs, sup),
      n_collected: 1019, n_actual: 252, board_column: 'Delivery', ...over,
    }),
    sup, blasts, costs, [],
  )

  it('says nothing when no split has been recorded', () => {
    // Absent is not wrong. Most surveys will never carry one.
    const cs = names(mixed())
    expect(cs).not.toContain('n_split_vs_n_actual')
    expect(cs).not.toContain('n_split_incomplete')
  })

  it('passes a split that sums to n_actual', () => {
    const cs = names(mixed({ n_actual_panel: 236, n_actual_blast: 16, n_actual_split_method: 'measured' }))
    expect(cs).not.toContain('n_split_vs_n_actual')
    expect(cs).not.toContain('n_split_incomplete')
    expect(cs).not.toContain('n_split_estimated')
  })

  it('fires when the split no longer sums — the stale case', () => {
    // n_actual moves on its own, which is exactly why this is not a table
    // constraint: an unrelated, correct edit to n_actual must not fail with a
    // constraint name the editor cannot act on.
    const c = mixed({ n_actual: 300, n_actual_panel: 236, n_actual_blast: 16 })
      .find(x => x.check === 'n_split_vs_n_actual')
    expect(c, 'did not fire').toBeDefined()
    expect(c!.advisory, 'both numbers describe the same delivery, so this is an error not a vintage difference').toBe(false)
    expect(c!.expected).toBe(300)
    expect(c!.actual).toBe(252)
  })

  it('fires when only one side was recorded', () => {
    // Half a split cannot be checked and is not used, so it has to be visible.
    const c = mixed({ n_actual_panel: 236 }).find(x => x.check === 'n_split_incomplete')
    expect(c, 'did not fire').toBeDefined()
    expect(c!.detail).toMatch(/no blast side/)
  })

  it('treats a recorded ZERO as a real answer, not as a missing one', () => {
    // 252 from panel and 0 from blast is a legitimate outcome — a route we spent
    // on that produced nothing usable. `== null` rather than falsy is what makes
    // that expressible.
    const cs = names(mixed({ n_actual_panel: 252, n_actual_blast: 0 }))
    expect(cs).not.toContain('n_split_incomplete')
    expect(cs).not.toContain('n_split_vs_n_actual')
  })

  it('flags an ESTIMATED split as advisory — kept, but never priced', () => {
    const c = mixed({ n_actual_panel: 236, n_actual_blast: 16, n_actual_split_method: 'estimated' })
      .find(x => x.check === 'n_split_estimated')
    expect(c, 'did not fire').toBeDefined()
    expect(c!.advisory, 'an estimate recorded honestly is not a defect').toBe(true)
  })

  it('checks a SINGLE-route survey too, if someone records a split on it', () => {
    // Nothing about check 12 depends on the survey being mixed. A split typed
    // onto a panel-only survey should still have to add up.
    const c = buildChecks(
      project({ actual_spend: 1990, n_collected: 995, n_actual: 252, board_column: 'Delivery',
        n_actual_panel: 100, n_actual_blast: 100 }),
      sup, [], [], [],
    ).find(x => x.check === 'n_split_vs_n_actual')
    expect(c, 'did not fire').toBeDefined()
  })
})

describe('check 13 — a flat cost line that names no route', () => {
  const sup: SupRow[] = [{ cpi: 2, n_collected: 995 }]
  const blasts = [blast({ bid: 10, completes: 24, people: 0, cost_per_send: 0 })]
  const withCosts = (costs: CostRow[], sups = sup, bs = blasts) => buildChecks(
    project({ actual_spend: spendOf(bs, costs, sups), n_collected: 1019, n_actual: 252, board_column: 'Delivery' }),
    sups, bs, costs, [],
  )

  it('fires on a MIXED survey whose cost line has no route', () => {
    // PR00425: $8,697.85, 64% of the bill. Unplaced, it prices the blast leg at
    // $170.63 against a true $714.25.
    const c = withCosts([{ amount: 8697.85, kind: 'contacts_export', route: null }])
      .find(x => x.check === 'cost_line_unrouted')
    expect(c, 'did not fire').toBeDefined()
    expect(c!.advisory, 'a missing fact is not a wrong number').toBe(true)
    expect(c!.actual).toBe(8698)
  })

  it('goes quiet once the line is routed', () => {
    const cs = names(withCosts([{ amount: 8697.85, kind: 'contacts_export', route: 'blast' }]))
    expect(cs).not.toContain('cost_line_unrouted')
  })

  it('says NOTHING on a single-route survey — there is only one place it can go', () => {
    // The whole point of scoping this to mixed surveys. Firing on the other ~120
    // costed surveys would be noise on a question that has no doubt in it.
    expect(names(withCosts([{ amount: 500, kind: 'other', route: null }], sup, [])))
      .not.toContain('cost_line_unrouted')
    expect(names(withCosts([{ amount: 500, kind: 'other', route: null }], [], blasts)))
      .not.toContain('cost_line_unrouted')
  })

  it('ignores a $0 line, which attributes nothing either way', () => {
    expect(names(withCosts([{ amount: 0, kind: 'other', route: null }])))
      .not.toContain('cost_line_unrouted')
  })

  it('survives the column not existing yet (dark-ship window)', () => {
    // Before David applies 117 by hand, `route` is simply absent from the row.
    // undefined is `== null`, so this reads as unattributed — correct, and the
    // advisory it produces is harmless for the few days it is early.
    const c = withCosts([{ amount: 8697.85, kind: 'contacts_export' } as CostRow])
      .find(x => x.check === 'cost_line_unrouted')
    expect(c).toBeDefined()
  })
})

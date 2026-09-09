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

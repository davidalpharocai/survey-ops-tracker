import { describe, it, expect } from 'vitest'
import {
  revenueOf, marginOf, foregone, moneyLost, rateBands, zeroRates,
  accountOf, accountOptions, contactOptions, applyFilters, spendByClient,
  NO_CONTACT,
  type FinProject, type FinBlast, type FinSupplier, type FinContact,
} from './hub'

/**
 * Guards the revenue half of the finance hub.
 *
 * Every test here corresponds to a mistake that was actually made against real
 * SOCC numbers this week and reported before being caught: a margin lifted by
 * surveys carrying revenue and no cost, an account split nine ways by a
 * stale label, scrub priced at the client rate instead of at cost, and a rate
 * of 0 treated as a real price rather than as a blank field.
 */

const P = (o: Partial<FinProject> = {}): FinProject => ({
  id: 'p1', project_code: 'PR00001', project_name: 'S', client: 'BAM', client_id: 'acc1',
  project_type: 'PS', board_column: 'Delivery', status: 'Open', phase: 'Active',
  deliver_date: '2026-08-01', launch_date: null, submitted_date: null,
  n_target: null, n_collected: null, n_actual: null, requested_by_contact_id: null, ...o,
})
const CT = (o: Partial<FinContact> = {}): FinContact => ({
  id: 'c1', client_id: 'acc1', first_name: 'James', last_name: 'Cook', email: null, ...o,
})
const blast = (project_id: string, bid: number, completes: number): FinBlast =>
  ({ project_id, bid, completes, people: 0, cost_per_send: 0, channel: 'sms' })

describe('revenueOf: the cap is min(), not max()', () => {
  it('bills the target when we over-delivered', () => {
    // 1,300 delivered against a 1,000 target at $50 bills 1,000. The extra 300
    // earns nothing at all — it is the whole reason over-delivery is a cost.
    expect(revenueOf(P({ n_target: 1000, n_actual: 1300 }), 50)).toBe(50_000)
  })

  it('bills what we delivered when we came up short', () => {
    expect(revenueOf(P({ n_target: 1000, n_actual: 800 }), 50)).toBe(40_000)
  })

  it('returns null — not 0 — when there is no rate', () => {
    // 0 would be a claim that the survey earned nothing. null is the truth:
    // nobody wrote down what it earns.
    expect(revenueOf(P({ n_target: 100, n_actual: 100 }), null)).toBeNull()
    expect(revenueOf(P({ n_target: 100, n_actual: 100 }), undefined)).toBeNull()
  })

  it('treats a recorded rate of exactly 0 as unpriced, not as free work', () => {
    // PR00435 (UBS) carries rate 0 against 1,000 delivered N. Honouring that
    // would book $0 of revenue against $1,834 of real cost and drag the
    // portfolio margin with a number nobody entered.
    expect(revenueOf(P({ n_target: 1000, n_actual: 1000 }), 0)).toBeNull()
  })

  it('returns null when the survey has no N recorded', () => {
    expect(revenueOf(P({ n_target: null, n_actual: 500 }), 50)).toBeNull()
    expect(revenueOf(P({ n_target: 500, n_actual: null }), 50)).toBeNull()
  })
})

describe('marginOf: the flattering number that must never print', () => {
  it('EXCLUDES priced surveys with no recorded cost, and says how many', () => {
    // This is the entire point. Survey B has revenue and no cost; counting it
    // reports 100% margin on B and lifts the blended figure. Measured against
    // production the difference is 46% (honest) vs 58% (bookkeeping artefact).
    const rows = [
      P({ id: 'a', n_target: 100, n_actual: 100 }),
      P({ id: 'b', n_target: 100, n_actual: 100 }),
    ]
    const rates = new Map([['a', 50], ['b', 50]])
    const m = marginOf(rows, rates, [blast('a', 10, 100)], [], [])
    expect(m).toMatchObject({ revenue: 5000, cost: 1000, margin: 4000, surveys: 1 })
    expect(m.pct).toBeCloseTo(0.8)
    expect(m).toMatchObject({ pricedNoCost: 1, pricedNoCostRevenue: 5000 })
  })

  it('counts the unpriced delivered surveys it cannot see', () => {
    const rows = [P({ id: 'a', n_target: 10, n_actual: 10 }), P({ id: 'b' }), P({ id: 'c' })]
    const m = marginOf(rows, new Map([['a', 5]]), [blast('a', 1, 10)], [], [])
    expect(m).toMatchObject({ delivered: 3, unpriced: 2, surveys: 1 })
  })

  it('ignores work that is not delivered', () => {
    const rows = [P({ id: 'a', board_column: 'Fielding', n_target: 10, n_actual: 10 })]
    expect(marginOf(rows, new Map([['a', 5]]), [blast('a', 1, 10)], [], []).delivered).toBe(0)
  })

  it('reports pct 0 rather than NaN when nothing is priced', () => {
    expect(marginOf([P()], new Map(), [], [], []).pct).toBe(0)
  })
})

describe('foregone: revenue we never billed', () => {
  it('prices short delivery at the CLIENT rate', () => {
    // Promised 1,000, handed over 800, at $50 = $10,000 of revenue not earned.
    const rows = [P({ id: 'a', n_target: 1000, n_actual: 800 })]
    expect(foregone(rows, new Map([['a', 50]]))).toMatchObject(
      { surveys: 1, n: 200, dollars: 10_000 },
    )
  })

  it('never counts over-delivery as foregone revenue', () => {
    const rows = [P({ id: 'a', n_target: 1000, n_actual: 1300 })]
    expect(foregone(rows, new Map([['a', 50]])).n).toBe(0)
  })

  it('reports short surveys it cannot price SEPARATELY, never as zero', () => {
    // Against production, 48 surveys and 8,298 N sit here — nineteen times
    // the short N that can be priced. A reader shown only the priced figure
    // would take a twentieth of the problem for the whole of it.
    const rows = [
      P({ id: 'a', n_target: 100, n_actual: 60 }),
      P({ id: 'b', n_target: 100, n_actual: 10 }),
    ]
    const f = foregone(rows, new Map([['a', 10]]))
    expect(f).toMatchObject({ surveys: 1, n: 40, dollars: 400, unpricedSurveys: 1, unpricedN: 90 })
  })
})

describe('moneyLost: cash that left for N we cannot bill', () => {
  it('splits over-target from scrub and prices BOTH at this survey own cost', () => {
    // 1,000 target, 1,300 collected, 1,100 survived QA, $2 a complete:
    //   over-target = min(1100,1300) - 1000 = 100 -> $200
    //   scrub       = 1300 - 1100           = 200 -> $400
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    const m = moneyLost(rows, [], s, [])
    expect(m.overTarget).toMatchObject({ surveys: 1, n: 100 })
    expect(m.overTarget.dollars).toBeCloseTo(200)
    expect(m.scrub).toMatchObject({ surveys: 1, n: 200 })
    expect(m.scrub.dollars).toBeCloseTo(400)
  })

  it('counts scrub that cost cash but cost NO revenue', () => {
    // The survey above still cleared its 1,000 target with 1,100, so the whole
    // $400 of scrub reduced the bill by nothing. That is the number that tells
    // you scrub is a cost problem and not a revenue problem.
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    expect(moneyLost(rows, [], s, []).scrubStillHitTarget).toBe(1)
  })

  it('does not count scrub as billing-safe when it dragged us under target', () => {
    const rows = [P({ id: 'x', n_target: 1000, n_collected: 1300, n_actual: 900 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 2, n_collected: 1300 }]
    expect(moneyLost(rows, [], s, []).scrubStillHitTarget).toBe(0)
  })

  it('keeps the N of an uncosted survey rather than dropping it silently', () => {
    const rows = [P({ id: 'x', n_target: 100, n_collected: 300, n_actual: 250 })]
    const m = moneyLost(rows, [], [], [])
    expect(m).toMatchObject({ uncostedSurveys: 1, uncostedN: 200 })
    expect(m.scrub.dollars).toBe(0)
  })

  it('says nothing about a survey with no n_actual', () => {
    const rows = [P({ id: 'x', n_target: 100, n_collected: 300, n_actual: null })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 1, n_collected: 300 }]
    expect(moneyLost(rows, [], s, []).scrub.surveys).toBe(0)
  })

  it('ignores a survey with no target rather than treating target as 0', () => {
    // target 0 would make every complete "over target".
    const rows = [P({ id: 'x', n_target: null, n_collected: 300, n_actual: 300 })]
    const s: FinSupplier[] = [{ project_id: 'x', cpi: 1, n_collected: 300 }]
    expect(moneyLost(rows, [], s, []).overTarget.n).toBe(0)
  })
})

describe('the two halves are not addable', () => {
  it('reports foregone in client dollars and lost in cost dollars', () => {
    // Same 100 N, two answers: $5,000 of revenue never billed, $100 of cash
    // spent. They are different currencies of loss and the UI must not sum them.
    const short = [P({ id: 'a', n_target: 1000, n_actual: 900 })]
    const over = [P({ id: 'b', n_target: 1000, n_collected: 1100, n_actual: 1100 })]
    const s: FinSupplier[] = [{ project_id: 'b', cpi: 1, n_collected: 1100 }]
    expect(foregone(short, new Map([['a', 50]])).dollars).toBe(5000)
    expect(moneyLost(over, [], s, []).overTarget.dollars).toBeCloseTo(100)
  })
})

describe('rate provenance', () => {
  it('bands the rates and names the accounts behind each', () => {
    const rows = [
      P({ id: 'a', client_id: 'h' }), P({ id: 'b', client_id: 'h' }), P({ id: 'c', client_id: 'd' }),
      P({ id: 'e', client_id: 'k' }),
    ]
    const acc = new Map([['h', 'Holocene'], ['d', 'DE Shaw'], ['k', 'Citadel']])
    const b = rateBands(rows, new Map([['a', 200], ['b', 200], ['c', 200], ['e', 3]]), acc)
    expect(b[0]).toMatchObject({ rate: 200, surveys: 3 })
    expect(b[0].accounts).toEqual(['DE Shaw', 'Holocene'])
    expect(b[1]).toMatchObject({ rate: 3, surveys: 1 })
  })

  it('surfaces rates of exactly 0 instead of averaging them in', () => {
    const rows = [P({ id: 'a' }), P({ id: 'b' })]
    expect(zeroRates(rows, new Map([['a', 0], ['b', 50]])).map(p => p.id)).toEqual(['a'])
  })
})

describe('the account is the key, never the label', () => {
  const acc = new Map([['acc1', 'BAM']])

  it('resolves nine stale labels to one account', () => {
    // These are real production labels. Grouped by string they are nine
    // accounts; grouped by key they are one, and it is the largest we have.
    const labels = ['BAM', 'BAM - James Cook', 'BAM - Grey Jones', 'BAM - Elliot']
    const names = labels.map(l => accountOf(P({ client: l, client_id: 'acc1' }), acc))
    expect(new Set(names)).toEqual(new Set(['BAM']))
  })

  it('falls back to the label when there is no key, rather than dropping the row', () => {
    expect(accountOf(P({ client: 'Tiger', client_id: null }), acc)).toBe('Tiger')
    expect(accountOf(P({ client: null, client_id: null }), acc)).toBe('(no account)')
  })

  it('rolls spend up to the account, not the label', () => {
    const rows = [
      P({ id: 'a', client: 'BAM - James Cook', client_id: 'acc1' }),
      P({ id: 'b', client: 'BAM', client_id: 'acc1' }),
    ]
    const r = spendByClient(rows, [blast('a', 10, 5), blast('b', 10, 5)], [], [], acc)
    expect(r.clients).toHaveLength(1)
    expect(r.clients[0]).toMatchObject({ client: 'BAM', total: 100, surveys: 2, costed: 2 })
  })

  it('offers only accounts that have a survey in view', () => {
    const rows = [P({ id: 'a', client_id: 'acc1' }), P({ id: 'b', client_id: 'acc1' }), P({ id: 'c', client_id: 'acc2' })]
    const opts = accountOptions(rows, [
      { id: 'acc1', name: 'BAM' }, { id: 'acc2', name: 'Coatue' }, { id: 'acc3', name: 'Never used' },
    ])
    expect(opts.map(o => o.name)).toEqual(['BAM', 'Coatue'])
    expect(opts[0].surveys).toBe(2)
  })
})

describe('the contact dropdown', () => {
  const rows = [
    P({ id: 'a', client_id: 'acc1', requested_by_contact_id: 'c1' }),
    P({ id: 'b', client_id: 'acc1', requested_by_contact_id: 'c1' }),
    P({ id: 'c', client_id: 'acc1', requested_by_contact_id: 'c2' }),
    P({ id: 'd', client_id: 'acc1', requested_by_contact_id: null }),
    P({ id: 'e', client_id: 'acc2', requested_by_contact_id: 'c3' }),
  ]
  const contacts = [
    CT({ id: 'c1', first_name: 'James', last_name: 'Cook' }),
    CT({ id: 'c2', first_name: 'Grey', last_name: 'Jones' }),
    CT({ id: 'c3', client_id: 'acc2', first_name: 'Other', last_name: 'Account' }),
    CT({ id: 'c9', first_name: 'Never', last_name: 'Asked' }),
  ]

  it('lists only contacts who actually requested a survey at this account', () => {
    // BAM has 16 contacts on file and 10 who ever asked for a survey. The other
    // six would be dead ends in the list.
    const o = contactOptions(rows, contacts, 'acc1')
    expect(o.map(x => x.name)).toEqual(['James Cook', 'Grey Jones', 'No contact recorded'])
    expect(o[0].surveys).toBe(2)
  })

  it('keeps the no-contact surveys reachable', () => {
    // 31 of BAM 82 surveys are in this state. A dropdown that cannot select
    // them hides more than a third of the account.
    const o = contactOptions(rows, contacts, 'acc1')
    expect(o.find(x => x.id === NO_CONTACT)).toMatchObject({ surveys: 1 })
  })

  it('offers nothing until an account is chosen', () => {
    expect(contactOptions(rows, contacts, null)).toEqual([])
  })

  it('filters to the chosen contact, and to the no-contact bucket', () => {
    const route = () => 'none' as const
    expect(applyFilters(rows, { accountId: 'acc1', contactId: 'c1' }, route).map(r => r.id))
      .toEqual(['a', 'b'])
    expect(applyFilters(rows, { accountId: 'acc1', contactId: NO_CONTACT }, route).map(r => r.id))
      .toEqual(['d'])
  })

  it('filters by account through the key, so the stale label cannot split it', () => {
    const mixed = [
      P({ id: 'a', client: 'BAM - James Cook', client_id: 'acc1' }),
      P({ id: 'b', client: 'BAM', client_id: 'acc1' }),
      P({ id: 'c', client: 'Coatue', client_id: 'acc2' }),
    ]
    expect(applyFilters(mixed, { accountId: 'acc1' }, () => 'none').map(r => r.id)).toEqual(['a', 'b'])
  })
})

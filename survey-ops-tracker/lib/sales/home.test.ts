import { describe, it, expect } from 'vitest'
import {
  salesHome, judgeLive, commitmentDate, pctOfTarget, quietAccounts, type HomeRow,
} from './home'

/**
 * Guards the sales landing page.
 *
 * As with nFloor, overTarget and risk, the tests that earn their keep are the
 * SILENT ones. This page exists to be short enough to read every morning; a
 * judgement that fires on healthy work makes it as long as the table it replaced,
 * and then nobody reads either.
 */

const TODAY = '2026-09-14'

const row = (o: Partial<HomeRow> = {}): HomeRow => ({
  id: o.id ?? 'p1',
  project_code: 'PR00001',
  project_name: 'A study',
  client: 'Citadel',
  status: 'Open',
  phase: 'Active',
  board_column: 'Fielding',
  due_date: null,
  deliver_date: null,
  submitted_date: null,
  n_target: null,
  n_collected: null,
  n_actual: null,
  ...o,
})

describe('commitmentDate: the correction to which date we judge against', () => {
  it('prefers deliver_date, because due_date is the sparser field', () => {
    // Measured 2026-09-14: 22 of 30 live surveys carry a deliver_date, only 15 a
    // due_date. lib/utils/risk.ts keys off due_date alone and was therefore
    // silent on six surveys that were already past their delivery date.
    expect(commitmentDate({ deliver_date: '2026-09-20', due_date: '2026-09-25' })).toBe('2026-09-20')
  })

  it('falls back to due_date when there is no deliver_date', () => {
    expect(commitmentDate({ deliver_date: null, due_date: '2026-09-25' })).toBe('2026-09-25')
  })

  it('is null when neither exists, rather than inventing one', () => {
    // Eight live surveys had neither on 2026-09-14. They must sort last and say
    // so, not be silently treated as due today.
    expect(commitmentDate({ deliver_date: null, due_date: null })).toBeNull()
  })
})

describe('judgeLive: silence on work that is fine', () => {
  it('says nothing about a study with room and reasonable progress', () => {
    const j = judgeLive(row({ deliver_date: '2026-10-15', n_target: 100, n_collected: 40 }), TODAY)
    expect(j.kind).toBe('ok')
    expect(j.why).toEqual([])
    expect(j.behind).toBe(false)
  })

  it('says nothing about a study with no dates and no numbers', () => {
    expect(judgeLive(row(), TODAY).kind).toBe('ok')
  })

  it('does not call a study behind merely for being short mid-field', () => {
    // 20 of 100 with a month to run is normal, not a risk. A flag that fires
    // here is a flag the team learns to scroll past.
    const j = judgeLive(row({ deliver_date: '2026-10-15', n_target: 100, n_collected: 20 }), TODAY)
    expect(j.behind).toBe(false)
    expect(j.kind).toBe('ok')
  })
})

describe('judgeLive: the judgements', () => {
  it('counts the days past delivery', () => {
    const j = judgeLive(row({ deliver_date: '2026-08-27' }), TODAY)
    expect(j.kind).toBe('late')
    expect(j.why[0]).toBe('18 days past delivery')
  })

  it('says "1 day", not "1 days"', () => {
    expect(judgeLive(row({ deliver_date: '2026-09-13' }), TODAY).why[0]).toBe('1 day past delivery')
  })

  it('calls due today what it is', () => {
    const j = judgeLive(row({ deliver_date: TODAY }), TODAY)
    expect(j.kind).toBe('due')
    expect(j.why).toContain('due today')
  })

  it('goes quiet four days out', () => {
    expect(judgeLive(row({ deliver_date: '2026-09-18' }), TODAY).kind).toBe('ok')
  })

  it('flags behind pace only inside the window', () => {
    const short = { n_target: 100, n_collected: 20 }
    expect(judgeLive(row({ ...short, deliver_date: '2026-09-19' }), TODAY).behind).toBe(true)
    expect(judgeLive(row({ ...short, deliver_date: '2026-09-30' }), TODAY).behind).toBe(false)
  })

  it('reports over-delivery against the PROMISED N, never an internal one', () => {
    // Sales is not cleared to see n_internal_target (David, 2026-09-09), so the
    // comparison is to n_target and the row carries no internal figure at all.
    const j = judgeLive(row({ deliver_date: '2026-09-20', n_target: 1000, n_collected: 1380 }), TODAY)
    expect(j.why).toContain('over the promised N')
    expect(j.pct).toBe(138)
  })

  it('keeps the WORST kind when a study is both late and behind', () => {
    // An early version let the last reason added win, so a study that was late
    // AND over-delivered got filed under "over" and sank to the bottom — the one
    // row that most needed to be at the top.
    const j = judgeLive(row({
      deliver_date: '2026-09-10', n_target: 100, n_collected: 10, n_actual: 200,
    }), TODAY)
    expect(j.kind).toBe('late')
    expect(j.why).toEqual(['4 days past delivery', 'behind pace', 'over the promised N'])
  })
})

describe('pctOfTarget', () => {
  it('is null with no target, not zero', () => {
    // A blank denominator must not render as 0%, which reads as failure.
    expect(pctOfTarget({ n_target: null, n_collected: 40 })).toBeNull()
    expect(pctOfTarget({ n_target: 0, n_collected: 40 })).toBeNull()
  })

  it('treats a missing count as zero collected against a real target', () => {
    expect(pctOfTarget({ n_target: 400, n_collected: null })).toBe(0)
  })
})

describe('salesHome: one survey, one block', () => {
  const rows: HomeRow[] = [
    row({ id: 'a', board_column: 'Fielding', deliver_date: '2026-08-27', n_target: 20, n_collected: 4 }),
    row({ id: 'b', board_column: 'Delivery', deliver_date: '2026-09-11', n_target: 100, n_actual: 144 }),
    row({ id: 'c', board_column: 'Delivery', deliver_date: '2026-01-05' }),
    row({ id: 'd', phase: 'Scoping', board_column: 'Submitted', submitted_date: '2026-07-01' }),
    row({ id: 'e', phase: 'Scoping', board_column: 'Submitted', submitted_date: '2026-09-13' }),
    row({ id: 'f', status: 'Hold', deliver_date: '2026-08-01' }),
  ]

  it('never lists the same survey twice', () => {
    const h = salesHome(rows, TODAY)
    const ids = [...h.inField, ...h.shipped.map(r => ({ row: r })), ...h.stalled.map(r => ({ row: r }))]
      .map(x => x.row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('shipped means delivered, not merely dated recently', () => {
    // A still-fielding study with a delivery date inside the window used to
    // appear in BOTH "in field" and "shipped" on the same screen.
    const h = salesHome(rows, TODAY)
    expect(h.shipped.map(r => r.id)).toEqual(['b'])
    expect(h.inField.map(j => j.row.id)).toEqual(['a'])
  })

  it('only calls scoping stalled after three weeks', () => {
    expect(salesHome(rows, TODAY).stalled.map(r => r.id)).toEqual(['d'])
  })

  it('stays silent on held and closed work', () => {
    const h = salesHome(rows, TODAY)
    const shown = [...h.inField.map(j => j.row.id), ...h.shipped.map(r => r.id), ...h.stalled.map(r => r.id)]
    expect(shown).not.toContain('f')
  })

  it('sorts the worst first and undated last', () => {
    const h = salesHome([
      row({ id: 'fine', deliver_date: '2026-10-30' }),
      row({ id: 'undated' }),
      row({ id: 'late', deliver_date: '2026-09-01' }),
      row({ id: 'soon', deliver_date: '2026-09-15' }),
    ], TODAY)
    expect(h.inField.map(j => j.row.id)).toEqual(['late', 'soon', 'fine', 'undated'])
  })

  it('counts what needs attention, and admits what it cannot judge', () => {
    const h = salesHome([
      row({ id: 'late', deliver_date: '2026-09-01' }),
      row({ id: 'blind1' }),
      row({ id: 'blind2' }),
    ], TODAY)
    expect(h.counts.needing).toBe(1)
    expect(h.blind.noDate).toBe(2)
  })
})

describe('quietAccounts', () => {
  const old = '2026-03-01' // ~197 days before TODAY

  it('finds an account with nothing in flight and no recent delivery', () => {
    const q = quietAccounts([
      row({ id: '1', client: 'BAM - Elliot', board_column: 'Delivery', deliver_date: old }),
    ], TODAY)
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ client: 'BAM - Elliot', delivered: 1 })
    expect(q[0].daysSince).toBeGreaterThan(180)
  })

  it('is silent when anything is still open, held included', () => {
    // A paused study is a live conversation, not a dormant account.
    const withHold: HomeRow[] = [
      row({ id: '1', client: 'X', board_column: 'Delivery', deliver_date: old }),
      row({ id: '2', client: 'X', status: 'Hold' }),
    ]
    expect(quietAccounts(withHold, TODAY)).toEqual([])
  })

  it('is silent on a recent delivery', () => {
    expect(quietAccounts([
      row({ id: '1', client: 'X', board_column: 'Delivery', deliver_date: '2026-09-01' }),
    ], TODAY)).toEqual([])
  })

  it('says nothing about an account we have never delivered for', () => {
    // No delivery history is a new account, not a lapsed one.
    expect(quietAccounts([
      row({ id: '1', client: 'X', status: 'Closed', deliver_date: null }),
    ], TODAY)).toEqual([])
  })

  it('puts the longest-silent account first', () => {
    const q = quietAccounts([
      row({ id: '1', client: 'Recent', board_column: 'Delivery', deliver_date: '2026-06-01' }),
      row({ id: '2', client: 'Ancient', board_column: 'Delivery', deliver_date: '2026-01-01' }),
    ], TODAY)
    expect(q.map(x => x.client)).toEqual(['Ancient', 'Recent'])
  })
})

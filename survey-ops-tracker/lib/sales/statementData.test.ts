import { describe, it, expect } from 'vitest'
import { STATEMENT_PROJECT_COLS, neverRecordedFrom } from './statementData'

/**
 * The two routes that build the Survey Activity Statement — the salesperson's
 * (/sales/accounts/[id]/print, reading the sales_* views) and the analyst's
 * (/clients/[id]/statement, reading the base tables) — must hand AccountPrint
 * the same shape or the same account comes out as two different documents.
 */
describe('the statement column allowlist', () => {
  const cols = STATEMENT_PROJECT_COLS.split(',').map(c => c.trim())

  it('names no finance-only column, on a document meant for a client', () => {
    // The whole reason this is an allowlist rather than select('*'): an
    // analyst CAN read these, and the client document must never carry them.
    for (const banned of ['n_internal_target', 'budget', 'actual_spend', 'price_per_n', 'client_price', 'margin']) {
      expect(cols, banned).not.toContain(banned)
      expect(STATEMENT_PROJECT_COLS).not.toContain(banned)
    }
  })

  it('carries every field the document actually prints', () => {
    for (const needed of [
      'id', 'project_code', 'project_name', 'board_column', 'status', 'phase', 'scoping_stage',
      'n_target', 'n_target_max', 'n_collected', 'n_actual', 'credits', 'term_id',
      'submitted_date', 'deliver_date', 'delivered_at', 'requested_by_name',
    ]) {
      expect(cols, needed).toContain(needed)
    }
  })

  it('is a list of plain column names, with no embedded relation or alias', () => {
    // PostgREST would accept `client:clients(name)` here and quietly widen the
    // payload of a client-facing page.
    for (const c of cols) expect(c, c).toMatch(/^[a-z_][a-z0-9_]*$/)
    expect(new Set(cols).size).toBe(cols.length)
  })
})

describe('which surveys have never had a response count recorded', () => {
  const ids = ['a', 'b', 'c']

  it('names the surveys with no audit row', () => {
    expect(neverRecordedFrom(ids, [{ project_id: 'b' }], false)).toEqual(['a', 'c'])
  })

  it('names none when every survey has one', () => {
    expect(neverRecordedFrom(ids, ids.map(project_id => ({ project_id })), false)).toEqual([])
  })

  // The rule that matters. Not knowing whether a count was recorded is a
  // statement about our access; marking every survey "not recorded" on the
  // strength of it would put a claim about the client's data on the client's
  // document.
  it('names NONE when the read failed, never all of them', () => {
    expect(neverRecordedFrom(ids, null, true)).toEqual([])
    expect(neverRecordedFrom(ids, [], true)).toEqual([])
    // And a successful read that genuinely returned nothing does mean all of
    // them — the opposite answer from the same empty array.
    expect(neverRecordedFrom(ids, [], false)).toEqual(ids)
  })

  it('ignores audit rows for surveys not on this account', () => {
    expect(neverRecordedFrom(ids, [{ project_id: 'zz' }, { project_id: 'a' }], false)).toEqual(['b', 'c'])
  })
})

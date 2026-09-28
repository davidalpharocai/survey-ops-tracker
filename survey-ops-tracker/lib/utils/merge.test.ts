import { describe, it, expect } from 'vitest'
import { conflicts, buildSurvivorUpdate, CLIENT_MERGE_FIELDS, PROJECT_MERGE_FIELDS } from './merge'

const A = { due_date: '2026-07-20', budget: 6000, salesperson: 'Alex', n_target: 500, linked_documents: ['a'], co_captain_ids: ['x'] }
const B = { due_date: '2026-07-25', budget: 6000, salesperson: 'Jenna', n_target: 500, linked_documents: ['b'], co_captain_ids: ['x', 'y'] }

describe('conflicts', () => {
  it('returns only fields whose values differ', () => {
    const c = conflicts(A, B, PROJECT_MERGE_FIELDS).map(f => f.key)
    expect(c).toContain('due_date')
    expect(c).toContain('salesperson')
    expect(c).not.toContain('budget')   // equal
    expect(c).not.toContain('n_target') // equal
  })
})

describe('client display_name (migration 122)', () => {
  it('is offered when the two printed names differ, and carried over when the loser is picked', () => {
    const keep = { id: 's', name: 'DE Shaw', display_name: null }
    const lose = { id: 'l', name: 'DE Shaw', display_name: 'The D. E. Shaw Group' }
    expect(conflicts(keep, lose, CLIENT_MERGE_FIELDS).map(f => f.key)).toEqual(['display_name'])
    expect(buildSurvivorUpdate(keep, lose, { display_name: 'loser' })).toEqual({ display_name: 'The D. E. Shaw Group' })
  })

  it('is never offered, so never written, before 122: select(*) rows simply lack the key', () => {
    const keep = { id: 's', name: 'DE Shaw' }
    const lose = { id: 'l', name: 'DE Shaw' }
    expect(conflicts(keep, lose, CLIENT_MERGE_FIELDS)).toEqual([])
  })
})

describe('buildSurvivorUpdate', () => {
  it('applies picks and unions array columns', () => {
    const upd = buildSurvivorUpdate(A, B, { due_date: 'loser', salesperson: 'loser' })
    expect(upd.due_date).toBe('2026-07-25')
    expect(upd.salesperson).toBe('Jenna')
    expect(upd.budget).toBeUndefined()
    expect(upd.linked_documents?.sort()).toEqual(['a', 'b'])
    expect(upd.co_captain_ids?.sort()).toEqual(['x', 'y'])
  })
})

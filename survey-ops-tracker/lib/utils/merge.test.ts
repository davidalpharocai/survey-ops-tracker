import { describe, it, expect } from 'vitest'
import { conflicts, buildSurvivorUpdate, PROJECT_MERGE_FIELDS } from './merge'

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

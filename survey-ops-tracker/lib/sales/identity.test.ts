import { describe, it, expect } from 'vitest'
import { salesHeaderLabel, bookOwner } from './identity'

describe('sales identity labels', () => {
  it('names only the person when the book is their own', () => {
    const alex = { name: 'Alex Pinsky', bookOf: null }
    expect(salesHeaderLabel(alex)).toBe('Alex Pinsky')
    expect(bookOwner(alex)).toBe('Alex Pinsky')
  })

  it('says whose book a delegate is reading', () => {
    // John signs in as himself and sees Alex's rows. The header must say both,
    // and any sentence about "the accounts" must name Alex, not John.
    const john = { name: 'John Farrall', bookOf: 'Alex Pinsky' }
    expect(salesHeaderLabel(john)).toBe("John Farrall · Alex Pinsky's book")
    expect(bookOwner(john)).toBe('Alex Pinsky')
  })

  it('says nothing for an account that is not a salesperson', () => {
    expect(salesHeaderLabel({ name: null, bookOf: null })).toBeNull()
    expect(bookOwner({ name: null, bookOf: null })).toBeNull()
  })
})

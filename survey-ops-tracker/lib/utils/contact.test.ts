import { describe, it, expect } from 'vitest'
import { contactName, contactSubtitle } from './contact'

describe('contactName', () => {
  it('joins first and last', () => {
    expect(contactName({ first_name: 'Sarah', last_name: 'Chen' })).toBe('Sarah Chen')
  })
  it('trims when a part is blank', () => {
    expect(contactName({ first_name: 'Cher', last_name: '' })).toBe('Cher')
  })
})

describe('contactSubtitle', () => {
  it('joins title and email with a separator', () => {
    expect(contactSubtitle({ title: 'VP, Research', email: 'v@x.com' })).toBe('VP, Research · v@x.com')
  })
  it('shows just one when the other is missing', () => {
    expect(contactSubtitle({ title: 'VP', email: null })).toBe('VP')
    expect(contactSubtitle({ title: null, email: 'v@x.com' })).toBe('v@x.com')
  })
  it('is empty when both are missing', () => {
    expect(contactSubtitle({ title: null, email: null })).toBe('')
  })
})

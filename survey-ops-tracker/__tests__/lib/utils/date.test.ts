import { describe, it, expect } from 'vitest'
import { getDueDateStatus, formatDate, autoStamp } from '@/lib/utils/date'

describe('getDueDateStatus', () => {
  it('returns null for null input', () => {
    expect(getDueDateStatus(null)).toBe(null)
  })
  it('returns overdue for past date', () => {
    expect(getDueDateStatus('2020-01-01')).toBe('overdue')
  })
  it('returns soon for date 2 days from now', () => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    expect(getDueDateStatus(d.toISOString().split('T')[0])).toBe('soon')
  })
  it('returns normal for date 10 days from now', () => {
    const d = new Date()
    d.setDate(d.getDate() + 10)
    expect(getDueDateStatus(d.toISOString().split('T')[0])).toBe('normal')
  })
})

describe('formatDate', () => {
  it('returns em dash for null', () => {
    expect(formatDate(null)).toBe('—')
  })
  it('formats a date as Mon DD', () => {
    const result = formatDate('2026-06-15')
    expect(result).toMatch(/Jun 15/)
  })
})

describe('autoStamp', () => {
  it('creates new entry when no existing notes', () => {
    const result = autoStamp('David', null, 'Waiting on client')
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(result).toContain('David')
    expect(result).toContain('Waiting on client')
  })
  it('appends to existing notes', () => {
    const result = autoStamp('David', 'Old note', 'New note')
    expect(result).toContain('Old note')
    expect(result).toContain('New note')
  })
})

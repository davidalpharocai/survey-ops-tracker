import { describe, it, expect } from 'vitest'
import { waveStatus } from './waveStatus'

const T = '2026-07-22'

describe('waveStatus', () => {
  it('delivered when delivered_at is set or in the Delivery column', () => {
    expect(waveStatus({ delivered_at: '2026-07-14' }, T).key).toBe('delivered')
    expect(waveStatus({ board_column: 'Delivery' }, T).key).toBe('delivered')
    expect(waveStatus({ delivered_at: '2026-07-14' }, T).label).toBe('Delivered')
  })

  it('delivered takes priority even if still in an early column', () => {
    expect(waveStatus({ board_column: 'Submitted', delivered_at: '2026-07-01' }, T).key).toBe('delivered')
  })

  it('upcoming when Submitted with no launch date or a future one', () => {
    expect(waveStatus({ board_column: 'Submitted', launch_date: null }, T).key).toBe('upcoming')
    expect(waveStatus({ board_column: 'Submitted', launch_date: '2026-08-01' }, T).key).toBe('upcoming')
    expect(waveStatus({ board_column: 'Submitted', launch_date: null }, T).dashed).toBe(true)
  })

  it('active (in field) when Fielding', () => {
    const s = waveStatus({ board_column: 'Fielding' }, T)
    expect(s.key).toBe('active')
    expect(s.label).toBe('In field')
  })

  it('active (in progress) for mid-pipeline stages', () => {
    const s = waveStatus({ board_column: 'EdWin QA' }, T)
    expect(s.key).toBe('active')
    expect(s.label).toBe('In progress')
  })

  it('a Submitted wave whose launch date has passed is active, not upcoming', () => {
    expect(waveStatus({ board_column: 'Submitted', launch_date: '2026-07-01' }, T).key).toBe('active')
  })

  it('exposes color classes per status', () => {
    expect(waveStatus({ board_column: 'Delivery' }, T).chip).toContain('emerald')
    expect(waveStatus({ board_column: 'Fielding' }, T).dot).toBe('bg-primary')
    expect(waveStatus({ board_column: 'Submitted' }, T).chip).toContain('amber')
  })
})

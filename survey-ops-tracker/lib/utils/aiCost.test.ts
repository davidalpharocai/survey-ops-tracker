import { describe, it, expect } from 'vitest'
import { computeCostUsd, rateFor, formatUsd } from './aiCost'

describe('aiCost', () => {
  it('prices an Opus call from token usage (cached tokens billed separately)', () => {
    // 1M input @ $5 + 1M output @ $25 = $30
    expect(computeCostUsd('claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(30)
    // cache read is 10x cheaper than fresh input
    expect(computeCostUsd('claude-opus-4-8', { cache_read_input_tokens: 1_000_000 })).toBe(0.5)
    // cache write is 1.25x input
    expect(computeCostUsd('claude-opus-4-8', { cache_creation_input_tokens: 1_000_000 })).toBe(6.25)
  })

  it('uses model-specific pricing', () => {
    expect(computeCostUsd('claude-sonnet-4-6', { input_tokens: 1_000_000 })).toBe(3)
    expect(computeCostUsd('claude-haiku-4-5', { output_tokens: 1_000_000 })).toBe(5)
  })

  it('falls back to Opus pricing for unknown models (over-estimate is safe)', () => {
    expect(rateFor('some-future-model')).toEqual(rateFor('claude-opus-4-8'))
  })

  it('handles null/missing token fields as zero', () => {
    expect(computeCostUsd('claude-opus-4-8', {})).toBe(0)
    expect(computeCostUsd('claude-opus-4-8', { input_tokens: null, output_tokens: null })).toBe(0)
  })

  it('formats money compactly', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(12.5)).toBe('$12.50')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    expect(formatUsd(1500)).toBe('$1,500.00')
  })
})

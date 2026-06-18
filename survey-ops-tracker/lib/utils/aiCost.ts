// Dollar cost of a Claude API call from its token usage. Prices are per
// 1M tokens (USD), current as of 2026. input_tokens from the Anthropic usage
// object EXCLUDES cached tokens — cache reads/writes are billed separately at
// the rates below — so the four terms don't double-count.

export interface TokenUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

interface Rate {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number // 5-minute ephemeral cache write
}

// Per 1M tokens.
const PRICING: Record<string, Rate> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

// Unknown models fall back to Opus pricing — over-estimating spend is the safe
// direction for a budget guard.
const FALLBACK: Rate = PRICING['claude-opus-4-8']

export function rateFor(model: string): Rate {
  return PRICING[model] ?? FALLBACK
}

/** Cost in USD for one call. Rounded to 4 dp (matches the DB numeric(10,4)). */
export function computeCostUsd(model: string, usage: TokenUsage): number {
  const r = rateFor(model)
  const inp = usage.input_tokens ?? 0
  const out = usage.output_tokens ?? 0
  const cr = usage.cache_read_input_tokens ?? 0
  const cw = usage.cache_creation_input_tokens ?? 0
  const cost =
    (inp * r.input + out * r.output + cr * r.cacheRead + cw * r.cacheWrite) / 1_000_000
  return Math.round(cost * 10_000) / 10_000
}

/** "$1.23" / "$0.0042" — compact money for dashboards. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return '$' + n.toFixed(4)
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

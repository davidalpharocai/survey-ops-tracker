import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCostUsd, type TokenUsage } from '@/lib/utils/aiCost'

// Server-only helpers for the observability tables (migration 036). All writes
// go through the service-role client so they never depend on the caller's RLS,
// and every call is wrapped so logging can NEVER break the request it measures.

type Admin = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Pricing the parts lib/utils/aiCost.ts does not know about
// ---------------------------------------------------------------------------

/**
 * Rates for models missing from aiCost.ts's PRICING map, per 1M tokens (USD).
 *
 * WHY HERE AND NOT THERE: aiCost.ts falls back to Opus pricing for an unknown
 * model, so a missing entry books at *some* rate and nothing ever errors — the
 * spend is simply attributed to a model's rate that nobody chose. `claude-opus-5`
 * ($5 in / $25 out, cache read 10%, 5-minute cache write 1.25x) is the model the
 * project-context builder uses, so it gets a real entry rather than a fallback.
 * Add a model here (or to aiCost.ts) the day it is first called, not after the
 * first surprising invoice.
 */
const EXTRA_MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
}

/**
 * The SERVER-SIDE web search tool bills PER SEARCH, on top of tokens
 * ($10 per 1,000 searches). Token cost alone therefore under-reports any call
 * that searched, which matters because the monthly budget guard is driven by
 * `ai_usage.cost_usd`: under-report and the cap silently stops being a cap.
 */
export const WEB_SEARCH_USD_PER_SEARCH = 0.01

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

/** Token cost for one call, using EXTRA_MODEL_PRICING before aiCost's table. */
export function modelTokenCostUsd(model: string, usage: TokenUsage): number {
  const r = EXTRA_MODEL_PRICING[model]
  if (!r) return computeCostUsd(model, usage)
  const cost =
    ((usage.input_tokens ?? 0) * r.input +
      (usage.output_tokens ?? 0) * r.output +
      (usage.cache_read_input_tokens ?? 0) * r.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * r.cacheWrite) /
    1_000_000
  return round4(cost)
}

/** Full billed cost of one call: tokens + any server-tool searches it ran. */
export function aiCallCostUsd(
  model: string,
  usage: TokenUsage,
  opts: { searches?: number } = {},
): number {
  const searches = Math.max(0, Math.floor(opts.searches ?? 0))
  return round4(modelTokenCostUsd(model, usage) + searches * WEB_SEARCH_USD_PER_SEARCH)
}

/** First day of the current month, ISO — for "spend this month" queries. */
function monthStartISO(): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
}

/** Record one Claude API call. Best-effort: errors are logged, never thrown. */
export async function logAiUsage(args: {
  endpoint: string
  userEmail?: string | null
  model: string
  usage: TokenUsage
  /** Server-side web searches this call ran. Billed per search on top of tokens. */
  searches?: number
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('ai_usage').insert({
      endpoint: args.endpoint,
      user_email: args.userEmail ?? null,
      model: args.model,
      input_tokens: args.usage.input_tokens ?? 0,
      output_tokens: args.usage.output_tokens ?? 0,
      cache_read_tokens: args.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: args.usage.cache_creation_input_tokens ?? 0,
      cost_usd: aiCallCostUsd(args.model, args.usage, { searches: args.searches }),
    })
  } catch (err) {
    console.error('[observability] logAiUsage failed:', err)
  }
}

export interface AiBudget {
  spend: number // USD spent so far this month
  cap: number // monthly cap (USD)
  hardStop: boolean // when true, exceeding the cap blocks new calls
  exceeded: boolean // spend >= cap
  blocked: boolean // hardStop && exceeded
}

/**
 * Current-month AI spend vs the configured cap. On any failure it returns a
 * permissive budget (never blocks) — the cap is a guard, not a gate that should
 * take the assistant down if a query hiccups.
 */
export async function getAiBudget(admin?: Admin): Promise<AiBudget> {
  const lax: AiBudget = { spend: 0, cap: 0, hardStop: false, exceeded: false, blocked: false }
  try {
    const client = admin ?? createAdminClient()
    const [{ data: cfg }, { data: rows }] = await Promise.all([
      client.from('app_config').select('ai_monthly_cap_usd, ai_hard_stop').eq('id', 1).maybeSingle(),
      client.from('ai_usage').select('cost_usd').gte('created_at', monthStartISO()),
    ])
    const cap = Number(cfg?.ai_monthly_cap_usd ?? 0)
    const hardStop = Boolean(cfg?.ai_hard_stop)
    const spend = (rows ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
    const exceeded = cap > 0 && spend >= cap
    return { spend, cap, hardStop, exceeded, blocked: hardStop && exceeded }
  } catch (err) {
    console.error('[observability] getAiBudget failed:', err)
    return lax
  }
}

/** Record a cron/job outcome. Best-effort: never throws into the caller. */
export async function logSystemEvent(args: {
  source: string
  status?: 'ok' | 'partial' | 'error'
  detail?: string
  meta?: Record<string, unknown>
}): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('system_events').insert({
      source: args.source,
      status: args.status ?? 'ok',
      detail: args.detail ?? null,
      meta: args.meta ?? null,
    })
  } catch (err) {
    console.error('[observability] logSystemEvent failed:', err)
  }
}

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeCostUsd, type TokenUsage } from '@/lib/utils/aiCost'

// Server-only helpers for the observability tables (migration 036). All writes
// go through the service-role client so they never depend on the caller's RLS,
// and every call is wrapped so logging can NEVER break the request it measures.

type Admin = ReturnType<typeof createAdminClient>

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
      cost_usd: computeCostUsd(args.model, args.usage),
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

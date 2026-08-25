import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { isRestrictedMoneyField } from '@/lib/mcp/data'
import type { Database, Json } from '@/lib/supabase/types'

/**
 * Shared mcp_tool_calls telemetry + error hygiene for the tool registry.
 * Extracted verbatim from app/api/mcp/route.ts so BOTH the MCP connector and
 * the in-app assistant's commit endpoint (app/api/assistant/act) log tool
 * activity and sanitize errors identically. Behavior is byte-for-byte the same
 * as when this lived inline in the MCP route.
 */

/**
 * Metadata a tool handler attributes to its own mcp_tool_calls row. The handler
 * mutates the passed-in object (e.g. `meta.project_id = p.id`) once the target
 * is resolved; the telemetry wrapper reads whatever is on it after the handler
 * settles (success or throw), so a failed write still gets attributed correctly.
 */
export type ToolCallMeta = { project_id?: string; client_id?: string; detail?: unknown }

/**
 * `detail` with every restricted-money VALUE removed, at any depth.
 *
 * Unconditional — it does not matter who made the call. mcp_tool_calls is
 * readable by every analyst (migration 045), so a budget written into `detail`
 * by one of the three capability holders is a budget the whole team can query
 * afterwards. The tool result is gated per caller; this row is gated for
 * everyone.
 *
 * Only KEYS are matched, so a detail that lists which fields an undo touched
 * (`{ undo: { fields: ['budget'] } }`) keeps the field name — the name is not
 * the number. Non-plain values (Dates, class instances) are passed through
 * untouched: `detail` is always plain JSON built by a handler.
 */
export function scrubDetail(detail: unknown): unknown {
  if (Array.isArray(detail)) return detail.map(scrubDetail)
  if (detail === null || typeof detail !== 'object') return detail
  if (Object.getPrototypeOf(detail) !== Object.prototype) return detail
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (!isRestrictedMoneyField(k)) out[k] = scrubDetail(v)
  }
  return out
}

/** Clean, user-safe error text. Never leak raw DB error internals to the model. */
export function cleanErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/relation .* does not exist/i.test(raw) || /schema cache/i.test(raw)) {
    return "The Survey Ops database tables for this feature aren't set up yet — ask David to run the latest database migration in Supabase."
  }
  return 'Something went wrong handling that request. Please try again.'
}

/** A short, queryable failure category for mcp_tool_calls.error_code (never shown to the model). */
export function errorCode(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/stale_write/i.test(raw)) return 'stale_write'
  if (/relation .* does not exist/i.test(raw) || /schema cache/i.test(raw)) return 'missing_table'
  return 'unknown'
}

export function logToolCall(
  userEmail: string | undefined, tool: string, durationMs: number, ok: boolean,
  meta?: ToolCallMeta, err?: unknown
) {
  if (!userEmail) return
  const supabase = createAdminClient()
  const row: Database['public']['Tables']['mcp_tool_calls']['Insert'] = {
    user_email: userEmail, tool, duration_ms: durationMs, ok,
  }
  if (meta?.project_id) row.project_id = meta.project_id
  if (meta?.client_id) row.client_id = meta.client_id
  if (meta?.detail !== undefined) row.detail = scrubDetail(meta.detail) as Json
  if (err !== undefined) {
    row.error_code = errorCode(err)
    row.error_message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
  }
  return supabase.from('mcp_tool_calls')
    .insert(row)
    .then(
      () => {},
      () => {}
    )
}

/**
 * Run a tool handler with telemetry: measures duration, logs to mcp_tool_calls
 * (fire-and-forget, never breaks the response, never logs argument payloads),
 * and converts thrown errors into a clean user-safe message.
 */
export async function runWithTelemetry<T>(
  userEmail: string | undefined, tool: string, fn: () => Promise<T>, meta?: ToolCallMeta
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    void logToolCall(userEmail, tool, Date.now() - start, true, meta)
    return result
  } catch (err) {
    void logToolCall(userEmail, tool, Date.now() - start, false, meta, err)
    console.error(`mcp tool ${tool} failed:`, err)
    throw new Error(cleanErrorMessage(err))
  }
}

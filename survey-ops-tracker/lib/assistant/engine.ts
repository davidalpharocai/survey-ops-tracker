import 'server-only'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { TOOLS, type AssistantTool, type ToolCtx, type ToolMeta } from '@/lib/mcp/registry'
import { MCP_INSTRUCTIONS } from '@/lib/mcp/toolHelpers'

/**
 * Server-side engine shared by the in-app assistant loop (app/api/assistant)
 * and its commit endpoint (app/api/assistant/act). It reuses the SAME tool
 * registry as the MCP connector — the only difference in-app is that the model
 * can never commit a write: write tools are always PREVIEWED, and the real
 * commit happens only in /act with a user-redeemed token.
 */

export const TOOLS_BY_NAME: Map<string, AssistantTool> = new Map(TOOLS.map(t => [t.name, t]))

/**
 * A write tool is "append/direct-commit" when it has a `previewSummary` — these
 * tools (add_next_step, add_note, reminders, …) commit on ANY call, so at
 * preview time we must NOT run their handler; we synthesize a summary instead.
 * Everything else is "confirmable": its handler previews when called without
 * `confirm:true`, so it is safe to run for a preview.
 */
export function isAppendTool(tool: AssistantTool): boolean {
  return typeof tool.previewSummary === 'function'
}

/**
 * Build the Anthropic tool definitions from the registry. `confirm` is stripped
 * from every schema — the model must never see or set it; the server controls
 * preview vs commit. Computed once at module load (the registry is static).
 */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOLS.map(t => {
  const shape = { ...t.schema }
  delete (shape as Record<string, unknown>).confirm
  const jsonSchema = zodToJsonSchema(z.object(shape), { $refStrategy: 'none' }) as Record<string, unknown>
  delete jsonSchema.$schema
  return {
    name: t.name,
    description: t.description,
    input_schema: jsonSchema as Anthropic.Tool.InputSchema,
  }
})

export type PreviewOutcome =
  /** A genuine pending write — show the user Confirm/Cancel and mint a token. */
  | { kind: 'pending'; summary: string; preview: unknown }
  /** An early, non-write return (error/blocked/needs/ambiguous) — feed back to the model. */
  | { kind: 'passthrough'; result: unknown }

/** Extract a short human summary from a preview payload (falls back gracefully). */
function summaryOf(preview: unknown, fallback: string): string {
  if (preview && typeof preview === 'object' && 'summary' in preview) {
    const s = (preview as { summary?: unknown }).summary
    if (typeof s === 'string' && s.trim()) return s
  }
  return fallback
}

/**
 * Produce a preview for a write tool WITHOUT committing.
 * - append tools: synthesize via previewSummary(args) (never run the handler).
 * - confirmable tools: run the handler without confirm — it returns either
 *   `{ preview }` (→ pending) or an early return like `{ error }` / `{ blocked }`
 *   / `{ needs }` / `{ note, candidates }` (→ passthrough, no write happened).
 */
export async function previewWrite(
  tool: AssistantTool,
  args: Record<string, unknown>,
  ctx: ToolCtx,
  meta: ToolMeta
): Promise<PreviewOutcome> {
  if (isAppendTool(tool)) {
    const summary = tool.previewSummary!(args)
    return { kind: 'pending', summary, preview: { summary } }
  }
  const out = (await tool.handler({ ...args, confirm: false }, ctx, meta)) as unknown
  if (out && typeof out === 'object' && 'preview' in out) {
    const preview = (out as { preview: unknown }).preview
    return { kind: 'pending', summary: summaryOf(preview, `Apply ${tool.name}`), preview }
  }
  return { kind: 'passthrough', result: out }
}

/**
 * Commit a write for real (called ONLY from /act with a verified token).
 * - append tools: run the handler as-is (it commits directly).
 * - confirmable tools: run the handler with confirm:true.
 */
export async function commitWrite(
  tool: AssistantTool,
  args: Record<string, unknown>,
  ctx: ToolCtx,
  meta: ToolMeta
): Promise<unknown> {
  if (isAppendTool(tool)) return tool.handler(args, ctx, meta)
  return tool.handler({ ...args, confirm: true }, ctx, meta)
}

/** Trimmed, in-app-flavored system prompt. Reuses the connector's guidance verbatim. */
export function buildSystemPrompt(opts: { today: string; context?: { pr?: string; cl?: string } }): string {
  let prompt = `You are the AlphaRoc Survey Ops ✦ Assistant, embedded in the team's survey project tracker web app and talking to a logged-in AlphaRoc team member. Today's date: ${opts.today}.

${MCP_INSTRUCTIONS}

--- In-app assistant specifics ---
- You CANNOT commit any write yourself. Every mutating tool (create/update/status/stage/blast/note/reminder/contact/team-member, etc.) only ever produces a PREVIEW here. The change is applied only when the user clicks Confirm in the panel. Never say a change is done or saved — say you've prepared it and ask the user to confirm it below.
- When a write tool comes back as a pending confirmation, narrate in one short sentence what will happen, then stop and let the user confirm. Do NOT call the same write tool again to "apply" it — there is no way for you to apply it.
- Keep answers concise: short bullet lists, dates like "Jun 24". Lead status answers with deadline/collection risk and show N collected vs target (e.g. "142/250").`

  if (opts.context?.pr || opts.context?.cl) {
    const parts: string[] = []
    if (opts.context.pr) parts.push(`project ${opts.context.pr}`)
    if (opts.context.cl) parts.push(`client ${opts.context.cl}`)
    prompt += `\n\n--- Current page context ---\nThe user is currently viewing ${parts.join(' / ')}. When they say "this", "here", or "this project/client" without naming one, resolve it to ${parts.join(' / ')}.`
  }

  return prompt
}

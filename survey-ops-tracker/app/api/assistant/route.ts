import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { getAiBudget, logAiUsage } from '@/lib/server/observability'
import { runWithTelemetry, cleanErrorMessage, type ToolCallMeta } from '@/lib/mcp/telemetry'
import { ANTHROPIC_TOOLS, TOOLS_BY_NAME, buildSystemPrompt, previewWrite } from '@/lib/assistant/engine'
import { signAction } from '@/lib/assistant/token'
import type { ToolCtx } from '@/lib/mcp/registry'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = 'claude-opus-4-8'
const MAX_TOKENS = 8000
// Hard cap on model round-trips per request — a safety net against a runaway
// tool loop. A normal answer settles in 1–3.
const MAX_ITERATIONS = 12

type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; phase: 'start' | 'done' }
  | { type: 'pending'; id: string; tool: string; summary: string; preview: unknown; token: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

function anthropicErrorMessage(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key was rejected. Double-check ANTHROPIC_API_KEY in Vercel (Settings → Environment Variables), then redeploy.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "The API key works but doesn't have permission for this model. Ask your Anthropic admin to enable Claude model access for this key's workspace."
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit hit — wait a minute and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error (${err.status}): ${err.message}`.slice(0, 300)
  }
  return 'Sorry, something went wrong. Please try again.'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey.startsWith('your-')) {
    return new Response('The AI assistant is not configured yet (missing API key).', { status: 503 })
  }

  const { messages, context } = (await req.json()) as {
    messages?: { role: string; content: string }[]
    context?: { pr?: string; cl?: string }
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('Bad request', { status: 400 })
  }

  // Budget guard: only blocks when the owner turned on hard-stop AND the monthly
  // cap is reached. Otherwise advisory (surfaced in Admin).
  const budget = await getAiBudget()
  if (budget.blocked) {
    return new Response(
      `The AI assistant is paused for this month — the usage budget ($${budget.cap.toFixed(0)}) has been reached. An admin can raise it in Admin → AI usage.`,
      { status: 503 }
    )
  }

  const userEmail = user.email as string
  const ctx: ToolCtx = { userId: user.id, userEmail }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const systemPrompt = buildSystemPrompt({ today, context })

  const anthropic = new Anthropic({ apiKey })
  const encoder = new TextEncoder()

  const conversation: Anthropic.MessageParam[] = messages.map(m => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: String(m.content),
  }))

  const readable = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'))
      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const stream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
            tools: ANTHROPIC_TOOLS,
            messages: conversation,
          })

          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              send({ type: 'text', delta: event.delta.text })
            }
          }

          const final = await stream.finalMessage()
          // Best-effort usage logging, per model round-trip.
          try {
            void logAiUsage({ endpoint: 'assistant', userEmail, model: MODEL, usage: final.usage })
          } catch {
            /* usage logging must never affect the response */
          }

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
          )
          if (toolUses.length === 0) break // end_turn — the model is done

          // Preserve the assistant turn (including thinking/tool_use blocks) so the
          // follow-up tool_result message is well-formed for extended thinking.
          conversation.push({ role: 'assistant', content: final.content })

          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const tu of toolUses) {
            send({ type: 'tool', name: tu.name, phase: 'start' })
            const args = (tu.input ?? {}) as Record<string, unknown>
            const tool = TOOLS_BY_NAME.get(tu.name)
            let resultForModel: unknown

            if (!tool) {
              resultForModel = { error: `Unknown tool "${tu.name}".` }
            } else if (tool.kind === 'read') {
              const meta: ToolCallMeta = {}
              try {
                resultForModel = await runWithTelemetry(userEmail, tool.name, () => tool.handler(args, ctx, meta), meta)
              } catch (err) {
                resultForModel = { error: err instanceof Error ? err.message : cleanErrorMessage(err) }
              }
            } else {
              // WRITE — preview only. The model can never commit; a signed token
              // is minted and the real write happens in /api/assistant/act.
              const meta: ToolCallMeta = {}
              try {
                // Wrap in runWithTelemetry so a thrown preview error is cleaned
                // (never leaks DB internals to the model) and the preview call is
                // logged to mcp_tool_calls, exactly like the connector + read path.
                const outcome = await runWithTelemetry(
                  userEmail,
                  tool.name,
                  () => previewWrite(tool, args, ctx, meta),
                  meta
                )
                if (outcome.kind === 'pending') {
                  // log_blast affects spend; pin a stable idem_key into the token
                  // args so re-redeeming the same token can't double-count.
                  if (tool.name === 'log_blast' && args.idem_key == null) {
                    args.idem_key = randomUUID()
                  }
                  const token = signAction({ tool: tool.name, args, userEmail })
                  const id = randomUUID()
                  send({
                    type: 'pending',
                    id,
                    tool: tool.name,
                    summary: outcome.summary,
                    preview: outcome.preview,
                    token,
                  })
                  resultForModel = {
                    pending_confirmation: true,
                    summary: outcome.summary,
                    preview: outcome.preview,
                    note: 'This change has NOT been applied. It is shown to the user with a Confirm button in the UI. Narrate what will happen and ask them to confirm — do not call this tool again.',
                  }
                } else {
                  resultForModel = outcome.result
                }
              } catch (err) {
                resultForModel = { error: err instanceof Error ? err.message : cleanErrorMessage(err) }
              }
            }

            send({ type: 'tool', name: tu.name, phase: 'done' })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(resultForModel),
            })
          }

          conversation.push({ role: 'user', content: toolResults })
        }

        send({ type: 'done' })
      } catch (err) {
        console.error('Assistant loop error:', err)
        send({ type: 'error', message: anthropicErrorMessage(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}

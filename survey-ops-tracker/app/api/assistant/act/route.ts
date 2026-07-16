import { createClient } from '@/lib/supabase/server'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { runWithTelemetry, cleanErrorMessage, type ToolCallMeta } from '@/lib/mcp/telemetry'
import { TOOLS_BY_NAME, commitWrite } from '@/lib/assistant/engine'
import { verifyAction, verifyFailureMessage } from '@/lib/assistant/token'
import type { ToolCtx } from '@/lib/mcp/registry'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Commit endpoint for the in-app assistant. This is the ONLY place an assistant
 * write ever executes, and only when the user redeems a signed token minted by
 * the agent loop. The chat model never gets or sends `confirm:true`; the token
 * carries the exact { tool, args, userEmail } that was previewed.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !isAllowedEmail(user.email)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const userEmail = user.email as string

  const body = (await req.json().catch(() => null)) as { token?: unknown } | null
  const token = body?.token
  if (typeof token !== 'string' || !token) {
    return Response.json({ error: 'Missing confirmation token.' }, { status: 400 })
  }

  // Verify HMAC + expiry, and that the token was minted for THIS user.
  const verified = verifyAction(token, userEmail)
  if (!verified.ok) {
    return Response.json({ error: verifyFailureMessage(verified.reason) }, { status: 400 })
  }
  const { tool: toolName, args } = verified.action

  const tool = TOOLS_BY_NAME.get(toolName)
  if (!tool || tool.kind !== 'write') {
    return Response.json({ error: 'That action is no longer available.' }, { status: 400 })
  }

  // Re-resolve ctx from the live session — never trust anything but the token's
  // signed identity check above and the current session.
  const ctx: ToolCtx = { userId: user.id, userEmail }
  const meta: ToolCallMeta = {}

  try {
    // Same audit logging / compliance gate / idempotency / mcp_tool_calls
    // telemetry the connector uses — commitWrite runs the exact registry handler.
    const result = await runWithTelemetry(userEmail, tool.name, () => commitWrite(tool, args, ctx, meta), meta)
    // Confirmable handlers signal failure by RETURNING (not throwing): a stale
    // write / guard is {error}, an ambiguous target is {note, candidates}, a
    // late validation is {error}. Surface those as errors so the UI never shows
    // a change that did NOT happen as "✓ Done". ({blocked, reason} for the
    // compliance gate rides through in `result` — the client renders it distinctly.)
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>
      if (typeof r.error === 'string') return Response.json({ error: r.error }, { status: 200 })
      if (!r.ok && typeof r.note === 'string') return Response.json({ error: r.note }, { status: 200 })
      if (!r.ok && r.needs) {
        return Response.json(
          { error: typeof r.needs === 'string' ? r.needs : 'More detail is needed to complete this.' },
          { status: 200 }
        )
      }
    }
    return Response.json({ result })
  } catch (err) {
    // A compliance block or `needs` is returned by the handler (not thrown) and
    // rides through in `result` above. A throw here is a genuine failure —
    // surface a clean, non-leaking message.
    return Response.json(
      { error: err instanceof Error ? err.message : cleanErrorMessage(err) },
      { status: 200 }
    )
  }
}

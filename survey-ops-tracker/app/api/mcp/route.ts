import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { findAccessToken, revokeTokenById } from '@/lib/oauth/store'
import { TOOLS } from '@/lib/mcp/registry'
import { MCP_INSTRUCTIONS } from '@/lib/mcp/toolHelpers'
import { runWithTelemetry, type ToolCallMeta } from '@/lib/mcp/telemetry'

export const maxDuration = 60

type AuthExtra = { userId: string; userEmail: string }
// The SDK types authInfo.extra as Record<string, unknown> | undefined (it can hold
// anything a verifyToken implementation puts there) — narrow it to our known shape
// at the point of use rather than widening the handler signature.
type ToolExtra = { authInfo?: { extra?: Record<string, unknown> } }

function json(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}

function authIdentity(extra: ToolExtra): AuthExtra {
  const id = extra.authInfo?.extra
  const userId = id?.userId
  const userEmail = id?.userEmail
  if (typeof userId !== 'string' || typeof userEmail !== 'string') {
    throw new Error('Missing authenticated user context.')
  }
  return { userId, userEmail }
}

const handler = createMcpHandler(
  server => {
    // Register every tool from the shared registry (lib/mcp/registry.ts). This route is a
    // thin adapter: it preserves the exact behavior each tool had when its definition lived
    // inline here — the logged() telemetry wrapper, json() wrapping, authIdentity(extra) → ctx,
    // per-tool meta attribution, and clean error handling. Confirmable tools still key off
    // args.confirm; append tools still commit directly. The in-app assistant reuses the same
    // TOOLS array behind its own (UI-gated) confirm flow.
    for (const t of TOOLS) {
      server.tool(
        t.name,
        t.description,
        t.schema,
        async (args, extra) => {
          const meta: ToolCallMeta = {}
          const userEmail = extra.authInfo?.extra?.userEmail as string | undefined
          return json(await runWithTelemetry(userEmail, t.name, () => t.handler(args, authIdentity(extra), meta), meta))
        }
      )
    }

    // -------- prompts (best-effort workflow starters; server.prompt is available on the
    // installed @modelcontextprotocol/sdk's McpServer as of this writing) --------

    server.prompt(
      'morning-pipeline-review',
      "Morning digest of my pipeline: overdue, due soon, and fielding behind pace.",
      async () => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: "Give me my morning pipeline review: call get_me, then pipeline_summary with mine:true. Summarize what's overdue, due within 3 days, and fielding behind pace among my projects, and flag anything that needs attention today.",
          },
        }],
      })
    )

    server.prompt(
      'log-blast',
      "Log this week's blast send for a project (asks for the numbers, previews before writing).",
      { project: z.string().describe('The project code or name to log a blast against') },
      async ({ project }) => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `I want to log a blast send for ${project}. Ask me for the number delivered, the $/bid used, and the blast fee if I haven't already given them, then call log_blast with a preview before confirming.`,
          },
        }],
      })
    )

    server.prompt(
      'create-from-brief',
      'Create a new project from a pasted client brief or email — extracts the fields and previews create_project.',
      { brief: z.string().describe('The client brief or email text to extract a project from') },
      async ({ brief }) => ({
        messages: [{
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Read this brief and set up a new project from it: extract the client, project name, project type, target N, due date, and requester if present. Call get_client_history for that client to fill in sensible defaults for anything the brief doesn't specify, then call create_project with a preview before confirming.\n\nBrief:\n${brief}`,
          },
        }],
      })
    )
  },
  { instructions: MCP_INSTRUCTIONS },
  { basePath: '/api', maxDuration: 60, verboseLogs: false, disableSse: true }
)

const authed = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    if (!bearerToken) return undefined
    const row = await findAccessToken(bearerToken)
    if (!row) return undefined
    // LIVE gate: never trust the denormalized snapshot on the token row.
    const admin = createAdminClient()
    const { data: profile, error } = await admin.from('profiles')
      .select('role, email').eq('id', row.user_id).maybeSingle()
    // A transient DB failure is not proof the user is gone — fail this request closed
    // (401) WITHOUT revoking, so a blip doesn't force a re-login.
    if (error) return undefined
    if (!profile || profile.role !== 'analyst' || !isAllowedEmail(profile.email)) {
      await revokeTokenById(row.id)
      return undefined
    }
    return {
      token: bearerToken, scopes: row.scope.split(' '), clientId: row.client_id,
      extra: { userId: row.user_id, userEmail: profile.email },
    }
  },
  { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' }
)

export { authed as GET, authed as POST }

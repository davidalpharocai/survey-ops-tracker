import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from 'mcp-handler'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { findAccessToken, revokeTokenById } from '@/lib/oauth/store'
import { baseUrl } from '@/lib/oauth/http'
import type { Database, Json } from '@/lib/supabase/types'
import * as data from '@/lib/mcp/data'
import {
  resolveProjectWritable, resolveStep, runAddStep, runCompleteStep, runEditStep, runProjectWrite,
} from '@/lib/mcp/writes'

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

/** Clean, user-safe error text. Never leak raw DB error internals to the model. */
function cleanErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/relation .* does not exist/i.test(raw) || /schema cache/i.test(raw)) {
    return 'The Survey Ops database tables for this feature are not set up yet — ask David to run migration 045.'
  }
  return 'Something went wrong handling that request. Please try again.'
}

/** A short, queryable failure category for mcp_tool_calls.error_code (never shown to the model). */
function errorCode(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  if (/stale_write/i.test(raw)) return 'stale_write'
  if (/relation .* does not exist/i.test(raw) || /schema cache/i.test(raw)) return 'missing_table'
  return 'unknown'
}

/**
 * Metadata a tool handler can attribute to its own mcp_tool_calls row. Declare an empty
 * object at the top of the handler and mutate it (e.g. `meta.project_id = p.id`) once the
 * target is resolved inside `fn` — `logged` reads whatever is on it after `fn` settles
 * (success or throw), so a failed write still gets attributed to the right project/client.
 */
type LoggedMeta = { project_id?: string; client_id?: string; detail?: unknown }

/**
 * Wraps a tool call: measures duration, logs to mcp_tool_calls (fire-and-forget,
 * never breaks the response, never logs argument payloads), and converts thrown
 * errors into a clean user-safe message.
 */
async function logged<T>(extra: ToolExtra, tool: string, fn: () => Promise<T>, meta?: LoggedMeta): Promise<T> {
  const start = Date.now()
  const userEmail = extra.authInfo?.extra?.userEmail as string | undefined
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

function logToolCall(
  userEmail: string | undefined, tool: string, durationMs: number, ok: boolean,
  meta?: LoggedMeta, err?: unknown
) {
  if (!userEmail) return
  const supabase = createAdminClient()
  const row: Database['public']['Tables']['mcp_tool_calls']['Insert'] = {
    user_email: userEmail, tool, duration_ms: durationMs, ok,
  }
  if (meta?.project_id) row.project_id = meta.project_id
  if (meta?.client_id) row.client_id = meta.client_id
  if (meta?.detail !== undefined) row.detail = meta.detail as Json
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
 * Preview-then-confirm gate for a mutating tool: `args.confirm !== true` runs `previewFn`
 * and wraps its result as `{ preview }` (no write); `confirm: true` runs `commitFn`.
 */
async function confirmable<P, C>(
  args: { confirm?: boolean },
  previewFn: () => Promise<P>,
  commitFn: () => Promise<C>
): Promise<{ preview: P } | C> {
  if (args.confirm !== true) return { preview: await previewFn() }
  return commitFn()
}

/** Best-effort document title lookup via the app's own /api/doc-title (Drive API, else a public scrape). */
async function fetchDocTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl()}/api/doc-title?url=${encodeURIComponent(url)}`)
    if (!res.ok) return null
    const body = (await res.json()) as { title?: string | null }
    return body.title ?? null
  } catch {
    return null
  }
}

const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const handler = createMcpHandler(
  server => {
    // -------- read tools --------

    server.tool(
      'search_projects',
      'Search survey projects by name/code/client with optional filters.',
      {
        query: z.string().optional(),
        status: z.enum(['Open', 'Hold', 'Closed']).optional(),
        phase: z.enum(['Scoping', 'Active']).optional(),
        captain: z.string().optional(),
        due_before: z.string().optional(),
        due_after: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      async (args, extra) => json(await logged(extra, 'search_projects', () => data.searchProjects(args)))
    )

    server.tool(
      'get_project',
      'Get full detail for one survey project by PR-code or name (bids, blasts, steps, activity, deliverables, segments, compliance, your reminders on it).',
      { project: z.string() },
      async (args, extra) => json(await logged(extra, 'get_project', async () => {
        const resolved = await data.resolveProject(args.project)
        if (resolved === null) return { error: `No project found matching "${args.project}".` }
        if ('ambiguous' in resolved) {
          return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
        }
        const { userId } = authIdentity(extra)
        return data.getProjectDetail(resolved.id as string, userId)
      }))
    )

    server.tool(
      'pipeline_summary',
      'Digest of the active pipeline: overdue, due within 3 days, fielding behind pace, plus counts by stage/status/phase.',
      {},
      async (_args, extra) => json(await logged(extra, 'pipeline_summary', () => data.pipelineSummary()))
    )

    server.tool(
      'search_clients',
      'Search clients by name or Cl-code.',
      { query: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      async (args, extra) => json(await logged(extra, 'search_clients', () => data.searchClients(args)))
    )

    server.tool(
      'get_client',
      'Get a client profile by Cl-code or name: contacts, notes, compliance settings, project list.',
      { client: z.string() },
      async (args, extra) => json(await logged(extra, 'get_client', async () => {
        const resolved = await data.resolveClient(args.client)
        if (resolved === null) return { error: `No client found matching "${args.client}".` }
        if ('ambiguous' in resolved) {
          return { note: 'Multiple clients match — specify the client code.', candidates: resolved.ambiguous }
        }
        return data.getClientDetail(resolved.id as string)
      }))
    )

    server.tool(
      'list_activity',
      'Recent logged activity (emails etc.), newest first, optionally scoped to one project.',
      { project: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
      async (args, extra) => json(await logged(extra, 'list_activity', async () => {
        let projectId: string | null = null
        if (args.project) {
          const resolved = await data.resolveProject(args.project)
          if (resolved === null) return { error: `No project found matching "${args.project}".` }
          if ('ambiguous' in resolved) {
            return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
          }
          projectId = resolved.id as string
        }
        return data.listActivity(projectId, args.limit ?? 20)
      }))
    )

    server.tool(
      'decode_survey_id',
      'Decode a Survey Ops survey ID into owner initials, client+project abbreviation, date, and region.',
      { id: z.string() },
      async (args, extra) => json(await logged(extra, 'decode_survey_id', async () => {
        const initials = await data.getTeamInitials()
        const decoded = data.decodeSurveyId(args.id, initials)
        if (!decoded) return { error: 'No 8-digit date found in that ID — cannot decode.' }
        return decoded
      }))
    )

    // -------- reminder tools (scoped to the authenticated user) --------

    server.tool(
      'create_reminder',
      'Create a personal reminder, optionally linked to a project. due_date must be YYYY-MM-DD.',
      { text: z.string().min(1).max(500), due_date: z.string(), project: z.string().optional() },
      async (args, extra) => json(await logged(extra, 'create_reminder', async () => {
        const { userId, userEmail } = authIdentity(extra)
        if (!DUE_DATE_RE.test(args.due_date)) {
          return { error: 'due_date must be in YYYY-MM-DD format.' }
        }
        const d = new Date(args.due_date + 'T00:00:00Z')
        if (d.toISOString().slice(0, 10) !== args.due_date) {
          return { error: 'due_date must be a valid date (YYYY-MM-DD).' }
        }
        let projectId: string | null = null
        if (args.project) {
          const resolved = await data.resolveProject(args.project)
          if (resolved === null) return { error: `No project found matching "${args.project}".` }
          if ('ambiguous' in resolved) {
            return { note: 'Multiple projects match — specify the project code. Reminder not created.', candidates: resolved.ambiguous }
          }
          projectId = resolved.id as string
        }
        const supabase = createAdminClient()
        const { data: row, error } = await supabase.from('reminders').insert({
          user_id: userId, user_email: userEmail, text: args.text,
          due_date: args.due_date, project_id: projectId,
        }).select().single()
        if (error) throw error
        return row
      }))
    )

    server.tool(
      'list_reminders',
      "List the caller's own reminders, soonest due first.",
      { include_done: z.boolean().optional() },
      async (args, extra) => json(await logged(extra, 'list_reminders', async () => {
        const { userId } = authIdentity(extra)
        const supabase = createAdminClient()
        let q = supabase.from('reminders').select('*').eq('user_id', userId)
        if (!args.include_done) q = q.eq('done', false)
        const { data: rows, error } = await q.order('due_date', { ascending: true })
        if (error) throw error
        return rows
      }))
    )

    server.tool(
      'complete_reminder',
      "Mark one of the caller's own reminders as done.",
      { id: z.string() },
      async (args, extra) => json(await logged(extra, 'complete_reminder', async () => {
        const { userId } = authIdentity(extra)
        const supabase = createAdminClient()
        const { data: rows, error } = await supabase.from('reminders')
          .update({ done: true, done_at: new Date().toISOString() })
          .eq('id', args.id).eq('user_id', userId).select()
        if (error) throw error
        if (!rows || rows.length === 0) return { error: 'Reminder not found or not yours.' }
        return rows[0]
      }))
    )

    server.tool(
      'delete_reminder',
      "Delete one of the caller's own reminders.",
      { id: z.string() },
      async (args, extra) => json(await logged(extra, 'delete_reminder', async () => {
        const { userId } = authIdentity(extra)
        const supabase = createAdminClient()
        const { data: rows, error } = await supabase.from('reminders')
          .delete().eq('id', args.id).eq('user_id', userId).select()
        if (error) throw error
        if (!rows || rows.length === 0) return { error: 'Reminder not found or not yours.' }
        return { deleted: true, id: args.id }
      }))
    )
  },
  {},
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

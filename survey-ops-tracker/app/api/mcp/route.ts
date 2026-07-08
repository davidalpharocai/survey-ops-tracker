import { createMcpHandler, experimental_withMcpAuth as withMcpAuth } from 'mcp-handler'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAllowedEmail } from '@/lib/utils/allowedDomain'
import { findAccessToken, revokeTokenById } from '@/lib/oauth/store'
import { baseUrl } from '@/lib/oauth/http'
import { getCheckboxesForColumn, STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import { complianceGate } from '@/lib/utils/compliance'
import { autoStamp } from '@/lib/utils/date'
import { normalizeClientText, firmNameFrom } from '@/lib/utils/clientName'
import { blastTotal } from '@/lib/utils/blast'
import type { Database, Json } from '@/lib/supabase/types'
import * as data from '@/lib/mcp/data'
import {
  resolveProjectWritable, resolveStep, resolveContact, loadGateInput,
  runAddStep, runCompleteStep, runEditStep, runProjectWrite, runSetBidBudget, runLogBlast,
  runRenameClient, runCreateProject,
  pickProjectPatch, diffSummary, stageColumnsFor,
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
    return "The Survey Ops database tables for this feature aren't set up yet — ask David to run the latest database migration in Supabase."
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

/** "n_target" -> "N target" — a generic, good-enough label for a diff line. */
function fieldLabel(field: string): string {
  const s = field.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function fmtChangeVal(v: unknown): string {
  return v === null || v === undefined || v === '' ? '—' : String(v)
}

/** {field:[old,new]} -> "N target 500 → 900; Due date 2026-07-01 → 2026-07-20". */
function describeChanges(changed: Record<string, [unknown, unknown]>): string {
  const entries = Object.entries(changed)
  if (entries.length === 0) return 'No changes.'
  return entries
    .map(([field, [oldV, newV]]) => `${fieldLabel(field)} ${fmtChangeVal(oldV)} → ${fmtChangeVal(newV)}`)
    .join('; ')
}

/** Today's date (YYYY-MM-DD) in the team's local timezone — matches the reminders-due cron. */
function todayEastern(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
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

const CLIENT_WRITE_FIELDS = [
  'compliance_before_fielding', 'compliance_after_fielding', 'compliance_contact', 'compliance_notes',
] as const

const CONTACT_WRITE_FIELDS = ['first_name', 'last_name', 'email', 'title', 'phone'] as const

/**
 * Server instructions (2nd `createMcpHandler` arg, `ServerOptions.instructions` from
 * `@modelcontextprotocol/sdk`) — surfaced to the model as system-level guidance for using
 * this connector well. See docs/superpowers/specs/2026-07-07-mcp-writes-phase2-design.md
 * ("Teaching Claude to use it well").
 */
const MCP_INSTRUCTIONS = `Survey Ops Command Center — connector guidance.

What counts as "open"/"due" (read first): a project's status is Open, Closed, or Hold (Hold = on hold/paused); its phase is Scoping (pre-sale) or Active (in operations); its board column runs Submitted → Doc Programming → Survey Programming → EdWin QA → Fielding → Data QA → Delivery (the last shows as "Delivered"). A project is open/active and can be "due" or "overdue" ONLY when status is Open AND phase is Active AND it is NOT in the Delivered column. NEVER describe a Closed, On-Hold, or Delivered project as due, overdue, due soon, open, or active — Closed and Delivered are finished; Hold is paused. A delivered project may still read status "Open" until someone closes it, so trust the board column. search_projects returns only active projects by default; pass active_only:false only to look up a specific or past/closed project. In pipeline_summary, only the overdue, due-soon, and fielding-behind LISTS are scoped to active work; its counts (by_status / by_phase / by_board_column) are a full breakdown that still includes On-Hold, Scoping, and Delivered — so never report counts.by_status.Open as the number of open/active projects. To count open/active work, use search_projects (active-scoped by default) and count the result.

Answer efficiently: answer in as FEW tool calls as possible — prefer one targeted call over several exploratory ones. For "how many/list <person>'s open/active projects" (e.g. "how many open surveys does Bryan have"), make ONE search_projects call with captain set to that person — active projects are returned by default, so don't pass a status — then count/list the result yourself. For closed or past projects, add active_only:false (plus status:'Closed' if you want only closed ones). Do NOT call get_me first (that's only for "me/my/mine"), and do NOT fetch each project's details just to count or list them. For pipeline/status/overview questions or "what's overdue," one pipeline_summary call is enough (add mine:true only for "my/me"). Only call get_project, get_client_history, or get_project_history when the user asks for specifics or history — never just to answer a simple count or list.

Before mutating: every create/update/status/stage tool follows preview-then-confirm — a call without confirm:true only returns a preview and never writes. Read the preview back to the user in plain language and get their explicit OK before calling again with confirm:true. Never set confirm:true unless the user has clearly approved the specific change shown in the preview.

Duplicates: create_project checks for likely duplicate projects and returns them instead of writing. Ask the user whether to proceed before retrying with proceed_despite_duplicate:true — don't assume they want to.

Creating a project — run an intake checklist. When asked to create/add a survey or project, make sure these are covered, asking for any the user hasn't given: client + project name (required); **captain (required)** — create_project refuses without a valid team member; project type (PS/B2B/Rerun); salesperson; requested-by (which client contact); due date; N target; audience size; budget; whether it's longitudinal (+ cadence); and **whether it's approved for the open pipeline or still in scoping**. For every item EXCEPT client/name/captain, always offer the user "Not sure / will fill it in later" — if they choose it, leave that field blank and move on; never nag or block on it.
- Captain not on the roster? Tell the user and OFFER to add them: with their approval, get the person's name + @alpharoc email and call add_team_member (preview → confirm), then create the project with that captain. Never invent a captain or leave one unassigned.
- Pipeline status: if the user hasn't said, ASK whether it's approved to move into the open pipeline (→ pass skip_scoping:true, starts Active/Submitted) or still in scoping / pre-sale (→ leave skip_scoping off; it defaults to Scoping / New Inquiry).
create_project itself takes client/project_name/project_type/captain/salesperson/due_date/n_target/skip_scoping; set the rest AFTER creating — audience size / budget / longitudinal via update_project, requested-by via set_requested_by, a bid budget via set_bid_budget. If the client has compliance requirements (visible via get_client), mention them. Read the assembled details back to the user, then create.

History & "what did we do last time": for "what did we do last time for <client>" or when planning a new project for a client you've served before, call get_client_history first — it returns past projects, derived patterns (typical N, common project type, typical fielding duration, cadence, recurring contacts), and any explicitly stated preferences. Use those patterns to offer sensible defaults when creating a new project for that client. get_project_history returns a project's sibling waves when it's part of a longitudinal/rerun series.

Questionnaire content: the actual questions asked live in Google Docs/Sheets, not this database. get_project and get_client_history return linked document URLs — hand those to the user's Drive connector if they ask what was asked last time, rather than guessing at question content.

Resolving "me"/"my": call get_me to resolve the caller's own name/initials/role, then pass mine:true to search_projects/pipeline_summary (or the resolved initials as captain) to answer "what's overdue for me" or "my projects."

Recording interactions: to log that something happened outside the app (e.g. "we emailed the client about timeline"), use add_note (project-scoped) or add_client_note (client-scoped) — there is deliberately no tool to write a project_activity entry directly.

Corrections: logged blasts and bids can't be edited or deleted via the connector. If a user needs to correct one, tell them to do it in the app.

Money idempotency: log_blast and set_bid_budget affect spend, so a retried confirm must not double-count. Pass a stable idem_key for each blast/bid you intend to log (e.g. derived from the conversation turn) and reuse that same idem_key if you retry the same confirm call — don't generate a new one on retry. Only use a different idem_key when the user genuinely means a new, separate blast or bid.

Segmented N: if update_project refuses because a project's N is segmented, don't try to work around it — tell the user to edit the segment breakdown in the app.

Learning preferences: if a user explicitly overrides a suggestion "going forward" (e.g. "always use PS not B2B for this client"), offer to save it with set_client_preference so it's visible to the whole team, not just remembered for this conversation.`

const handler = createMcpHandler(
  server => {
    // -------- read tools --------

    server.tool(
      'search_projects',
      'Search survey projects by name/code/client with optional filters. Returns only in-flight active projects by default (excludes Closed, On-Hold, Delivered, and pre-sale Scoping); pass active_only:false to search ALL projects regardless of status — e.g. to find a specific past or closed project. Pass mine:true to scope to your own captained projects.',
      {
        query: z.string().optional(),
        status: z.enum(['Open', 'Hold', 'Closed']).optional(),
        phase: z.enum(['Scoping', 'Active']).optional(),
        captain: z.string().optional(),
        due_before: z.string().optional(),
        due_after: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        mine: z.boolean().optional(),
        active_only: z.boolean().optional(),
      },
      async (args, extra) => json(await logged(extra, 'search_projects', () => {
        const { userId } = authIdentity(extra)
        return data.searchProjects({ ...args, userId })
      }))
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
      'Digest of the active pipeline — overdue, due within 3 days, and fielding behind pace, all limited to in-flight work (Closed, On-Hold, and Delivered projects are excluded) — plus counts by stage/status/phase. Pass mine:true to scope to your own captained projects.',
      { mine: z.boolean().optional() },
      async (args, extra) => json(await logged(extra, 'pipeline_summary', () => {
        const { userId } = authIdentity(extra)
        return data.pipelineSummary({ ...args, userId })
      }))
    )

    server.tool(
      'get_me',
      "Resolve the caller's own name, initials, and role — use this to answer 'me'/'my' questions (e.g. \"what's overdue for me\") before filtering other tools with mine:true or a captain name.",
      {},
      async (_args, extra) => json(await logged(extra, 'get_me', async () => {
        const { userId } = authIdentity(extra)
        const me = await data.getMe(userId)
        if (!me) {
          return { error: "Could not resolve your team-member record (profiles.email has no matching team_members row) — ask David to add you to Team Members." }
        }
        return me
      }))
    )

    server.tool(
      'get_client_history',
      'What did we do last time for this client? Past & current projects, derived patterns (typical N, common project type, avg fielding time, cadence, recurring contacts), and any stated preferences.',
      { client: z.string() },
      async (args, extra) => json(await logged(extra, 'get_client_history', () => data.getClientHistory(args.client)))
    )

    server.tool(
      'get_project_history',
      "A project's prior/sibling waves if it's part of a longitudinal/rerun series (key stats per wave, ordered).",
      { project: z.string() },
      async (args, extra) => json(await logged(extra, 'get_project_history', () => data.getProjectHistory(args.project)))
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
      'Recent logged activity (emails etc.), newest first, optionally scoped to one project. Returns snippets (not full bodies); pass `search` to find emails by text (subject/body/sender), then use get_email with an entry id for the full body.',
      { project: z.string().optional(), search: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
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
        return data.listActivity(projectId, args.limit ?? 20, args.search)
      }))
    )

    server.tool(
      'get_email',
      'Get the full body + participants of one logged activity entry (email) by its id (from list_activity).',
      { id: z.string() },
      async (args, extra) => json(await logged(extra, 'get_email', () => data.getActivityDetail(args.id)))
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

    // -------- write tools: append (add_next_step/complete_next_step/add_note/add_client_note
    // commit directly; edit_next_step/link_document preview-then-confirm) --------

    server.tool(
      'add_next_step',
      'Add a to-do/next step to a project.',
      { project: z.string(), text: z.string().min(1).max(1000) },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'add_next_step', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string
          const row = await runAddStep(p.id as string, args.text, userEmail.split('@')[0], `${userEmail} via Claude`)
          meta.detail = { created: { id: row.id, text: row.text } }
          return { ok: true, step: { id: row.id, text: row.text } }
        }, meta))
      }
    )

    server.tool(
      'complete_next_step',
      'Mark a project next step done or not done (mirrors the checkbox in the app).',
      { project: z.string(), step_ref: z.string(), done: z.boolean() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'complete_next_step', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string
          const step = await resolveStep(p.id as string, args.step_ref)
          if (!step) return { error: `No step found matching "${args.step_ref}" on this project.` }
          if ('ambiguous' in step) {
            return { note: 'Multiple steps match — be more specific.', candidates: step.ambiguous }
          }
          const row = await runCompleteStep(step.id as string, args.done, userEmail.split('@')[0], `${userEmail} via Claude`)
          meta.detail = { step_id: row.id, changed: { done: [step.done, row.done] } }
          return { ok: true, step: { id: row.id, text: row.text, done: row.done } }
        }, meta))
      }
    )

    server.tool(
      'edit_next_step',
      "Edit a project next step's text (preview first; confirm to apply).",
      { project: z.string(), step_ref: z.string(), text: z.string().min(1).max(1000), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'edit_next_step', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string
          const step = await resolveStep(p.id as string, args.step_ref)
          if (!step) return { error: `No step found matching "${args.step_ref}" on this project.` }
          if ('ambiguous' in step) {
            return { note: 'Multiple steps match — be more specific.', candidates: step.ambiguous }
          }
          return confirmable(
            args,
            async () => ({ summary: `"${step.text}" → "${args.text}"`, from: step.text as string, to: args.text }),
            async () => {
              const row = await runEditStep(step.id as string, args.text, `${userEmail} via Claude`)
              meta.detail = { step_id: row.id, changed: { text: [step.text, row.text] } }
              return { ok: true, step: { id: row.id, text: row.text } }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'add_note',
      'Log a manual data-change note on a project (paper trail of edits to the survey data).',
      { project: z.string(), text: z.string().min(1).max(2000) },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'add_note', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string
          const createdBy = userEmail.split('@')[0]
          const supabase = createAdminClient()
          const { data: row, error } = await supabase.from('project_data_changes')
            .insert({ project_id: p.id as string, text: args.text, created_by: createdBy })
            .select().single()
          if (error) throw error
          meta.detail = { created: { id: row.id, text: args.text } }
          return { ok: true, note: row }
        }, meta))
      }
    )

    server.tool(
      'add_client_note',
      'Add a dated note to a client profile.',
      { client: z.string(), text: z.string().min(1).max(2000) },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'add_client_note', async () => {
          const { userEmail } = authIdentity(extra)
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) {
            return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          }
          meta.client_id = c.id as string
          const createdBy = userEmail.split('@')[0]
          const supabase = createAdminClient()
          const { data: row, error } = await supabase.from('client_notes')
            .insert({ client_id: c.id as string, body: args.text, created_by: createdBy })
            .select().single()
          if (error) throw error
          meta.detail = { created: { id: row.id, body: args.text } }
          return { ok: true, note: row }
        }, meta))
      }
    )

    server.tool(
      'link_document',
      'Link a document (Google Doc/Sheet/Slides/Drive file, etc.) to a project (preview first; confirm to apply).',
      { project: z.string(), url: z.string().min(1), name: z.string().optional(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'link_document', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string
          const existing = (p.linked_documents as string[] | null) ?? []
          return confirmable(
            args,
            async () => {
              const title = await fetchDocTitle(args.url)
              const name = title ?? args.name ?? null
              return { summary: `Add "${name ?? args.url}" to linked documents`, name, url: args.url }
            },
            async () => {
              const title = await fetchDocTitle(args.url)
              const name = title ?? args.name ?? null
              const entry = name ? JSON.stringify({ name, url: args.url }) : args.url
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, {
                id: p.id as string,
                patch: { linked_documents: [...existing, entry] },
                actor: `${userEmail} via Claude`,
              })
              if ('error' in result) return result
              meta.detail = { added: { name, url: args.url } }
              return { ok: true, linked_documents: result.linked_documents }
            }
          )
        }, meta))
      }
    )

    // -------- write tools: field edits (preview-then-confirm) --------

    server.tool(
      'update_project',
      "Update a project's fields (preview first; confirm to apply).",
      {
        project: z.string(),
        fields: z.record(z.unknown()),
        confirm: z.boolean().optional(),
        expected_updated_at: z.string().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'update_project', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          const { patch, rejected } = pickProjectPatch(args.fields)
          if (rejected.length) {
            return {
              error: `These fields can't be set here: ${rejected.join(', ')}. Use the dedicated tools for status, stage, compliance override, requested-by, or linked documents.`,
            }
          }
          if (
            ('n_target' in patch || 'n_collected' in patch || 'n_actual' in patch) &&
            ((p.segment_count as number | null) ?? 0) > 0
          ) {
            return { error: "This project's N is segmented — edit the segments in the app." }
          }
          if ('client' in patch) patch.client = normalizeClientText(String(patch.client))
          if ('latest_next_steps' in patch) {
            patch.latest_next_steps = autoStamp(
              userEmail.split('@')[0],
              p.latest_next_steps as string | null,
              String(patch.latest_next_steps)
            )
          }

          const changed = diffSummary(p, patch)
          return confirmable(
            args,
            async () => ({
              project_code: p.project_code,
              changed,
              summary: describeChanges(changed),
              updated_at: p.updated_at,
            }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, {
                id: p.id as string,
                patch,
                actor: `${userEmail} via Claude`,
                expectedUpdatedAt: args.expected_updated_at,
              })
              if ('error' in result) return result
              meta.detail = { changed }
              return { ok: true, project_code: result.project_code, changed }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'set_requested_by',
      "Set who requested a project, from among the project's client's contacts (preview first; confirm to apply).",
      { project: z.string(), contact_ref: z.string(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'set_requested_by', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          const clientId = p.client_id as string | null
          if (!clientId) return { error: 'This project has no linked client yet — cannot set requested-by.' }

          const contact = await resolveContact(clientId, args.contact_ref)
          if (!contact) return { error: `No contact found matching "${args.contact_ref}" for this project's client.` }
          if ('ambiguous' in contact) {
            return { note: 'Multiple contacts match — be more specific.', candidates: contact.ambiguous }
          }
          const name = `${String(contact.first_name)} ${String(contact.last_name)}`

          return confirmable(
            args,
            async () => ({ summary: `Requested by → ${name}`, contact_id: contact.id, name, updated_at: p.updated_at }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, {
                id: p.id as string,
                patch: { requested_by_contact_id: contact.id as string, requested_by_name: name },
                actor: `${userEmail} via Claude`,
              })
              if ('error' in result) return result
              meta.detail = { requested_by: { contact_id: contact.id, name } }
              return { ok: true, project_code: result.project_code, requested_by_name: result.requested_by_name }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'set_bid_budget',
      'Log a new allowed $/bid for a project — the most recent entry is the current bid budget (preview first; confirm to apply).',
      {
        project: z.string(),
        amount: z.number().positive(),
        note: z.string().max(1000).optional(),
        confirm: z.boolean().optional(),
        idem_key: z.string().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'set_bid_budget', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          return confirmable(
            args,
            async () => ({
              summary: `New bid budget: $${args.amount}${args.note ? ` (${args.note})` : ''}`,
              amount: args.amount, note: args.note ?? null,
            }),
            async () => {
              const row = await runSetBidBudget({
                projectId: p.id as string, amount: args.amount, note: args.note ?? null,
                createdBy: userEmail.split('@')[0], idemKey: args.idem_key ?? randomUUID(),
                actor: `${userEmail} via Claude`,
              })
              meta.detail = { created: { id: row.id, amount: row.amount, note: row.note } }
              return { ok: true, bid: { id: row.id, amount: row.amount, note: row.note } }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'log_blast',
      'Log a blast send (# delivered, $/bid used, fixed blast fee) against a project (preview first; confirm to apply).',
      {
        project: z.string(),
        delivered: z.number().int().min(0),
        bid: z.number().min(0),
        blast_cost: z.number().min(0),
        note: z.string().max(1000).optional(),
        confirm: z.boolean().optional(),
        idem_key: z.string().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'log_blast', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          const thisBlastTotal = blastTotal({ delivered: args.delivered, bid: args.bid, blast_cost: args.blast_cost })
          const currentSpend = (p.actual_spend as number | null) ?? 0
          const projectedSpend = currentSpend + thisBlastTotal

          return confirmable(
            args,
            async () => ({
              summary: `Log blast: ${args.delivered} delivered @ $${args.bid} + $${args.blast_cost} blast fee → projected spend $${projectedSpend}`,
              delivered: args.delivered, bid: args.bid, blast_cost: args.blast_cost,
              projected_actual_spend: projectedSpend,
            }),
            async () => {
              const row = await runLogBlast({
                projectId: p.id as string, delivered: args.delivered, bid: args.bid, blastCost: args.blast_cost,
                note: args.note ?? null, createdBy: userEmail.split('@')[0], idemKey: args.idem_key ?? randomUUID(),
                actor: `${userEmail} via Claude`,
              })
              meta.detail = { created: { id: row.id, delivered: row.delivered, bid: row.bid, blast_cost: row.blast_cost } }
              return { ok: true, blast: { id: row.id, delivered: row.delivered, bid: row.bid, blast_cost: row.blast_cost } }
            }
          )
        }, meta))
      }
    )

    // -------- write tools: status / stage (preview-then-confirm + compliance gate) --------

    server.tool(
      'advance_project',
      'Move an Active project to a pipeline column, or mark it delivered (preview first; confirm to apply). Enforces the compliance gate.',
      {
        project: z.string(),
        to_column: z.string().optional(),
        mark_delivered: z.boolean().optional(),
        override_reason: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'advance_project', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          if (p.phase !== 'Active') {
            return { error: 'This project is still in Scoping — approve it first (approve_scoping).' }
          }
          if (args.to_column && args.mark_delivered) {
            return { error: 'Specify either to_column or mark_delivered, not both.' }
          }
          if (!args.to_column && !args.mark_delivered) {
            return { error: 'Specify to_column (a pipeline column) or mark_delivered:true.' }
          }
          if (args.to_column && !STAGE_ORDER.includes(args.to_column as BoardColumn)) {
            return { error: `"${args.to_column}" is not a valid pipeline column. Valid columns: ${STAGE_ORDER.join(', ')}.` }
          }

          const stage = stageColumnsFor({ toColumn: args.to_column as BoardColumn, markDelivered: args.mark_delivered })
          const willMarkDelivered = !!args.mark_delivered && !p.stage_delivery
          const gi = await loadGateInput(p.id as string)
          const gate = complianceGate({
            targetColumn: stage.board_column, willMarkDelivered,
            client: gi.client, override: gi.override, submissions: gi.submissions,
          })
          if (gate.blocked && !args.override_reason) return { blocked: true, reason: gate.message }

          const patch: Record<string, unknown> = { ...stage }
          if (gate.blocked && args.override_reason) {
            patch.latest_next_steps = autoStamp(
              userEmail.split('@')[0],
              p.latest_next_steps as string | null,
              `⚠ Compliance override (${gate.phase}): ${args.override_reason}`
            )
          }

          return confirmable(
            args,
            async () => ({
              project_code: p.project_code, to: stage.board_column, delivered: willMarkDelivered,
              override: gate.blocked ? args.override_reason ?? null : null, updated_at: p.updated_at,
            }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, { id: p.id as string, patch, actor: `${userEmail} via Claude` })
              if ('error' in result) return result
              meta.detail = {
                to_column: result.board_column, delivered: willMarkDelivered,
                override_reason: gate.blocked ? args.override_reason ?? null : null,
              }
              return { ok: true, project_code: result.project_code, board_column: result.board_column }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'set_project_status',
      "Set a project's status — Open, Hold, or Closed (preview first; confirm to apply).",
      { project: z.string(), status: z.enum(['Open', 'Hold', 'Closed']), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'set_project_status', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          return confirmable(
            args,
            async () => ({ summary: `Status ${fmtChangeVal(p.status)} → ${args.status}`, from: p.status, to: args.status, updated_at: p.updated_at }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, { id: p.id as string, patch: { status: args.status }, actor: `${userEmail} via Claude` })
              if ('error' in result) return result
              meta.detail = { changed: { status: [p.status, result.status] } }
              return { ok: true, project_code: result.project_code, status: result.status }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'approve_scoping',
      'Approve a Scoping project into the Active pipeline at Submitted (preview first; confirm to apply).',
      { project: z.string(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'approve_scoping', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          if (p.phase !== 'Scoping') return { error: 'This project is already Active.' }

          const submittedDate = todayEastern()
          const patch: Record<string, unknown> = {
            phase: 'Active', board_column: 'Submitted', submitted_date: submittedDate,
            ...getCheckboxesForColumn('Submitted'),
          }

          return confirmable(
            args,
            async () => ({ summary: `Approve "${p.project_name}" into Active / Submitted`, submitted_date: submittedDate, updated_at: p.updated_at }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, { id: p.id as string, patch, actor: `${userEmail} via Claude` })
              if ('error' in result) return result
              meta.detail = { approved: { submitted_date: submittedDate } }
              return { ok: true, project_code: result.project_code, phase: result.phase, board_column: result.board_column }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'move_to_scoping',
      'Move an Active project back into Scoping (preview first; confirm to apply). Leaves board_column and stage checkboxes untouched.',
      { project: z.string(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'move_to_scoping', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          if (p.phase !== 'Active') return { error: 'This project is already in Scoping.' }

          const scopingStage = (p.scoping_stage as string | null) ?? 'Awaiting Approval'
          const patch = { phase: 'Scoping', scoping_stage: scopingStage }

          return confirmable(
            args,
            async () => ({ summary: `Move "${p.project_name}" back to Scoping (${scopingStage})`, updated_at: p.updated_at }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, { id: p.id as string, patch, actor: `${userEmail} via Claude` })
              if ('error' in result) return result
              meta.detail = { changed: { phase: [p.phase, result.phase], scoping_stage: [p.scoping_stage, result.scoping_stage] } }
              return { ok: true, project_code: result.project_code, phase: result.phase, scoping_stage: result.scoping_stage }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'set_compliance_override',
      "Override a project's compliance requirement — on, off, or auto (client default) — with a reason (preview first; confirm to apply).",
      {
        project: z.string(),
        value: z.enum(['on', 'off', 'auto']),
        reason: z.string().min(1).max(1000),
        confirm: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'set_compliance_override', async () => {
          const { userEmail } = authIdentity(extra)
          const p = await resolveProjectWritable(args.project)
          if (!p) return { error: 'Project not found.' }
          if ('error' in p) return p
          if ('ambiguous' in p) return p
          meta.project_id = p.id as string

          const overrideValue = args.value === 'on' ? true : args.value === 'off' ? false : null
          const patch = {
            compliance_override: overrideValue,
            latest_next_steps: autoStamp(
              userEmail.split('@')[0],
              p.latest_next_steps as string | null,
              `Compliance override → ${args.value}: ${args.reason}`
            ),
          }

          return confirmable(
            args,
            async () => ({ summary: `Compliance override → ${args.value} (${args.reason})`, updated_at: p.updated_at }),
            async () => {
              const supabase = createAdminClient()
              const result = await runProjectWrite(supabase, { id: p.id as string, patch, actor: `${userEmail} via Claude` })
              if ('error' in result) return result
              meta.detail = { compliance_override: overrideValue, reason: args.reason }
              return { ok: true, project_code: result.project_code, compliance_override: result.compliance_override }
            }
          )
        }, meta))
      }
    )

    // -------- write tools: client & contact (preview-then-confirm) --------

    server.tool(
      'update_client',
      "Update a client's compliance settings (preview first; confirm to apply). Use rename_client to change the name.",
      { client: z.string(), fields: z.record(z.unknown()), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'update_client', async () => {
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          if ('name' in args.fields) {
            return { error: "Client name can't be changed here — use rename_client instead." }
          }

          const allow = new Set<string>(CLIENT_WRITE_FIELDS)
          const patch: Record<string, unknown> = {}
          const rejected: string[] = []
          for (const k of Object.keys(args.fields)) {
            if (allow.has(k)) patch[k] = args.fields[k]
            else rejected.push(k)
          }
          if (rejected.length) {
            return { error: `These fields can't be set here: ${rejected.join(', ')}.` }
          }

          const changed = diffSummary(c, patch)

          return confirmable(
            args,
            async () => ({ summary: describeChanges(changed), changed }),
            async () => {
              const supabase = createAdminClient()
              const { data: row, error } = await supabase.from('clients')
                .update(patch as Database['public']['Tables']['clients']['Update'])
                .eq('id', c.id as string).select().single()
              if (error) throw error
              meta.detail = { changed }
              return { ok: true, client: { id: row.id, name: row.name }, changed }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'rename_client',
      "Rename a client and keep every one of its projects' denormalized client text in sync (preview first; confirm to apply).",
      { client: z.string(), new_name: z.string().min(1), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'rename_client', async () => {
          const { userEmail } = authIdentity(extra)
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          const newName = args.new_name.trim()
          if (!newName) return { error: 'new_name is required.' }

          const supabase = createAdminClient()
          const { count, error: countErr } = await supabase.from('survey_projects')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', c.id as string).is('deleted_at', null)
          if (countErr) throw countErr

          return confirmable(
            args,
            async () => ({
              summary: `Rename "${String(c.name)}" → "${newName}" (${count ?? 0} project${count === 1 ? '' : 's'} will update)`,
              from: c.name, to: newName, projects_affected: count ?? 0,
            }),
            async () => {
              await runRenameClient(c.id as string, newName, `${userEmail} via Claude`)
              meta.detail = { changed: { name: [c.name, newName] }, projects_affected: count ?? 0 }
              return { ok: true, client: { id: c.id, name: newName }, projects_affected: count ?? 0 }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'create_client',
      'Create a new client (preview first; confirm to apply). If a client with that name already exists, returns it instead of creating a duplicate.',
      {
        name: z.string().min(1),
        compliance_before_fielding: z.boolean().optional(),
        compliance_after_fielding: z.boolean().optional(),
        compliance_contact: z.string().optional(),
        compliance_notes: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'create_client', async () => {
          const firmName = firmNameFrom(args.name)
          if (!firmName) return { error: 'name is required.' }

          const supabase = createAdminClient()
          const { data: existing, error: exErr } = await supabase.from('clients')
            .select('*').eq('name', firmName).maybeSingle()
          if (exErr) throw exErr
          if (existing) meta.client_id = existing.id as string

          return confirmable(
            args,
            async () => existing
              ? {
                  summary: `A client named "${firmName}" already exists — no new client will be created.`,
                  existing: true, client: { id: existing.id, code: existing.code, name: existing.name },
                }
              : { summary: `Create client "${firmName}"`, existing: false, name: firmName },
            async () => {
              if (existing) {
                return { ok: true, existing: true, client: { id: existing.id, code: existing.code, name: existing.name } }
              }
              const insert: Record<string, unknown> = { name: firmName }
              if (args.compliance_before_fielding !== undefined) insert.compliance_before_fielding = args.compliance_before_fielding
              if (args.compliance_after_fielding !== undefined) insert.compliance_after_fielding = args.compliance_after_fielding
              if (args.compliance_contact !== undefined) insert.compliance_contact = args.compliance_contact
              if (args.compliance_notes !== undefined) insert.compliance_notes = args.compliance_notes
              const { data: row, error } = await supabase.from('clients')
                .insert(insert as Database['public']['Tables']['clients']['Insert'])
                .select().single()
              if (error) throw error
              meta.client_id = row.id as string
              meta.detail = { created: { id: row.id, name: row.name } }
              return { ok: true, existing: false, client: { id: row.id, code: row.code, name: row.name } }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'add_contact',
      'Add a contact to a client (preview first; confirm to apply).',
      {
        client: z.string(), first_name: z.string(), last_name: z.string(),
        email: z.string().optional(), title: z.string().optional(), phone: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'add_contact', async () => {
          const { userEmail } = authIdentity(extra)
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          const firstName = args.first_name.trim()
          const lastName = args.last_name.trim()
          if (!firstName || !lastName) return { error: 'first_name and last_name are both required.' }
          const t = (s?: string) => (s && s.trim() ? s.trim() : null)
          const email = t(args.email)
          const title = t(args.title)
          const phone = t(args.phone)

          return confirmable(
            args,
            async () => ({
              summary: `Add contact "${firstName} ${lastName}" to ${String(c.name)}`,
              first_name: firstName, last_name: lastName, email, title, phone,
            }),
            async () => {
              const supabase = createAdminClient()
              const { data: row, error } = await supabase.from('client_contacts').insert({
                client_id: c.id as string, first_name: firstName, last_name: lastName,
                email, title, phone, created_by: userEmail.split('@')[0],
              }).select().single()
              if (error) throw error
              meta.detail = { created: { id: row.id, first_name: row.first_name, last_name: row.last_name } }
              return {
                ok: true,
                contact: { id: row.id, first_name: row.first_name, last_name: row.last_name, email: row.email, title: row.title, phone: row.phone },
              }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'edit_contact',
      "Edit a client contact's fields (preview first; confirm to apply).",
      { client: z.string(), contact_ref: z.string(), fields: z.record(z.unknown()), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'edit_contact', async () => {
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          const contact = await resolveContact(c.id as string, args.contact_ref)
          if (!contact) return { error: `No contact found matching "${args.contact_ref}" for this client.` }
          if ('ambiguous' in contact) return { note: 'Multiple contacts match — be more specific.', candidates: contact.ambiguous }

          const allow = new Set<string>(CONTACT_WRITE_FIELDS)
          const patch: Record<string, unknown> = {}
          const rejected: string[] = []
          for (const k of Object.keys(args.fields)) {
            if (allow.has(k)) patch[k] = args.fields[k]
            else rejected.push(k)
          }
          if (rejected.length) {
            return { error: `These fields can't be set here: ${rejected.join(', ')}.` }
          }

          const changed = diffSummary(contact, patch)

          return confirmable(
            args,
            async () => ({ summary: describeChanges(changed), changed }),
            async () => {
              const supabase = createAdminClient()
              const { data: row, error } = await supabase.from('client_contacts')
                .update(patch as Database['public']['Tables']['client_contacts']['Update'])
                .eq('id', contact.id as string).select().single()
              if (error) throw error
              meta.detail = { contact_id: row.id, changed }
              return {
                ok: true,
                contact: { id: row.id, first_name: row.first_name, last_name: row.last_name, email: row.email, title: row.title, phone: row.phone },
              }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'archive_contact',
      'Archive or unarchive a client contact (preview first; confirm to apply).',
      { client: z.string(), contact_ref: z.string(), archived: z.boolean(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'archive_contact', async () => {
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          const contact = await resolveContact(c.id as string, args.contact_ref, true)
          if (!contact) return { error: `No contact found matching "${args.contact_ref}" for this client.` }
          if ('ambiguous' in contact) return { note: 'Multiple contacts match — be more specific.', candidates: contact.ambiguous }

          return confirmable(
            args,
            async () => ({ summary: `${args.archived ? 'Archive' : 'Unarchive'} "${String(contact.first_name)} ${String(contact.last_name)}"` }),
            async () => {
              const supabase = createAdminClient()
              const { data: row, error } = await supabase.from('client_contacts')
                .update({ archived: args.archived }).eq('id', contact.id as string).select().single()
              if (error) throw error
              meta.detail = { contact_id: row.id, changed: { archived: [contact.archived, row.archived] } }
              return { ok: true, contact: { id: row.id, first_name: row.first_name, last_name: row.last_name, archived: row.archived } }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'set_client_preference',
      'Save a stated client preference as a tagged, searchable client note (preview first; confirm to apply).',
      { client: z.string(), preference: z.string().min(1), reason: z.string().optional(), confirm: z.boolean().optional() },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'set_client_preference', async () => {
          const { userEmail } = authIdentity(extra)
          const c = await data.resolveClient(args.client)
          if (c === null) return { error: `No client found matching "${args.client}".` }
          if ('ambiguous' in c) return { note: 'Multiple clients match — specify the client code.', candidates: c.ambiguous }
          meta.client_id = c.id as string

          const body = `PREF: ${args.preference}${args.reason ? ` — ${args.reason}` : ''}`

          return confirmable(
            args,
            async () => ({ summary: body }),
            async () => {
              const supabase = createAdminClient()
              const { data: row, error } = await supabase.from('client_notes')
                .insert({ client_id: c.id as string, body, created_by: userEmail.split('@')[0] })
                .select().single()
              if (error) throw error
              meta.detail = { created: { id: row.id, body: row.body } }
              return { ok: true, note: { id: row.id, body: row.body } }
            }
          )
        }, meta))
      }
    )

    // -------- write tools: create_project (conversational duplicate handling) --------

    server.tool(
      'create_project',
      'Create a new survey project (preview first; confirm to apply). Warns about possible duplicate projects before creating.',
      {
        project_name: z.string(),
        client: z.string(),
        project_type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
        captain: z.string().optional(),
        salesperson: z.string().optional(),
        due_date: z.string().optional(),
        n_target: z.number().int().positive().optional(),
        skip_scoping: z.boolean().optional(),
        confirm: z.boolean().optional(),
        proceed_despite_duplicate: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'create_project', async () => {
          const { userEmail } = authIdentity(extra)

          const projectName = args.project_name.trim()
          const clientText = args.client.trim()
          if (!projectName || !clientText) return { error: 'project_name and client are both required.' }
          if (args.due_date && !DUE_DATE_RE.test(args.due_date)) {
            return { error: 'due_date must be in YYYY-MM-DD format.' }
          }

          const supabase = createAdminClient()

          // Captain is REQUIRED for connector-created projects. Resolve the name/
          // initials to a team member; if absent or unmatched, block (on preview AND
          // confirm) and ask — nothing is allowed to land unassigned.
          let captainId: string | null = null
          {
            const { data: members, error: memErr } = await supabase.from('team_members').select('id, name, initials')
            if (memErr) throw memErr
            const s = (args.captain ?? '').trim().toLowerCase()
            const match = s
              ? ((members ?? []).find(m => m.initials.toLowerCase() === s) ??
                 (members ?? []).find(m => m.name.toLowerCase() === s) ??
                 (members ?? []).find(m => m.name.toLowerCase().includes(s)))
              : undefined
            if (match) captainId = match.id
            else {
              return {
                needs: 'captain',
                message: args.captain
                  ? `"${args.captain}" isn't on the team roster. A captain is required — pick one below, or (with the user's OK) add them first via add_team_member using their name + @alpharoc email, then retry.`
                  : 'A captain is required — who is running this project? (name or initials). If they are not on the roster, offer to add them via add_team_member (needs their @alpharoc email).',
                valid_captains: (members ?? []).map(m => ({ name: m.name, initials: m.initials })),
              }
            }
          }

          // Duplicate check: same client firm, or a similarly-named project already on file.
          const firm = firmNameFrom(clientText)
          const sFirm = data.sanitizeQuery(firm)
          const sName = data.sanitizeQuery(projectName)
          const { data: dupRows, error: dupErr } = await supabase.from('survey_projects')
            .select('project_code, project_name, client')
            .is('deleted_at', null)
            .or(`client.ilike.%${sFirm}%,project_name.ilike.%${sName}%`)
            .limit(10)
          if (dupErr) throw dupErr
          if (dupRows && dupRows.length > 0 && args.proceed_despite_duplicate !== true) {
            return {
              possible_duplicates: dupRows.map(d => ({ project_code: d.project_code, project_name: d.project_name, client: d.client })),
              needs: 'proceed_despite_duplicate',
              message: 'There is already a project under this client that looks like a possible duplicate.',
            }
          }

          const patch: Record<string, unknown> = {
            project_name: projectName,
            client: normalizeClientText(clientText),
          }
          if (args.project_type) patch.project_type = args.project_type
          if (captainId) patch.captain_id = captainId
          if (args.salesperson) patch.salesperson = args.salesperson
          if (args.due_date) patch.due_date = args.due_date
          if (args.n_target !== undefined) patch.n_target = args.n_target
          if (args.skip_scoping) {
            patch.phase = 'Active'
            patch.board_column = 'Submitted'
            patch.submitted_date = todayEastern()
          }

          return confirmable(
            args,
            async () => ({
              summary: `Create "${projectName}" for ${normalizeClientText(clientText)}${args.skip_scoping ? ' (skip scoping — Active/Submitted)' : ''}`,
              fields: patch,
              duplicate_warning: dupRows && dupRows.length > 0
                ? `${dupRows.length} similar project(s) already exist for this client/name — proceeding anyway.`
                : null,
            }),
            async () => {
              const row = await runCreateProject(patch, `${userEmail} via Claude`)
              meta.project_id = row.id
              if (row.client_id) meta.client_id = row.client_id
              meta.detail = { created: { project_code: row.project_code, project_name: row.project_name, client: row.client } }
              return {
                ok: true, project_code: row.project_code, id: row.id,
                client: row.client, client_id: row.client_id, phase: row.phase, board_column: row.board_column,
              }
            }
          )
        }, meta))
      }
    )

    server.tool(
      'add_team_member',
      "Add a new team member to the roster (e.g. a captain not yet listed). Preview first; confirm to apply. Needs the person's name and @alpharoc email; initials are derived if not given. Only add someone the user has explicitly approved adding.",
      {
        name: z.string(),
        email: z.string(),
        initials: z.string().optional(),
        confirm: z.boolean().optional(),
      },
      async (args, extra) => {
        const meta: LoggedMeta = {}
        return json(await logged(extra, 'add_team_member', async () => {
          const name = args.name.trim()
          const email = args.email.trim().toLowerCase()
          if (!name || !email) return { error: 'name and email are both required.' }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'A valid email is required to add a team member.' }
          const deriveInitials = (n: string): string => {
            const parts = n.split(/\s+/).filter(Boolean)
            if (parts.length === 0) return ''
            if (parts.length === 1) return parts[0].slice(0, 2)
            return parts[0][0] + parts[parts.length - 1][0]
          }
          const initials = (args.initials?.trim() || deriveInitials(name)).toUpperCase()
          if (!/^[A-Z0-9]{1,6}$/.test(initials)) {
            return { needs: 'initials', message: 'Could not derive valid initials — provide initials explicitly (letters/digits, up to 6).' }
          }
          const supabase = createAdminClient()
          const { data: dupEmail } = await supabase.from('team_members').select('name, initials').eq('email', email).maybeSingle()
          if (dupEmail) {
            return { already_exists: true, message: `${dupEmail.name} (${dupEmail.initials}) is already on the roster with that email — use them as the captain (no need to add).`, name: dupEmail.name, initials: dupEmail.initials }
          }
          const { data: dupInit } = await supabase.from('team_members').select('name').eq('initials', initials).maybeSingle()
          if (dupInit) {
            return { needs: 'initials', message: `Initials "${initials}" are already taken (by ${dupInit.name}). Provide different initials.` }
          }
          return confirmable(
            args,
            async () => ({ summary: `Add team member ${name} — ${initials} · ${email}`, fields: { name, initials, email } }),
            async () => {
              const { data: row, error } = await supabase.from('team_members').insert({ name, initials, email }).select('id, name, initials').single()
              if (error) {
                if (error.code === '23505') return { error: 'A team member with that email or initials already exists.' }
                throw error
              }
              meta.detail = { created_team_member: { id: row.id, name: row.name, initials: row.initials } }
              return { ok: true, id: row.id, name: row.name, initials: row.initials }
            }
          )
        }, meta))
      }
    )

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

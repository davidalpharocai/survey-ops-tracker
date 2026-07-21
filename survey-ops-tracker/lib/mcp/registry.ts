import 'server-only'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCheckboxesForColumn, STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import { complianceGate } from '@/lib/utils/compliance'
import { autoStamp } from '@/lib/utils/date'
import { normalizeClientText, firmNameFrom } from '@/lib/utils/clientName'
import { blastTotal } from '@/lib/utils/blast'
import type { Database } from '@/lib/supabase/types'
import * as data from '@/lib/mcp/data'
import {
  resolveProjectWritable, resolveStep, resolveContact, resolveSegment, loadGateInput,
  runAddStep, runCompleteStep, runEditStep, runProjectWrite, runLogBlast,
  runAddSegment, runUpdateSegment, runRemoveSegment,
  runRenameClient, runCreateProject,
  pickProjectPatch, diffSummary, stageColumnsFor,
} from '@/lib/mcp/writes'
import { cloneProject } from '@/lib/server/clone'
import {
  confirmable, describeChanges, fmtChangeVal, todayEastern, fetchDocTitle,
  DUE_DATE_RE, CLIENT_WRITE_FIELDS, CONTACT_WRITE_FIELDS,
} from '@/lib/mcp/toolHelpers'

/**
 * Shared tool registry — the single source of truth for the ~38 read/write tools exposed
 * by BOTH the MCP connector (app/api/mcp/route.ts, a thin adapter over this array) and the
 * in-app assistant. Each tool body is byte-for-byte the same code that previously ran inline
 * in the MCP route; the only change is that handlers receive `ctx` (in place of the old
 * `authIdentity(extra)` call) and mutate the passed-in `meta` (for mcp_tool_calls attribution).
 */

/** The authenticated caller. In the connector this comes from the OAuth token's `extra`;
 *  in-app it comes from the Supabase session. Both carry the same two values. */
export type ToolCtx = { userId: string; userEmail: string }

/** Metadata a handler attributes to its own mcp_tool_calls row. Handlers mutate the passed-in
 *  object (e.g. `meta.project_id = p.id`) once the target is resolved; the telemetry wrapper
 *  reads whatever is on it after the handler settles (success or throw). */
export type ToolMeta = { project_id?: string; client_id?: string; detail?: unknown }

export interface AssistantTool {
  name: string
  description: string
  schema: z.ZodRawShape
  kind: 'read' | 'write'
  /** For write tools that lack an internal confirm/preview path (append/direct-commit tools),
   *  a one-line human summary of what committing will do (used by the in-app confirm UI). */
  previewSummary?: (args: Record<string, unknown>) => string
  handler: (args: Record<string, unknown>, ctx: ToolCtx, meta: ToolMeta) => Promise<unknown>
}

export const TOOLS: AssistantTool[] = [
  // -------------------------------------------------------------------------
  // read tools
  // -------------------------------------------------------------------------
  {
    name: 'search_projects',
    description:
      'Search survey projects by name/code/client with optional filters. Returns only in-flight active projects by default (excludes Closed, On-Hold, Delivered, and pre-sale Scoping); pass active_only:false to search ALL projects regardless of status — e.g. to find a specific past or closed project. Pass mine:true to scope to your own captained projects.',
    kind: 'read',
    schema: {
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
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as {
        query?: string; status?: 'Open' | 'Hold' | 'Closed'; phase?: 'Scoping' | 'Active'
        captain?: string; due_before?: string; due_after?: string; limit?: number
        mine?: boolean; active_only?: boolean
      }
      const { userId } = ctx
      return data.searchProjects({ ...args, userId })
    },
  },
  {
    name: 'get_project',
    description:
      'Get full detail for one survey project by PR-code or name (bids, blasts, steps, activity, deliverables, segments, compliance, your reminders on it).',
    kind: 'read',
    schema: { project: z.string() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { project: string }
      const resolved = await data.resolveProject(args.project)
      if (resolved === null) return { error: `No project found matching "${args.project}".` }
      if ('ambiguous' in resolved) {
        return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
      }
      const { userId } = ctx
      return data.getProjectDetail(resolved.id as string, userId)
    },
  },
  {
    name: 'pipeline_summary',
    description:
      'Digest of the active pipeline — overdue, due within 3 days, and fielding behind pace, all limited to in-flight work (Closed, On-Hold, and Delivered projects are excluded) — plus counts by stage/status/phase. Pass mine:true to scope to your own captained projects.',
    kind: 'read',
    schema: { mine: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { mine?: boolean }
      const { userId } = ctx
      return data.pipelineSummary({ ...args, userId })
    },
  },
  {
    name: 'get_me',
    description:
      "Resolve the caller's own name, initials, and role — use this to answer 'me'/'my' questions (e.g. \"what's overdue for me\") before filtering other tools with mine:true or a captain name.",
    kind: 'read',
    schema: {},
    handler: async (_rawArgs, ctx) => {
      const { userId } = ctx
      const me = await data.getMe(userId)
      if (!me) {
        return { error: "Could not resolve your team-member record (profiles.email has no matching team_members row) — ask David to add you to Team Members." }
      }
      return me
    },
  },
  {
    name: 'get_client_history',
    description:
      'What did we do last time for this client? Past & current projects, derived patterns (typical N, common project type, avg fielding time, cadence, recurring contacts), and any stated preferences.',
    kind: 'read',
    schema: { client: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { client: string }
      return data.getClientHistory(args.client)
    },
  },
  {
    name: 'get_project_history',
    description:
      "A project's prior/sibling waves if it's part of a longitudinal/rerun series (key stats per wave, ordered).",
    kind: 'read',
    schema: { project: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { project: string }
      return data.getProjectHistory(args.project)
    },
  },
  {
    name: 'search_clients',
    description: 'Search clients by name or Cl-code.',
    kind: 'read',
    schema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: async (rawArgs) => {
      const args = rawArgs as { query?: string; limit?: number }
      return data.searchClients(args)
    },
  },
  {
    name: 'get_client',
    description: 'Get a client profile by Cl-code or name: contacts, notes, compliance settings, project list.',
    kind: 'read',
    schema: { client: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { client: string }
      const resolved = await data.resolveClient(args.client)
      if (resolved === null) return { error: `No client found matching "${args.client}".` }
      if ('ambiguous' in resolved) {
        return { note: 'Multiple clients match — specify the client code.', candidates: resolved.ambiguous }
      }
      return data.getClientDetail(resolved.id as string)
    },
  },
  {
    name: 'list_activity',
    description:
      'Recent logged activity (emails etc.), newest first, optionally scoped to one project. Returns snippets (not full bodies); pass `search` to find emails by text (subject/body/sender), then use get_email with an entry id for the full body.',
    kind: 'read',
    schema: { project: z.string().optional(), search: z.string().optional(), limit: z.number().int().min(1).max(50).optional() },
    handler: async (rawArgs) => {
      const args = rawArgs as { project?: string; search?: string; limit?: number }
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
    },
  },
  {
    name: 'get_email',
    description:
      'Get the full body + participants of one logged activity entry (email) by its id (from list_activity).',
    kind: 'read',
    schema: { id: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { id: string }
      return data.getActivityDetail(args.id)
    },
  },
  {
    name: 'decode_survey_id',
    description:
      'Decode a Survey Ops survey ID into owner initials, client+project abbreviation, date, and region.',
    kind: 'read',
    schema: { id: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { id: string }
      const initials = await data.getTeamInitials()
      const decoded = data.decodeSurveyId(args.id, initials)
      if (!decoded) return { error: 'No 8-digit date found in that ID — cannot decode.' }
      return decoded
    },
  },
  {
    name: 'list_reminders',
    description: "List the caller's own reminders, soonest due first.",
    kind: 'read',
    schema: { include_done: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { include_done?: boolean }
      const { userId } = ctx
      const supabase = createAdminClient()
      let q = supabase.from('reminders').select('*').eq('user_id', userId)
      if (!args.include_done) q = q.eq('done', false)
      const { data: rows, error } = await q.order('due_date', { ascending: true })
      if (error) throw error
      return rows
    },
  },

  // -------------------------------------------------------------------------
  // reminder writes (scoped to the authenticated user; commit directly)
  // -------------------------------------------------------------------------
  {
    name: 'create_reminder',
    description: 'Create a personal reminder, optionally linked to a project. due_date must be YYYY-MM-DD.',
    kind: 'write',
    schema: { text: z.string().min(1).max(500), due_date: z.string(), project: z.string().optional() },
    previewSummary: (args) => {
      const a = args as { text: string; due_date: string; project?: string }
      return `Create reminder "${a.text}" due ${a.due_date}${a.project ? ` (on ${a.project})` : ''}`
    },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { text: string; due_date: string; project?: string }
      const { userId, userEmail } = ctx
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
    },
  },
  {
    name: 'complete_reminder',
    description: "Mark one of the caller's own reminders as done.",
    kind: 'write',
    schema: { id: z.string() },
    previewSummary: (args) => `Mark reminder ${(args as { id: string }).id} as done`,
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { id: string }
      const { userId } = ctx
      const supabase = createAdminClient()
      const { data: rows, error } = await supabase.from('reminders')
        .update({ done: true, done_at: new Date().toISOString() })
        .eq('id', args.id).eq('user_id', userId).select()
      if (error) throw error
      if (!rows || rows.length === 0) return { error: 'Reminder not found or not yours.' }
      return rows[0]
    },
  },
  {
    name: 'delete_reminder',
    description: "Delete one of the caller's own reminders.",
    kind: 'write',
    schema: { id: z.string() },
    previewSummary: (args) => `Delete reminder ${(args as { id: string }).id}`,
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { id: string }
      const { userId } = ctx
      const supabase = createAdminClient()
      const { data: rows, error } = await supabase.from('reminders')
        .delete().eq('id', args.id).eq('user_id', userId).select()
      if (error) throw error
      if (!rows || rows.length === 0) return { error: 'Reminder not found or not yours.' }
      return { deleted: true, id: args.id }
    },
  },

  // -------------------------------------------------------------------------
  // write tools: append (add_next_step/complete_next_step/add_note/add_client_note
  // commit directly; edit_next_step/link_document preview-then-confirm)
  // -------------------------------------------------------------------------
  {
    name: 'add_next_step',
    description: 'Add a to-do/next step to a project.',
    kind: 'write',
    schema: { project: z.string(), text: z.string().min(1).max(1000) },
    previewSummary: (args) => {
      const a = args as { project: string; text: string }
      return `Add next step to ${a.project}: "${a.text}"`
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; text: string }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const row = await runAddStep(p.id as string, args.text, userEmail.split('@')[0], `${userEmail} via Claude`)
      meta.detail = { created: { id: row.id, text: row.text } }
      return { ok: true, step: { id: row.id, text: row.text } }
    },
  },
  {
    name: 'complete_next_step',
    description: 'Mark a project next step done or not done (mirrors the checkbox in the app).',
    kind: 'write',
    schema: { project: z.string(), step_ref: z.string(), done: z.boolean() },
    previewSummary: (args) => {
      const a = args as { project: string; step_ref: string; done: boolean }
      return `Mark step "${a.step_ref}" on ${a.project} as ${a.done ? 'done' : 'not done'}`
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; step_ref: string; done: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'edit_next_step',
    description: "Edit a project next step's text (preview first; confirm to apply).",
    kind: 'write',
    schema: { project: z.string(), step_ref: z.string(), text: z.string().min(1).max(1000), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; step_ref: string; text: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'add_note',
    description: 'Log a manual data-change note on a project (paper trail of edits to the survey data).',
    kind: 'write',
    schema: { project: z.string(), text: z.string().min(1).max(2000) },
    previewSummary: (args) => {
      const a = args as { project: string; text: string }
      return `Add note to ${a.project}: "${a.text}"`
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; text: string }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'add_client_note',
    description: 'Add a dated note to a client profile.',
    kind: 'write',
    schema: { client: z.string(), text: z.string().min(1).max(2000) },
    previewSummary: (args) => {
      const a = args as { client: string; text: string }
      return `Add note to client ${a.client}: "${a.text}"`
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { client: string; text: string }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'link_document',
    description:
      'Link a document (Google Doc/Sheet/Slides/Drive file, etc.) to a project (preview first; confirm to apply).',
    kind: 'write',
    schema: { project: z.string(), url: z.string().min(1), name: z.string().optional(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; url: string; name?: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },

  // -------------------------------------------------------------------------
  // write tools: field edits (preview-then-confirm)
  // -------------------------------------------------------------------------
  {
    name: 'update_project',
    description:
      "Update a project's fields (preview first; confirm to apply). Handles name, client, type, captain/co-captains, salesperson, priority, all dates, N target/internal/collected/actual, audience_size, the free-text audience, category, objective, sprint_number, budget, the Y/N flags, survey_tool_id, slack channel, latest/next-steps, and the gen-pop N-floor override (n_floor_override + n_floor_override_reason). For status/stage moves use advance_project/approve_scoping/set_project_status; for compliance override, requested-by, or linked docs use their tools; for a project whose N is split into segments, use add_segment/update_segment/remove_segment.",
    kind: 'write',
    schema: {
      project: z.string(),
      fields: z.record(z.unknown()),
      confirm: z.boolean().optional(),
      expected_updated_at: z.string().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; fields: Record<string, unknown>; confirm?: boolean; expected_updated_at?: string
      }
      const { userEmail } = ctx
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

      // Resolve captain_id / co_captain_ids from a name or initials (not just a
      // raw UUID) — like create_project does for the primary captain — so "set
      // captain to Bryan" / "add co-captain Julia" work. Unmatched → ask.
      if ('captain_id' in patch || 'co_captain_ids' in patch) {
        const supabase = createAdminClient()
        const { data: members } = await supabase.from('team_members').select('id, name, initials')
        const mm = members ?? []
        const validList = () => mm.map((m) => ({ name: m.name, initials: m.initials }))
        const resolveRef = (ref: unknown): string | null | undefined => {
          if (ref == null || String(ref).trim() === '') return null // clear
          const s = String(ref).trim()
          if (mm.some((m) => m.id === s)) return s // already a valid id
          const low = s.toLowerCase()
          const hit =
            mm.find((m) => m.initials.toLowerCase() === low) ??
            mm.find((m) => m.name.toLowerCase() === low) ??
            mm.find((m) => m.name.toLowerCase().includes(low))
          return hit ? hit.id : undefined // undefined = unmatched
        }
        if ('captain_id' in patch) {
          const r = resolveRef(patch.captain_id)
          if (r === undefined)
            return { needs: 'captain', message: `Couldn't match "${String(patch.captain_id)}" to a team member.`, valid_captains: validList() }
          patch.captain_id = r
        }
        if ('co_captain_ids' in patch) {
          const refs = Array.isArray(patch.co_captain_ids) ? patch.co_captain_ids : []
          const out: string[] = []
          for (const ref of refs) {
            const r = resolveRef(ref)
            if (r === undefined)
              return { needs: 'co_captains', message: `Couldn't match "${String(ref)}" to a team member.`, valid_captains: validList() }
            if (r) out.push(r)
          }
          patch.co_captain_ids = out
        }
      }
      if (
        ('n_target' in patch || 'n_collected' in patch || 'n_actual' in patch) &&
        ((p.segment_count as number | null) ?? 0) > 0
      ) {
        return {
          error:
            "This project's N is split into segments, so its total N is the sum of them and can't be set directly. Use update_segment to change a segment's numbers, add_segment to add one, or remove_segment (remove all to revert to a single N).",
        }
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
    },
  },
  {
    name: 'add_segment',
    description:
      "Add an N segment to a project — e.g. split N into Buyers / Sellers, each with its own target. Adding the first segment converts the project to a segmented N (its total N becomes the sum of the segments). If the label or target isn't given, ask before adding. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      label: z.string().min(1).max(120),
      target: z.number().int().nullable().optional(),
      collected: z.number().int().nullable().optional(),
      actual: z.number().int().nullable().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; label: string; target?: number | null; collected?: number | null; actual?: number | null; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const existing = (p.segment_count as number | null) ?? 0
      return confirmable(
        args,
        async () => ({
          summary:
            `Add segment "${args.label}" (target ${args.target ?? '—'}, collected ${args.collected ?? 0}) to ${p.project_code}` +
            (existing === 0
              ? ' — this splits its single N into segments; the total N becomes the sum of the segments'
              : ` (segment ${existing + 1})`),
        }),
        async () => {
          const row = await runAddSegment({
            projectId: p.id as string,
            label: args.label,
            target: args.target ?? null,
            collected: args.collected ?? null,
            actual: args.actual ?? null,
            actor: `${userEmail} via Claude`,
          })
          meta.detail = { created_segment: { id: row.id, label: row.label } }
          return { ok: true, segment: { id: row.id, label: row.label, n_target: row.n_target, n_collected: row.n_collected, n_actual: row.n_actual } }
        }
      )
    },
  },
  {
    name: 'update_segment',
    description:
      "Edit an N segment's label or numbers (target / collected / actual). Identify the segment by its name or id. If it's unclear which segment, ask. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      segment_ref: z.string(),
      label: z.string().min(1).max(120).optional(),
      target: z.number().int().nullable().optional(),
      collected: z.number().int().nullable().optional(),
      actual: z.number().int().nullable().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; segment_ref: string; label?: string; target?: number | null; collected?: number | null; actual?: number | null; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const seg = await resolveSegment(p.id as string, args.segment_ref)
      if (!seg) return { error: `No segment found matching "${args.segment_ref}" on this project.` }
      if ('ambiguous' in seg) return { note: 'Multiple segments match — be more specific.', candidates: seg.ambiguous }

      const patch: Record<string, unknown> = {}
      if (args.label !== undefined) patch.label = args.label
      if (args.target !== undefined) patch.n_target = args.target
      if (args.collected !== undefined) patch.n_collected = args.collected
      if (args.actual !== undefined) patch.n_actual = args.actual
      if (Object.keys(patch).length === 0) {
        return { needs: 'a change', message: 'Specify at least one of: label, target, collected, actual.' }
      }
      const desc = [
        args.label !== undefined ? `label → "${args.label}"` : null,
        args.target !== undefined ? `target → ${args.target ?? '—'}` : null,
        args.collected !== undefined ? `collected → ${args.collected ?? 0}` : null,
        args.actual !== undefined ? `actual → ${args.actual ?? '—'}` : null,
      ].filter(Boolean).join(', ')
      return confirmable(
        args,
        async () => ({ summary: `Update segment "${seg.label}" on ${p.project_code}: ${desc}` }),
        async () => {
          const row = await runUpdateSegment(seg.id as string, patch, `${userEmail} via Claude`)
          meta.detail = { segment_id: row.id, updated: patch }
          return { ok: true, segment: { id: row.id, label: row.label, n_target: row.n_target, n_collected: row.n_collected, n_actual: row.n_actual } }
        }
      )
    },
  },
  {
    name: 'remove_segment',
    description:
      "Remove an N segment from a project (by name or id). Removing the last segment reverts the project to a single, non-segmented N. If it's unclear which segment, ask. Preview first; confirm to apply.",
    kind: 'write',
    schema: { project: z.string(), segment_ref: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; segment_ref: string; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const seg = await resolveSegment(p.id as string, args.segment_ref)
      if (!seg) return { error: `No segment found matching "${args.segment_ref}" on this project.` }
      if ('ambiguous' in seg) return { note: 'Multiple segments match — be more specific.', candidates: seg.ambiguous }
      const last = ((p.segment_count as number | null) ?? 0) <= 1
      return confirmable(
        args,
        async () => ({
          summary: `Remove segment "${seg.label}" from ${p.project_code}` + (last ? ' — the last segment; the project reverts to a single N' : ''),
        }),
        async () => {
          await runRemoveSegment(seg.id as string, `${userEmail} via Claude`)
          meta.detail = { removed_segment: { id: seg.id, label: seg.label } }
          return { ok: true, removed: seg.label }
        }
      )
    },
  },
  {
    name: 'set_requested_by',
    description:
      "Set who requested a project, from among the project's client's contacts (preview first; confirm to apply).",
    kind: 'write',
    schema: { project: z.string(), contact_ref: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; contact_ref: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'log_blast',
    description:
      "Log a B2B blast against a project — its $/bid, the # of people it went to, when it ran (optional), and an optional description of the audience. Its cost ($/bid × # of people) counts toward the project's spend. If $/bid or # of people is missing, ask. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      bid: z.number().min(0),
      people: z.number().int().min(0),
      blast_at: z.string().optional(),
      description: z.string().max(1000).optional(),
      confirm: z.boolean().optional(),
      idem_key: z.string().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; bid: number; people: number; blast_at?: string
        description?: string; confirm?: boolean; idem_key?: string
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      const thisBlastTotal = blastTotal({ bid: args.bid, people: args.people })
      const currentSpend = (p.actual_spend as number | null) ?? 0
      const projectedSpend = currentSpend + thisBlastTotal

      return confirmable(
        args,
        async () => ({
          summary: `Log blast: ${args.people} people @ $${args.bid}/bid = $${thisBlastTotal} → projected spend $${projectedSpend}`,
          people: args.people, bid: args.bid, blast_at: args.blast_at ?? null,
          projected_actual_spend: projectedSpend,
        }),
        async () => {
          const row = await runLogBlast({
            projectId: p.id as string, bid: args.bid, people: args.people,
            blastAt: args.blast_at ?? null, note: args.description ?? null,
            createdBy: userEmail.split('@')[0], idemKey: args.idem_key ?? randomUUID(),
            actor: `${userEmail} via Claude`,
          })
          meta.detail = { created: { id: row.id, people: row.people, bid: row.bid } }
          return { ok: true, blast: { id: row.id, people: row.people, bid: row.bid, blast_at: row.blast_at } }
        }
      )
    },
  },

  // -------------------------------------------------------------------------
  // write tools: status / stage (preview-then-confirm + compliance gate)
  // -------------------------------------------------------------------------
  {
    name: 'advance_project',
    description:
      'Move an Active project to a pipeline column, or mark it delivered (preview first; confirm to apply). Enforces the compliance gate.',
    kind: 'write',
    schema: {
      project: z.string(),
      to_column: z.string().optional(),
      mark_delivered: z.boolean().optional(),
      override_reason: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; to_column?: string; mark_delivered?: boolean; override_reason?: string; confirm?: boolean
      }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'set_project_status',
    description: "Set a project's status — Open, Hold, or Closed (preview first; confirm to apply).",
    kind: 'write',
    schema: { project: z.string(), status: z.enum(['Open', 'Hold', 'Closed']), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; status: 'Open' | 'Hold' | 'Closed'; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'approve_scoping',
    description: 'Approve a Scoping project into the Active pipeline at Submitted (preview first; confirm to apply).',
    kind: 'write',
    schema: { project: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'move_to_scoping',
    description:
      'Move an Active project back into Scoping (preview first; confirm to apply). Leaves board_column and stage checkboxes untouched.',
    kind: 'write',
    schema: { project: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'set_compliance_override',
    description:
      "Override a project's compliance requirement — on, off, or auto (client default) — with a reason (preview first; confirm to apply).",
    kind: 'write',
    schema: {
      project: z.string(),
      value: z.enum(['on', 'off', 'auto']),
      reason: z.string().min(1).max(1000),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; value: 'on' | 'off' | 'auto'; reason: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },

  // -------------------------------------------------------------------------
  // write tools: client & contact (preview-then-confirm)
  // -------------------------------------------------------------------------
  {
    name: 'update_client',
    description:
      "Update a client's compliance settings, or assign/fix its Cl##### code on a code-less client (preview first; confirm to apply). Use rename_client to change the name.",
    kind: 'write',
    schema: { client: z.string(), fields: z.record(z.unknown()), confirm: z.boolean().optional() },
    handler: async (rawArgs, _ctx, meta) => {
      const args = rawArgs as { client: string; fields: Record<string, unknown>; confirm?: boolean }
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

      // Validate + normalize a manually-assigned client code (must look like
      // Cl00042 and not already be taken by another client).
      if ('code' in patch) {
        const code = String(patch.code ?? '').trim().toUpperCase().replace(/^CL/, 'Cl')
        if (!/^Cl\d+$/.test(code)) return { error: 'Client code must look like "Cl00042".' }
        const admin = createAdminClient()
        const { data: dup } = await admin.from('clients').select('id, name').ilike('code', code).neq('id', c.id as string).maybeSingle()
        if (dup) return { error: `Code ${code} is already used by ${dup.name}.` }
        patch.code = code
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
    },
  },
  {
    name: 'rename_client',
    description:
      "Rename a client and keep every one of its projects' denormalized client text in sync (preview first; confirm to apply).",
    kind: 'write',
    schema: { client: z.string(), new_name: z.string().min(1), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { client: string; new_name: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'create_client',
    description:
      'Create a new client (preview first; confirm to apply). If a client with that name already exists, returns it instead of creating a duplicate.',
    kind: 'write',
    schema: {
      name: z.string().min(1),
      compliance_before_fielding: z.boolean().optional(),
      compliance_after_fielding: z.boolean().optional(),
      compliance_contact: z.string().optional(),
      compliance_notes: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, _ctx, meta) => {
      const args = rawArgs as {
        name: string; compliance_before_fielding?: boolean; compliance_after_fielding?: boolean
        compliance_contact?: string; compliance_notes?: string; confirm?: boolean
      }
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
    },
  },
  {
    name: 'add_contact',
    description: 'Add a contact to a client (preview first; confirm to apply).',
    kind: 'write',
    schema: {
      client: z.string(), first_name: z.string(), last_name: z.string(),
      email: z.string().optional(), title: z.string().optional(), phone: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        client: string; first_name: string; last_name: string
        email?: string; title?: string; phone?: string; confirm?: boolean
      }
      const { userEmail } = ctx
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
    },
  },
  {
    name: 'edit_contact',
    description: "Edit a client contact's fields (preview first; confirm to apply).",
    kind: 'write',
    schema: { client: z.string(), contact_ref: z.string(), fields: z.record(z.unknown()), confirm: z.boolean().optional() },
    handler: async (rawArgs, _ctx, meta) => {
      const args = rawArgs as { client: string; contact_ref: string; fields: Record<string, unknown>; confirm?: boolean }
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
    },
  },
  {
    name: 'archive_contact',
    description: 'Archive or unarchive a client contact (preview first; confirm to apply).',
    kind: 'write',
    schema: { client: z.string(), contact_ref: z.string(), archived: z.boolean(), confirm: z.boolean().optional() },
    handler: async (rawArgs, _ctx, meta) => {
      const args = rawArgs as { client: string; contact_ref: string; archived: boolean; confirm?: boolean }
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
    },
  },
  {
    name: 'set_client_preference',
    description:
      'Save a stated client preference as a tagged, searchable client note (preview first; confirm to apply).',
    kind: 'write',
    schema: { client: z.string(), preference: z.string().min(1), reason: z.string().optional(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { client: string; preference: string; reason?: string; confirm?: boolean }
      const { userEmail } = ctx
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
    },
  },

  // -------------------------------------------------------------------------
  // write tools: create_project (conversational duplicate handling)
  // -------------------------------------------------------------------------
  {
    name: 'create_project',
    description:
      "Create a new survey project (preview first; confirm to apply). Set ALL provided fields in THIS one call — it accepts the dates (launch/due/deliver/submitted), N target + internal target, audience + audience size, budget, row-level flag, the Y/N flags, and latest-next-steps directly, so no follow-up update is needed. budget is the TOTAL planned $ — if the user gives a per-N rate (e.g. \"$37.5/N\"), multiply by the N being collected (usually the internal target) and note the assumption. Warns about possible duplicate projects before creating.",
    kind: 'write',
    schema: {
      project_name: z.string(),
      client: z.string(),
      project_type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
      captain: z.string().optional(),
      salesperson: z.string().optional(),
      due_date: z.string().optional(),
      n_target: z.number().int().positive().optional(),
      n_internal_target: z.number().int().optional(),
      audience_size: z.number().int().optional(),
      audience: z.string().optional(),
      budget: z.number().optional(),
      launch_date: z.string().optional(),
      deliver_date: z.string().optional(),
      submitted_date: z.string().optional(),
      row_level_data: z.boolean().optional(),
      longitudinal: z.boolean().optional(),
      voter_survey_qa: z.boolean().optional(),
      citation_language_needed: z.boolean().optional(),
      terminations: z.boolean().optional(),
      latest_next_steps: z.string().optional(),
      skip_scoping: z.boolean().optional(),
      confirm: z.boolean().optional(),
      proceed_despite_duplicate: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project_name: string; client: string; project_type?: 'PS' | 'B2B' | 'Rerun'
        captain?: string; salesperson?: string; due_date?: string; n_target?: number
        n_internal_target?: number; audience_size?: number; audience?: string; budget?: number
        launch_date?: string; deliver_date?: string; submitted_date?: string
        row_level_data?: boolean; longitudinal?: boolean; voter_survey_qa?: boolean
        citation_language_needed?: boolean; terminations?: boolean; latest_next_steps?: string
        skip_scoping?: boolean; confirm?: boolean; proceed_despite_duplicate?: boolean
      }
      const { userEmail } = ctx

      const projectName = args.project_name.trim()
      const clientText = args.client.trim()
      if (!projectName || !clientText) return { error: 'project_name and client are both required.' }
      if (args.due_date && !DUE_DATE_RE.test(args.due_date)) {
        return { error: 'due_date must be in YYYY-MM-DD format.' }
      }
      for (const [name, v] of [['launch_date', args.launch_date], ['deliver_date', args.deliver_date], ['submitted_date', args.submitted_date]] as const) {
        if (v && !DUE_DATE_RE.test(v)) return { error: `${name} must be in YYYY-MM-DD format.` }
      }

      // Canonicalize the client to an EXISTING one when it matches, so e.g. "A4A"
      // links to "Airlines 4 America (A4A)" instead of spawning a duplicate thin
      // client (the client-link trigger exact-matches the firm name). Ambiguous or
      // no match → keep what was given (a genuinely new client is fine).
      let effectiveClient = clientText
      {
        const resolvedClient = await data.resolveClient(firmNameFrom(clientText))
        if (resolvedClient && !('ambiguous' in resolvedClient)) {
          const suffix = clientText.includes(' - ') ? clientText.slice(clientText.indexOf(' - ')) : ''
          effectiveClient = String((resolvedClient as { name: string }).name) + suffix
        }
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
      const firm = firmNameFrom(effectiveClient)
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
        client: normalizeClientText(effectiveClient),
      }
      if (args.project_type) patch.project_type = args.project_type
      if (captainId) patch.captain_id = captainId
      if (args.salesperson) patch.salesperson = args.salesperson
      if (args.due_date) patch.due_date = args.due_date
      if (args.n_target !== undefined) patch.n_target = args.n_target
      if (args.skip_scoping) {
        patch.phase = 'Active'
        patch.board_column = 'Submitted'
      }
      // Submitted date: use the given one, else stamp today only when skipping scoping.
      if (args.submitted_date) patch.submitted_date = args.submitted_date
      else if (args.skip_scoping) patch.submitted_date = todayEastern()

      // The rest of the intake — mcp_create_project doesn't insert these columns,
      // so apply them as ONE follow-up write right after create. This lets a single
      // create_project call land the whole intake (no separate update needed).
      const extras: Record<string, unknown> = {}
      if (args.n_internal_target != null) extras.n_internal_target = args.n_internal_target
      if (args.audience_size != null) extras.audience_size = args.audience_size
      if (args.audience != null) extras.audience = args.audience
      if (args.budget != null) extras.budget = args.budget
      if (args.launch_date) extras.launch_date = args.launch_date
      if (args.deliver_date) extras.deliver_date = args.deliver_date
      if (args.row_level_data != null) extras.row_level_data = args.row_level_data
      if (args.longitudinal != null) extras.longitudinal = args.longitudinal
      if (args.voter_survey_qa != null) extras.voter_survey_qa = args.voter_survey_qa
      if (args.citation_language_needed != null) extras.citation_language_needed = args.citation_language_needed
      if (args.terminations != null) extras.terminations = args.terminations
      if (args.latest_next_steps) extras.latest_next_steps = args.latest_next_steps

      return confirmable(
        args,
        async () => ({
          summary: `Create "${projectName}" for ${normalizeClientText(effectiveClient)}${args.skip_scoping ? ' (skip scoping — Active/Submitted)' : ''}`,
          fields: { ...patch, ...extras },
          duplicate_warning: dupRows && dupRows.length > 0
            ? `${dupRows.length} similar project(s) already exist for this client/name — proceeding anyway.`
            : null,
        }),
        async () => {
          const row = await runCreateProject(patch, `${userEmail} via Claude`)
          if (Object.keys(extras).length > 0) {
            await runProjectWrite(supabase, { id: row.id as string, patch: extras, actor: `${userEmail} via Claude` })
          }
          meta.project_id = row.id
          if (row.client_id) meta.client_id = row.client_id
          meta.detail = { created: { project_code: row.project_code, project_name: row.project_name, client: row.client }, extras }
          return {
            ok: true, project_code: row.project_code, id: row.id,
            client: row.client, client_id: row.client_id, phase: row.phase, board_column: row.board_column,
          }
        }
      )
    },
  },
  {
    name: 'clone_project',
    description:
      "Clone a project into a fresh copy — new PR code, setup fields carried over, run-data reset (dates, N collected/actual, survey-tool ID, pipeline stage → Submitted). Blasts, deliverables, and activity are NOT copied. Records what it was cloned from in the audit log. By default it carries people, audience/N targets, flags, suppliers (CPIs + caps, collected reset), and budget — pass a carry_* as false to start that group blank. Great for the next wave of a recurring study. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      source: z.string(),
      new_name: z.string().min(1),
      carry_people: z.boolean().optional(),
      carry_audience: z.boolean().optional(),
      carry_flags: z.boolean().optional(),
      carry_suppliers: z.boolean().optional(),
      carry_budget: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        source: string; new_name: string
        carry_people?: boolean; carry_audience?: boolean; carry_flags?: boolean
        carry_suppliers?: boolean; carry_budget?: boolean; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.source)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const carry = {
        people: args.carry_people,
        audienceN: args.carry_audience,
        flags: args.carry_flags,
        suppliers: args.carry_suppliers,
        budget: args.carry_budget,
      }
      const blanked = [
        args.carry_people === false ? 'people' : null,
        args.carry_audience === false ? 'audience/N' : null,
        args.carry_flags === false ? 'flags' : null,
        args.carry_suppliers === false ? 'suppliers' : null,
        args.carry_budget === false ? 'budget' : null,
      ].filter(Boolean)
      return confirmable(
        args,
        async () => ({
          summary: `Clone ${p.project_code} "${p.project_name}" → "${args.new_name}" (dates/N/stage reset${blanked.length ? `; also blanking ${blanked.join(', ')}` : ''})`,
        }),
        async () => {
          const res = await cloneProject({
            sourceId: p.id as string,
            newName: args.new_name,
            carry,
            actor: `${userEmail} via Claude`,
          })
          meta.detail = { cloned_from: p.project_code, created: { id: res.id, project_code: res.project_code } }
          return { ok: true, project_code: res.project_code, id: res.id, cloned_from: res.cloned_from }
        }
      )
    },
  },
  {
    name: 'add_team_member',
    description:
      "Add a new team member to the roster (e.g. a captain not yet listed). Preview first; confirm to apply. Needs the person's name and @alpharoc email; initials are derived if not given. Only add someone the user has explicitly approved adding.",
    kind: 'write',
    schema: {
      name: z.string(),
      email: z.string(),
      initials: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, _ctx, meta) => {
      const args = rawArgs as { name: string; email: string; initials?: string; confirm?: boolean }
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
    },
  },
]

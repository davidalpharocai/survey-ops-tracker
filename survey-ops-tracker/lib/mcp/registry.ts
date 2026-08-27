import 'server-only'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCheckboxesForColumn, STAGE_ORDER, type BoardColumn } from '@/lib/utils/stage'
import { complianceGate } from '@/lib/utils/compliance'
import { occamOnboardingGate } from '@/lib/utils/occam'
import { autoStamp } from '@/lib/utils/date'
import { normalizeClientText, firmNameFrom } from '@/lib/utils/clientName'
import { blastTotal, totalBidDollars } from '@/lib/utils/blast'
import type { Database } from '@/lib/supabase/types'
import * as data from '@/lib/mcp/data'
import {
  resolveProjectWritable, resolveStep, resolveContact, resolveSegment, loadGateInput,
  runAddStep, runCompleteStep, runEditStep, runProjectWrite, runLogBlast,
  resolveBlast, listBlastsForProject, runUpdateBlast, runRemoveBlast,
  runAddSegment, runUpdateSegment, runRemoveSegment,
  runRenameClient, runCreateProject,
  pickProjectPatch, diffSummary, stageColumnsFor, alignNRangePatch,
  runLogLaunch, resolveLaunch, listLaunchesForProject, runUpdateLaunch, runRemoveLaunch,
  UNDOABLE_FIELDS, loadOccamGate, markContactOccamInvited,
  type LaunchView, type LaunchSupplierInput, type LaunchSupplierPatch,
} from '@/lib/mcp/writes'
import {
  actualCost, estimateRange, totalCollected,
  projectActualCost, projectEstimateRange, projectCollected,
  type SupplierLine,
} from '@/lib/utils/suppliers'
import { fmtNum } from '@/lib/utils/number'
import { formatNRange, isInvertedNRange } from '@/lib/utils/nRange'
import {
  resolvePeriod, surveyStats, surveyRows, projectRow, opsMetrics,
  countScopedPlaceholders, placeholderNote,
  REPORT_FIELD_KEYS, reportFieldsFor, reportFieldKeysFor, defaultReportFieldsFor,
  type SurveyEvent, type SurveyType,
} from '@/lib/mcp/reports'
import * as health from '@/lib/mcp/health'

// Canonical prod origin for report download links surfaced to the connector user.
const REPORT_BASE = 'https://survey-ops-tracker.vercel.app'
import { cloneProject } from '@/lib/server/clone'
import {
  cadenceToMonths, createSeriesFromProject, setSeriesDefaults,
  pauseSeries, endSeries, resumeSeries, spawnNextWave,
  attachProjectToSeries, detachProjectFromSeries,
} from '@/lib/reruns/seriesOps'
import {
  confirmable, describeChanges, fmtChangeVal, fieldLabel, describeUnrevertible, todayEastern, fetchDocTitle,
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

// ---- log_launch helpers: launch economics + preview text (shared by log_launch/list_launches) ----
const money = (n: number) => `$${n.toFixed(2)}`
function launchLines(l: LaunchView): SupplierLine[] {
  return l.suppliers.map(s => ({ cpi: s.cpi, completes_cap: s.cap, n_collected: s.n_collected }))
}
/** Actual / collected / estimate-range for one launch, as scalars for structured output. */
function launchEconOut(l: LaunchView) {
  const lines = launchLines(l)
  const est = estimateRange(l.target ?? null, lines)
  return {
    actual_spend: actualCost(lines),
    collected: totalCollected(lines),
    est_low: est?.low ?? null,
    est_high: est?.high ?? null,
  }
}
function renderLaunch(l: LaunchView): string {
  const lines = launchLines(l)
  const est = estimateRange(l.target ?? null, lines)
  const head = `  ${l.label || 'Launch'}${l.launch_date ? ` — ${l.launch_date}` : ''}${l.target ? ` · target ${fmtNum(l.target)}` : ''}`
  const rows = l.suppliers.map(
    s => `    - ${s.name}: ${money(s.cpi)}/complete · cap ${s.cap || '—'} · ${fmtNum(s.n_collected)} collected`,
  )
  const foot = `  actual ${money(actualCost(lines))} (${fmtNum(totalCollected(lines))} collected)` +
    (est ? ` · est ${money(est.low)}–${money(est.high)}` : '')
  return [head, ...rows, foot].join('\n')
}

export const TOOLS: AssistantTool[] = [
  // -------------------------------------------------------------------------
  // read tools
  // -------------------------------------------------------------------------
  {
    name: 'search_projects',
    description:
      'Search survey projects by name/code/client with optional filters. Filter by captain (the team member running it) and/or salesperson (the AlphaROC seller, e.g. "Alex Pinsky" — a partial name like "Alex" matches) — use the salesperson filter to answer "which projects have <person> as sales". Returns only in-flight active projects by default (excludes Archived, Cancelled, On-Hold, Delivered, and pre-sale Scoping); pass active_only:false to search ALL projects regardless of status — e.g. to find a specific past or archived project. Pass status:"Cancelled" to find projects the client cancelled. Pass mine:true to scope to your own captained projects. ("Archived" is the status for finished/legacy projects kept for history; "Cancelled" is for projects a client asked to cancel.)',
    kind: 'read',
    schema: {
      query: z.string().optional(),
      status: z.enum(['Open', 'Hold', 'Archived', 'Closed', 'Cancelled']).optional(),
      phase: z.enum(['Scoping', 'Active']).optional(),
      captain: z.string().optional(),
      salesperson: z.string().optional(),
      due_before: z.string().optional(),
      due_after: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      mine: z.boolean().optional(),
      active_only: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as {
        query?: string; status?: 'Open' | 'Hold' | 'Archived' | 'Closed' | 'Cancelled'; phase?: 'Scoping' | 'Active'
        captain?: string; salesperson?: string; due_before?: string; due_after?: string; limit?: number
        mine?: boolean; active_only?: boolean
      }
      const { userId } = ctx
      // "Archived" is the user-facing label for the stored 'Closed' status;
      // "Cancelled" passes through unchanged (it's a real stored status value).
      const status = args.status === 'Archived' ? 'Closed' : args.status
      return data.searchProjects({ ...args, status, userId })
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
      'Digest of the active pipeline — overdue, due within 3 days, and fielding behind pace, all limited to in-flight work (Archived, On-Hold, and Delivered projects are excluded) — plus `active_count` (the number of in-flight operational projects) and counts by stage/status/phase. Pass mine:true to scope everything (including active_count) to your own captained projects. To answer “how many open/active projects”, read `active_count` — NOT counts.by_status.Open.',
    kind: 'read',
    schema: { mine: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { mine?: boolean }
      const { userId } = ctx
      return data.pipelineSummary({ ...args, userId })
    },
  },
  {
    name: 'survey_stats',
    description:
      "Count surveys by type and lifecycle event over a flexible period. `event` is submitted (submitted_date), launched (launch_date), or delivered (deliver_date). The period is flexible — pass month (+year), a whole year, a single date, or a from/to span; month without a year defaults to the current year. Optionally filter to one type (PS / B2B / Rerun); otherwise the result breaks down by type plus a total. Excludes internal projects. Example: “how many PS launched in July 2026” → event:'launched', type:'PS', month:7, year:2026.",
    kind: 'read',
    schema: {
      event: z.enum(['submitted', 'launched', 'delivered']),
      type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
      month: z.number().int().min(1).max(12).optional(),
      year: z.number().int().min(2000).max(2100).optional(),
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    },
    handler: async (rawArgs) => {
      const args = rawArgs as {
        event: SurveyEvent; type?: SurveyType; month?: number; year?: number; date?: string; from?: string; to?: string
      }
      const period = resolvePeriod(args)
      if ('error' in period) return { error: period.error }
      const stats = await surveyStats({ event: args.event, from: period.from, to: period.to, type: args.type })
      const base = args.type
        ? `${stats.total} ${args.type} survey(s) ${args.event} in ${period.label}.`
        : `${stats.total} survey(s) ${args.event} in ${period.label} — PS ${stats.by_type.PS}, B2B ${stats.by_type.B2B}, Rerun ${stats.by_type.Rerun}.`
      const summary = stats.note ? `${base} ${stats.note}` : base
      return {
        ok: true, event: args.event, type: args.type ?? 'all', period,
        total: stats.total, by_type: stats.by_type,
        placeholders_excluded: stats.placeholders_excluded, note: stats.note, summary,
      }
    },
  },
  {
    name: 'survey_report',
    description:
      "Build a report of the surveys matching an event + period (same flexible period as survey_stats), optionally filtered by type. Returns the matching rows as a preview table plus a link to download the FULL report as an Excel (.xlsx). Choose columns via `fields`: call once WITHOUT fields to get `available_fields` + the default set, then re-call with the subset you want. Use for “report of everything delivered in Q2” or “excel of PS launches in July with client, captain, N collected”.",
    kind: 'read',
    schema: {
      event: z.enum(['submitted', 'launched', 'delivered']),
      type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
      month: z.number().int().min(1).max(12).optional(),
      year: z.number().int().min(2000).max(2100).optional(),
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      fields: z.array(z.string()).optional(),
    },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as {
        event: SurveyEvent; type?: SurveyType; month?: number; year?: number
        date?: string; from?: string; to?: string; fields?: string[]
      }
      const period = resolvePeriod(args)
      if ('error' in period) return { error: period.error }
      // Reports are the highest-volume way money leaves this connector, so the
      // field list this caller may have is resolved BEFORE anything is projected —
      // and it's the same list advertised back as available_fields, so the model
      // never asks for a column it can't be given.
      const canViewFinancials = await data.callerCanViewFinancials(ctx)
      const allowedFields = reportFieldsFor(canViewFinancials)
      const allowedKeys = reportFieldKeysFor(canViewFinancials)
      const requested = args.fields ?? []
      const chosen = requested.filter(k => allowedKeys.includes(k))
      // Asked for by name, real, and not theirs to see — worth saying out loud
      // rather than quietly handing back the defaults.
      const withheldFields = requested.filter(k => !allowedKeys.includes(k) && REPORT_FIELD_KEYS.includes(k))
      const defaultFields = defaultReportFieldsFor(canViewFinancials)
      const fields = chosen.length ? chosen : defaultFields
      const rows = await surveyRows({ event: args.event, from: period.from, to: period.to, type: args.type })
      const placeholders_excluded = await countScopedPlaceholders({ event: args.event, from: period.from, to: period.to, type: args.type })
      const placeholderClause = placeholderNote(placeholders_excluded)
      const projected = rows.map(r => projectRow(r, fields, allowedFields))

      const qs = new URLSearchParams()
      qs.set('event', args.event)
      if (args.type) qs.set('type', args.type)
      if (args.date) qs.set('date', args.date)
      if (args.from) qs.set('from', args.from)
      if (args.to) qs.set('to', args.to)
      if (args.month != null) qs.set('month', String(args.month))
      if (args.year != null) qs.set('year', String(args.year))
      qs.set('fields', fields.join(','))
      const download_url = `${REPORT_BASE}/api/reports/surveys?${qs.toString()}`

      return {
        ok: true,
        event: args.event, type: args.type ?? 'all', period, count: rows.length,
        fields_used: fields, available_fields: allowedKeys, default_fields: defaultFields,
        rows_preview: projected.slice(0, 50), truncated: projected.length > 50,
        download_url, placeholders_excluded,
        ...(withheldFields.length ? {
          restricted: [
            `${withheldFields.join(', ')} — finance-only column(s), left out of this report. ` +
            'Say you cannot include them rather than reporting them as blank.',
          ],
        } : {}),
        note: (chosen.length ? '' : 'Used the default columns — re-call with a subset of available_fields to choose. ') +
          `${rows.length} row(s) for ${period.label}. Download the Excel (.xlsx): ${download_url}` +
          (placeholderClause ? ` ${placeholderClause}` : ''),
      }
    },
  },
  {
    name: 'rerun_radar',
    description:
      "Recurring reruns that need attention, bucketed: overdue (past their next-wave date), prep_window (due within the lead time), and upcoming. Reads the first-class rerun_series_status model (paused/ended series excluded); each item lists client, survey, cadence, last wave, due date, and owner. Pass mine:true to scope to reruns you own. Use for “what reruns are overdue / coming up”.",
    kind: 'read',
    schema: { mine: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { mine?: boolean }
      return data.rerunRadar({ ownerEmail: args.mine ? ctx.userEmail : undefined })
    },
  },

  // -------------------------------------------------------------------------
  // reruns: first-class rerun_series model (migration 073). search/report/ask
  // are reads; the lifecycle tools below are confirmable writes. The first-class
  // model is the source of truth; rerun_radar reads it exclusively (the legacy
  // sheet mirror is retired as a rerun view).
  // -------------------------------------------------------------------------
  {
    name: 'search_reruns',
    description:
      "Search first-class rerun series (the new source of truth for recurring/longitudinal studies) by client / survey name, with optional filters: base_type (PS/B2B), status (in_service / paused / ended / overdue), and owner. Pass mine:true to scope to the reruns you own. Each hit returns the series id, client, survey name, cadence, service mode, whether it's in service / paused / overdue, the owner, and the next due date. Use for “which reruns are overdue / paused / in service”, “list this client's reruns”. For a single triage of what's due this week/month use rerun_calendar; for one series' waves use get_rerun_series.",
    kind: 'read',
    schema: {
      query: z.string().optional(),
      client: z.string().optional(),
      base_type: z.enum(['PS', 'B2B']).optional(),
      status: z.enum(['in_service', 'paused', 'ended', 'overdue']).optional(),
      owner: z.string().optional(),
      mine: z.boolean().optional(),
      limit: z.number().optional(),
    },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as {
        query?: string; client?: string; base_type?: 'PS' | 'B2B'
        status?: 'in_service' | 'paused' | 'ended' | 'overdue'; owner?: string; mine?: boolean; limit?: number
      }
      return data.searchReruns({ ...args, userEmail: ctx.userEmail })
    },
  },
  {
    name: 'get_rerun_series',
    description:
      "Get one rerun series' detail plus all its waves (each wave is a normal survey project: code, dates, N target/collected/actual, survey-tool id, stage/status), ordered by wave number. Identify the series by its id (from search_reruns / rerun_calendar) or by a client / survey-name query. Use for “show me the <survey> rerun series”, “how many waves has <survey> had”, “what's the history of this rerun”.",
    kind: 'read',
    schema: { series: z.string() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { series: string }
      const resolved = await data.resolveRerunSeries(args.series)
      if (resolved === null) return { error: `No rerun series found matching "${args.series}".` }
      if ('ambiguous' in resolved) {
        return { note: 'Multiple rerun series match — specify the series id.', candidates: resolved.ambiguous }
      }
      // ctx: the status row carries future_defaults, which can hold a budget.
      return data.getRerunSeries(resolved.id, ctx)
    },
  },
  {
    name: 'rerun_calendar',
    description:
      "Reruns due within a window, bucketed relative to today (America/New_York): overdue, due within the window, and upcoming (beyond it). window is week (default) / month / quarter. Only in-service, non-paused series are considered. Pass mine:true to scope to the reruns you own. Use for “what reruns are due this week / this month / this quarter”.",
    kind: 'read',
    schema: { window: z.enum(['week', 'month', 'quarter']).optional(), mine: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { window?: 'week' | 'month' | 'quarter'; mine?: boolean }
      return data.rerunCalendar({ ...args, userEmail: ctx.userEmail })
    },
  },
  {
    name: 'put_in_rerun_service',
    description:
      "Put a project into rerun service — promote it to Wave 1 of a new first-class rerun series so future waves are tracked (and auto-spawned in 'auto' mode). Needs the project, its base_type (PS/B2B), and a cadence (monthly / quarterly / semiannual / yearly / adhoc — adhoc = no fixed cadence). Optional service_mode (auto = spawn automatically, manual = create each wave by hand; default auto) and delivery_cadence note. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      base_type: z.enum(['PS', 'B2B']),
      cadence: z.enum(['monthly', 'quarterly', 'semiannual', 'yearly', 'adhoc']),
      service_mode: z.enum(['auto', 'manual']).optional(),
      delivery_cadence: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; base_type: 'PS' | 'B2B'
        cadence: 'monthly' | 'quarterly' | 'semiannual' | 'yearly' | 'adhoc'
        service_mode?: 'auto' | 'manual'; delivery_cadence?: string; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      // Re-promotion guard: createSeriesFromProject sweeps a legacy
      // rerun_series_id lineage but NOT an existing first-class series_id, so
      // promoting an already-in-service project would mint a DUPLICATE series.
      if (p.series_id) {
        return { error: 'This project is already in a rerun series.', series_id: p.series_id as string }
      }
      const serviceMode = args.service_mode ?? 'auto'
      const cadenceMonths = cadenceToMonths(args.cadence)
      return confirmable(
        args,
        async () => ({
          summary: `Put ${p.project_code} into ${args.cadence} rerun service (${args.base_type}, ${serviceMode})`,
        }),
        async () => {
          const admin = createAdminClient()
          const { series, waves } = await createSeriesFromProject(
            admin,
            {
              projectId: p.id as string,
              base_type: args.base_type,
              cadence_months: cadenceMonths,
              service_mode: serviceMode,
              delivery_cadence: args.delivery_cadence ?? null,
            },
            `${userEmail} via Claude`
          )
          meta.detail = { created_series: { id: series.id, base_type: args.base_type, cadence: args.cadence, service_mode: serviceMode } }
          return { ok: true, series_id: series.id, client: series.client, survey_name: series.survey_name, wave_count: waves.length }
        }
      )
    },
  },
  {
    name: 'add_survey_to_series',
    description:
      "Add an EXISTING survey to an EXISTING rerun series, so it is tracked as one of that series' waves. Use this when a wave was created by hand, or when a survey should have been part of a series but isn't — it is the fix for a survey that shows up on its own instead of grouped with the rest of the series on the client page. NOT the same as put_in_rerun_service, which promotes a project to Wave 1 of a BRAND-NEW series: using that on a survey whose family already has a series creates a second, duplicate series. Identify the survey by PR code or name, and the series by id or a client / survey-name query. The whole series is renumbered by date afterwards, so other waves' numbers can shift. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      series: z.string(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; series: string; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label } = resolved

      // Answer the two refusable cases HERE as well as in seriesOps, so the
      // model gets a specific, actionable message at preview time rather than an
      // exception after it has already asked the user to confirm.
      if (p.series_id === seriesId) {
        return { ok: true, already: true, series_id: seriesId, note: `Already a wave of ${label}.` }
      }
      if (p.series_id) {
        return {
          error:
            'This survey is already in a different rerun series. Remove it from that one first (remove_survey_from_series), then add it here.',
          series_id: p.series_id as string,
        }
      }

      return confirmable(
        args,
        async () => ({
          summary: `Add ${p.project_code ?? p.project_name} to ${label} as a wave`,
          note: 'The whole series is renumbered by date afterwards, so other wave numbers may shift.',
        }),
        async () => {
          const admin = createAdminClient()
          const { series, waves } = await attachProjectToSeries(
            admin,
            seriesId,
            p.id as string,
            `${userEmail} via Claude`
          )
          meta.detail = { series_id: seriesId, action: 'add_survey_to_series', project: p.project_code }
          return {
            ok: true,
            series_id: series.id,
            survey_name: series.survey_name,
            wave_count: waves.length,
            waves: waves.map((w) => ({ wave: w.rerun_number, project_code: w.project_code, name: w.project_name })),
          }
        }
      )
    },
  },
  {
    name: 'remove_survey_from_series',
    description:
      "Take a survey OUT of its rerun series, so it stands alone again. Clears the series link, the lineage pointer and any manual wave order, and resets its wave number. The remaining waves are renumbered, so their numbers may shift. Wave 1 cannot be removed — the series is anchored to it, so end the series instead (end_rerun) or add another survey first. Every cleared value is written to the change history, so this is recoverable. Identify the survey by PR code or name. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      if (!p.series_id) {
        return { error: 'This survey is not in a rerun series, so there is nothing to remove it from.' }
      }

      return confirmable(
        args,
        async () => ({
          summary: `Remove ${p.project_code ?? p.project_name} from its rerun series`,
          note: 'The remaining waves are renumbered, so their wave numbers may shift. Recoverable from the change history.',
        }),
        async () => {
          const admin = createAdminClient()
          const { seriesId, waves } = await detachProjectFromSeries(
            admin,
            p.id as string,
            `${userEmail} via Claude`
          )
          meta.detail = { series_id: seriesId, action: 'remove_survey_from_series', project: p.project_code }
          return {
            ok: true,
            series_id: seriesId,
            remaining_wave_count: waves.length,
            waves: waves.map((w) => ({ wave: w.rerun_number, project_code: w.project_code, name: w.project_name })),
          }
        }
      )
    },
  },
  {
    name: 'set_rerun_defaults',
    description:
      "Set the defaults every FUTURE wave of a rerun series inherits — N target, audience, money model, template, and the per-series compliance-required override. Only the fields you pass are changed; the rest are left as-is. Identify the series by id or a client / survey-name query. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      series: z.string(),
      n_target: z.number().optional(),
      audience: z.string().optional(),
      money_model: z.string().optional(),
      template_id: z.string().optional(),
      compliance_required_override: z.boolean().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        series: string; n_target?: number; audience?: string; money_model?: string
        template_id?: string; compliance_required_override?: boolean; confirm?: boolean
      }
      const { userEmail } = ctx
      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label, series: statusRow } = resolved
      const admin = createAdminClient()
      const provided: Record<string, unknown> = {}
      if (args.n_target !== undefined) provided.n_target = args.n_target
      if (args.audience !== undefined) provided.audience = args.audience
      if (args.money_model !== undefined) provided.money_model = args.money_model
      if (args.template_id !== undefined) provided.template_id = args.template_id
      if (args.compliance_required_override !== undefined) provided.compliance_required_override = args.compliance_required_override
      if (Object.keys(provided).length === 0) {
        return { needs: 'a change', message: 'Specify at least one default to set: n_target, audience, money_model, template_id, or compliance_required_override.' }
      }
      // The merge reads the STORED blob and writes it back whole, so a caller
      // who can't see budget still can't clear one: their audience edit carries
      // the existing finance keys through untouched. Only what LEAVES is filtered
      // (future_defaults is untyped jsonb — nextWaveInherit reads a `budget` key
      // out of it), which is why the strip is on the way out and not on the way in.
      const merged = { ...((statusRow.future_defaults ?? {}) as Record<string, unknown>), ...provided }
      const canViewFinancials = await data.callerCanViewFinancials(ctx)
      const changeDesc = Object.entries(provided).map(([k, v]) => `${k} → ${v ?? '—'}`).join(', ')
      return confirmable(
        args,
        async () => ({ summary: `Set rerun defaults for ${label}: ${changeDesc}`, changes: provided }),
        async () => {
          const { series } = await setSeriesDefaults(admin, seriesId, merged, `${userEmail} via Claude`)
          meta.detail = { series_id: seriesId, defaults: provided }
          return {
            ok: true,
            series_id: series.id,
            future_defaults: data.redactFutureDefaults(series.future_defaults, canViewFinancials),
          }
        }
      )
    },
  },
  {
    name: 'pause_rerun',
    description:
      "Pause a rerun series — auto-spawn stops and it drops off the due calendar until resumed. Identify the series by id or a client / survey-name query. If a next wave was already spawned but hasn't started fielding, the preview flags it; pass cancel_pending:true to cancel that wave too (else it's left as-is). Preview first; confirm to apply.",
    kind: 'write',
    schema: { series: z.string(), cancel_pending: z.boolean().optional(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { series: string; cancel_pending?: boolean; confirm?: boolean }
      const { userEmail } = ctx
      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label } = resolved
      const admin = createAdminClient()
      return confirmable(
        args,
        async () => {
          const dry = await pauseSeries(admin, seriesId, { dryRun: true }, `${userEmail} via Claude`)
          const pw = dry.pendingWave
          return {
            summary:
              `Pause rerun service for ${label}` +
              (pw ? ` — a pending un-fielded wave (${pw.project_code ?? pw.project_name}) exists; pass cancel_pending:true to cancel it too, else it's left as-is` : ''),
            pending_wave: pw,
          }
        },
        async () => {
          const { series, pendingWave } = await pauseSeries(admin, seriesId, { cancelPending: args.cancel_pending === true }, `${userEmail} via Claude`)
          meta.detail = { series_id: seriesId, action: 'pause', cancelled_pending: args.cancel_pending === true && !!pendingWave }
          return { ok: true, series_id: series?.id, paused: series?.paused, pending_wave: pendingWave }
        }
      )
    },
  },
  {
    name: 'resume_rerun',
    description:
      "Resume a paused rerun series — auto-spawn restarts and it rejoins the due calendar. The next due date is rebased off today so it isn't instantly overdue. Identify the series by id or a client / survey-name query. Preview first; confirm to apply.",
    kind: 'write',
    schema: { series: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { series: string; confirm?: boolean }
      const { userEmail } = ctx
      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label } = resolved
      const admin = createAdminClient()
      return confirmable(
        args,
        async () => ({ summary: `Resume rerun service for ${label}` }),
        async () => {
          const { series } = await resumeSeries(admin, seriesId, `${userEmail} via Claude`)
          meta.detail = { series_id: seriesId, action: 'resume' }
          return { ok: true, series_id: series.id, paused: series.paused }
        }
      )
    },
  },
  {
    name: 'end_rerun',
    description:
      "End a rerun series — it's taken out of service permanently (no more waves, off the due calendar). Use resume_rerun for a temporary stop instead. Identify the series by id or a client / survey-name query. If a next wave was already spawned but hasn't started fielding, the preview flags it; pass cancel_pending:true to cancel that wave too. Preview first; confirm to apply.",
    kind: 'write',
    schema: { series: z.string(), cancel_pending: z.boolean().optional(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { series: string; cancel_pending?: boolean; confirm?: boolean }
      const { userEmail } = ctx
      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label } = resolved
      const admin = createAdminClient()
      return confirmable(
        args,
        async () => {
          const dry = await endSeries(admin, seriesId, { dryRun: true }, `${userEmail} via Claude`)
          const pw = dry.pendingWave
          return {
            summary:
              `End rerun service for ${label}` +
              (pw ? ` — a pending un-fielded wave (${pw.project_code ?? pw.project_name}) exists; pass cancel_pending:true to cancel it too, else it's left as-is` : ''),
            pending_wave: pw,
          }
        },
        async () => {
          const { series, pendingWave } = await endSeries(admin, seriesId, { cancelPending: args.cancel_pending === true }, `${userEmail} via Claude`)
          meta.detail = { series_id: seriesId, action: 'end', cancelled_pending: args.cancel_pending === true && !!pendingWave }
          return { ok: true, series_id: series?.id, in_service: series?.in_service, pending_wave: pendingWave }
        }
      )
    },
  },
  {
    name: 'create_next_wave',
    description:
      "Manually create (spawn) the next wave of a rerun series now — the new wave inherits the series' future defaults (N target, audience, captain, etc.) with run data reset. This also arms auto-spawn going forward. Identify the series by id or a client / survey-name query. If a wave can't be created (e.g. one is already pending), the result explains why. Preview first; confirm to apply.",
    kind: 'write',
    schema: { series: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { series: string; confirm?: boolean }
      const { userEmail } = ctx
      const resolved = await data.resolveSeriesForWrite(args.series)
      if ('error' in resolved) return resolved
      if ('note' in resolved) return resolved
      const { seriesId, label, series: statusRow } = resolved
      const admin = createAdminClient()
      const nextNo = statusRow.next_wave_no
      return confirmable(
        args,
        async () => ({ summary: `Create wave ${nextNo} for ${label} now` }),
        async () => {
          const { series, spawn } = await spawnNextWave(admin, seriesId, `${userEmail} via Claude`)
          meta.detail = { series_id: seriesId, action: 'create_next_wave', spawn }
          if (!spawn.created) return { ok: false, series_id: series.id, skipped: true, reason: spawn.reason }
          // Link the audit/telemetry row to the newly-created wave (consistent
          // with the other project-scoped writes).
          if (spawn.waveId) meta.project_id = spawn.waveId
          return { ok: true, series_id: series.id, wave: { id: spawn.waveId, name: spawn.waveName } }
        }
      )
    },
  },
  {
    name: 'ops_metrics',
    description:
      "Operational analytics for a period — on-time delivery %, avg cycle time (submitted→delivered), avg fielding time (launched→delivered), N target vs collected vs actual (+ collection %), actual spend, and a PS/B2B/Rerun breakdown, with an equal-length prior-period comparison. Budget vs spend (budget / over_budget / budget_used_pct) is finance-only: if those keys are absent from `metrics`, budget was NOT measured — read the `restricted` note and say so rather than reporting nothing over budget. Scoped to projects whose chosen `event` date falls in the period — default event is 'delivered' (deliver_date); pass 'submitted'/'launched' to measure intake/launch cohorts. Same flexible period as survey_stats (month+year / year / date / from-to). Mirrors the in-app Insights definitions.",
    kind: 'read',
    schema: {
      event: z.enum(['submitted', 'launched', 'delivered']).optional(),
      type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
      month: z.number().int().min(1).max(12).optional(),
      year: z.number().int().min(2000).max(2100).optional(),
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      compare: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as {
        event?: SurveyEvent; type?: SurveyType; month?: number; year?: number
        date?: string; from?: string; to?: string; compare?: boolean
      }
      const period = resolvePeriod(args)
      if ('error' in period) return { error: period.error }
      const event = args.event ?? 'delivered'
      // A portfolio budget total is the same restricted number, summed — so the
      // budget/over-budget/used-% three are absent without the capability, and
      // metrics.restricted says so. The summary line has to follow suit, hence
      // the null check instead of the old `m.budget > 0`.
      const canViewFinancials = await data.callerCanViewFinancials(ctx)
      const m = await opsMetrics({
        event, from: period.from, to: period.to, type: args.type,
        compare: args.compare ?? true, canViewFinancials,
      })
      const summary =
        `${period.label}: ${m.count} ${event}` +
        ` · on-time ${m.on_time_pct ?? '—'}%${m.on_time_denom ? ` (${m.on_time_denom})` : ''}` +
        (m.avg_cycle_days != null ? ` · cycle ${m.avg_cycle_days}d` : '') +
        (m.avg_fielding_days != null ? ` · fielding ${m.avg_fielding_days}d` : '') +
        (m.collection_pct != null ? ` · collection ${m.collection_pct}%` : '') +
        ` · spend $${m.actual_spend.toLocaleString('en-US')}` +
        (m.budget != null && m.budget > 0 ? ` / $${m.budget.toLocaleString('en-US')} budget (${m.over_budget} over)` : '') +
        ` · PS ${m.by_type.PS} / B2B ${m.by_type.B2B} / Rerun ${m.by_type.Rerun}` +
        (m.prior ? ` · prior ${m.prior.count} delivered, on-time ${m.prior.on_time_pct ?? '—'}%` : '')
      return { ok: true, event, type: args.type ?? 'all', period, metrics: m, summary }
    },
  },
  {
    name: 'whats_at_risk',
    description:
      "One triage call for everything on the active board that needs attention now, bucketed by risk DIMENSION and severity-sorted: overdue (due date strictly passed, with days_overdue), due_soon (due today through +3 days, with days_until — days_until 0 means due today), fielding_behind (in Fielding, under target, due within the window — includes a projected final N and shortfall extrapolated from the collection rate so far), over_budget (actual spend > budget, with the overage), and reruns_overdue (recurring reruns past their due date). A project can appear in more than one bucket (e.g. overdue AND over budget) — `at_risk_count` is the DISTINCT project count, so use it for the headline rather than summing buckets. Pass mine:true to scope projects to your captained work and reruns to the ones you own. Use for “what needs my attention” / “what’s at risk” / “what’s slipping”.",
    kind: 'read',
    schema: { mine: z.boolean().optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { mine?: boolean }
      return data.whatsAtRisk({ mine: args.mine, userId: ctx.userId, userEmail: ctx.userEmail })
    },
  },
  {
    name: 'get_change_history',
    description:
      "Recent field-level change history for one project, from the audit log: which field changed, old → new value, who changed it, and when (newest first, includes app / AI / sync / manual edits). Use for “what changed on <project>”, “who set the due date”, “when did N target change”. Default 20 most recent; pass limit up to 100. Changes to finance-only fields (budget, price per N) are omitted unless you hold finance access, and named in `restricted` — never report those fields as unchanged.",
    kind: 'read',
    schema: { project: z.string(), limit: z.number().int().min(1).max(100).optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { project: string; limit?: number }
      return data.getChangeHistory(args.project, args.limit, ctx)
    },
  },
  {
    name: 'undo_last_change',
    description:
      "Revert the most recent EDIT to a project (from the audit log), preview-then-confirm. A single edit may have changed several fields at once; this reverts them together. Only plain content fields are auto-revertible (name, dates, N targets, audience, budget, flags, next-steps, survey/slack links); status/stage, spend/money-lines, relational fields, and a segmented project's N totals are skipped with a reason (use the dedicated tool or the app). Preview returns a `revert_token`; pass it back with confirm:true to apply (it refuses if a newer edit slipped in). Use for “undo that / revert the last edit / put the due date back”.",
    kind: 'write',
    schema: { project: z.string(), confirm: z.boolean().optional(), revert_token: z.string().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; confirm?: boolean; revert_token?: string }
      const { userEmail } = ctx
      const resolved = await data.resolveProject(args.project)
      if (resolved === null) return { error: `No project found matching "${args.project}".` }
      if ('ambiguous' in resolved) {
        return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
      }
      const p = resolved as { id: string; project_code?: string | null; segment_count?: number | null }
      // ctx: the batch's rows are audit rows, old value and new value in the
      // clear. getLastChangeBatch drops the finance-only ones for a caller who
      // can't see them and names them in restricted_fields, so this tool neither
      // reads a ceiling aloud nor reverts a number the caller can't read.
      const batch = await data.getLastChangeBatch(p.id, ctx)
      if (!batch) return { note: 'No recorded change history for this project — nothing to undo.' }
      if (batch.rows.length === 0) {
        // "Nothing to undo" would read as "nothing changed", which is false when
        // the whole edit was finance-only.
        return batch.restricted_fields.length > 0
          ? {
              note: `The last edit (by ${batch.changed_by}) only touched finance-only field(s) — ${[...new Set(batch.restricted_fields)].join(', ')} — which I can't see or undo. Someone with finance access can revert it in the app.`,
            }
          : { note: 'No recorded change history for this project — nothing to undo.' }
      }
      const token = batch.changed_at // the whole edit (one transaction) is pinned by its timestamp

      // A segmented project's N totals are trigger-derived from its segments; reverting the
      // parent directly would desync it (and the trigger would later clobber it), so skip
      // them here just as update_project refuses them — same guard.
      const segmented = ((p.segment_count as number | null) ?? 0) > 0
      const SEGMENT_OWNED_N = new Set(['n_target', 'n_collected', 'n_actual', 'n_internal_target'])
      const revertible: { field: string; old_value: string | null; new_value: string | null }[] = []
      // Seeded with the finance-only rows that never reached us, so a partial
      // undo doesn't read as a total one.
      const skipped: { field: string; reason: string }[] = [...new Set(batch.restricted_fields)].map(field => ({
        field, reason: 'a finance-only field — someone with finance access can revert it in the app',
      }))
      for (const r of batch.rows) {
        if (!UNDOABLE_FIELDS.has(r.field)) { skipped.push({ field: r.field, reason: describeUnrevertible(r.field) }); continue }
        if (segmented && SEGMENT_OWNED_N.has(r.field)) { skipped.push({ field: r.field, reason: describeUnrevertible(r.field) }); continue }
        revertible.push(r)
      }
      if (revertible.length === 0) {
        return {
          note: `The last edit (by ${batch.changed_by}) touched ${skipped.map(s => s.field).join(', ')} — none of which I can auto-undo (${skipped.map(s => `${s.field}: ${s.reason}`).join('; ')}).`,
          last_change: batch.rows,
        }
      }
      const describeReverts = (rs: typeof revertible) =>
        rs.map(r => `${fieldLabel(r.field)} ${fmtChangeVal(r.new_value)} → ${fmtChangeVal(r.old_value)}`).join('; ')
      return confirmable(
        args,
        async () => ({
          summary: `Revert ${revertible.length} field(s) from the last edit (by ${batch.changed_by} at ${batch.changed_at}): ${describeReverts(revertible)}`,
          reverting: revertible.map(r => ({ field: r.field, from: r.new_value, to: r.old_value })),
          skipped,
          revert_token: token,
          note: (skipped.length
            ? `${skipped.length} field(s) from that edit can't be auto-undone and will be left as-is: ${skipped.map(s => s.field).join(', ')}. `
            : '') + 'Confirm by passing this revert_token back with confirm:true.',
        }),
        async () => {
          if (!args.revert_token) {
            return { error: 'Pass the revert_token from the preview with confirm:true so the exact edit being undone is pinned.' }
          }
          if (args.revert_token !== token) {
            return { error: 'The latest edit is no longer the one you previewed (something changed since) — re-run undo_last_change to see the current last edit.' }
          }
          const patch: Record<string, unknown> = {}
          for (const r of revertible) patch[r.field] = r.old_value
          const supabase = createAdminClient()
          const res = await runProjectWrite(supabase, { id: p.id, patch, actor: `${userEmail} via Claude` })
          if ('error' in res) return res
          meta.project_id = p.id
          meta.detail = { undo: { fields: revertible.map(r => r.field) } }
          return {
            ok: true,
            reverted: revertible.map(r => ({ field: r.field, from: r.new_value, to: r.old_value })),
            skipped,
            project_code: (res as { project_code?: string | null }).project_code ?? p.project_code ?? null,
          }
        }
      )
    },
  },
  {
    name: 'reconcile_project',
    description:
      "Cross-field consistency check for ONE project: does actual_spend match Σ(cpi×collected)+Σ(bid×completes); do segment N totals sum to the project N; is a survey-ID discrepancy flagged; are the dates in a sane order — plus advisory notes (supplier N collected vs the delivered N, which legitimately differ via QA attrition; sheet copy behind the app). Returns the failing `issues`, `advisories`, and the full `checks`. Use for “does <project>'s money/N add up”, “is anything off on <project>”, or to explain a spend/N number that looks wrong.",
    kind: 'read',
    schema: { project: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { project: string }
      return health.reconcileProject(args.project)
    },
  },
  {
    name: 'data_health',
    description:
      "Portfolio-wide anomaly scan — runs the reconcile_project checks over every project and returns the ones with real integrity issues (spend mismatch, segment totals off, survey-ID discrepancy, impossible date order), with counts_by_check and separate advisory_counts. Defaults to the active operational set; pass active_only:false to scan all non-deleted projects. Use for “is our data healthy / anything drifting”, a spend audit, or a pre-report sanity pass.",
    kind: 'read',
    schema: { active_only: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
    handler: async (rawArgs) => {
      const args = rawArgs as { active_only?: boolean; limit?: number }
      return health.dataHealth(args)
    },
  },
  {
    name: 'pipeline_throughput',
    description:
      "Stage-timing analytics from the live board + stage history: per active stage (Submitted → Data QA) the current WIP count (from the authoritative board column), and for the tracked stages (Doc Programming onward) the median/avg days completed passes took, plus projects aging in their current stage past `stuck_days` (default 14). Active work only — Delivery (done) isn't measured; `untracked` counts active projects not yet in a timed stage (e.g. still in Submitted). Pass mine:true to scope to your captained projects. Use for “where are things bottlenecking”, “how long does Survey Programming take”, or “what's been stuck too long”.",
    kind: 'read',
    schema: { mine: z.boolean().optional(), stuck_days: z.number().int().min(1).max(365).optional() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { mine?: boolean; stuck_days?: number }
      return health.pipelineThroughput({ mine: args.mine, userId: ctx.userId, stuck_days: args.stuck_days })
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
    // ctx is what tells getClientHistory who is asking; without it the finance
    // check answers false for everyone and the three holders lose the numbers
    // they're entitled to.
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { client: string }
      return data.getClientHistory(args.client, ctx)
    },
  },
  {
    name: 'get_project_history',
    description:
      "A project's prior/sibling waves if it's part of a longitudinal/rerun series (key stats per wave, ordered).",
    kind: 'read',
    schema: { project: z.string() },
    handler: async (rawArgs, ctx) => {
      const args = rawArgs as { project: string }
      return data.getProjectHistory(args.project, ctx)
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
      "Update a project's fields (preview first; confirm to apply). Handles name, client, type, captain/co-captains, salesperson, priority, all dates, the N target RANGE (n_target is the minimum, n_target_max the maximum — pass both when the user gives a range; passing one end alone pulls the other end along to match, which the preview shows), n_internal_target/n_collected/n_actual, audience_size, the free-text audience, category, objective, sprint_number, budget (finance-only — refused if you don't hold finance access), the Y/N flags, survey_tool_id, slack channel, latest/next-steps, and the gen-pop N-floor override (n_floor_override + n_floor_override_reason). For status/stage moves use advance_project/approve_scoping/set_project_status; for compliance override, requested-by, or linked docs use their tools; for a project whose N is split into segments, use add_segment/update_segment/remove_segment.",
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

      // Finance-only fields are finance-only to WRITE too. Without the
      // capability the old value is redacted out of the preview (below), so the
      // caller would be replacing a ceiling they cannot read — and the audit row
      // their edit creates is invisible to them afterwards. A refusal that names
      // the field is a better answer than a half-supported write.
      const canViewFinancials = await data.callerCanViewFinancials(ctx)
      const restrictedInPatch = Object.keys(patch).filter(data.isRestrictedMoneyField)
      if (restrictedInPatch.length > 0 && !canViewFinancials) {
        return {
          error: `${restrictedInPatch.join(', ')} — finance-only, so I can't set it (or read the current value back to you). Someone with finance access can change it in the app.`,
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
        ('n_target' in patch || 'n_target_max' in patch || 'n_collected' in patch || 'n_actual' in patch) &&
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

      // One end of the N range moved past the other? Send both, or migration
      // 078's trigger raises and "set N target to 2,000" fails on a 1,000–1,200
      // project. The pulled-along end shows up in `changed` below, so the user
      // sees it in the preview before confirming.
      const aligned = alignNRangePatch(p, patch)

      // `p` came from a select('*'), so the diff carries the OLD value of every
      // field the patch names — the previous ceiling included. The refusal above
      // already keeps a restricted field out of a non-holder's patch; this is the
      // second line, and it covers all three places the diff surfaces at once:
      // the preview, the commit result, and meta.detail (which telemetry writes
      // into mcp_tool_calls, a table analysts can read). Holders see the whole
      // diff — redactRestrictedMoney passes their row straight through.
      const changed = data.redactRestrictedMoney(
        diffSummary(p, aligned), canViewFinancials
      ) as Record<string, [unknown, unknown]>
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
            patch: aligned,
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
      "Add an N segment to a project — e.g. split N into Buyers / Sellers, each with its own target. Adding the first segment converts the project to a segmented N (its total N becomes the sum of the segments). A segment's target is a RANGE: `target` is the minimum and `target_max` the maximum — pass both when the segment was sold as a range, or just `target` for a single agreed number. If the label or target isn't given, ask before adding. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      label: z.string().min(1).max(120),
      target: z.number().int().nullable().optional(),
      target_max: z.number().int().nullable().optional(),
      collected: z.number().int().nullable().optional(),
      actual: z.number().int().nullable().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; label: string; target?: number | null; target_max?: number | null
        collected?: number | null; actual?: number | null; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      // Idempotency guard: don't add a second segment with the same label (a
      // retried confirm would otherwise duplicate it). Point to update_segment.
      const dupSeg = await resolveSegment(p.id as string, args.label)
      if (dupSeg && !('ambiguous' in dupSeg)) {
        const dupRow = dupSeg as Record<string, unknown>
        if (String(dupRow.label ?? '').trim().toLowerCase() === args.label.trim().toLowerCase()) {
          return { note: `A segment "${args.label}" already exists on ${p.project_code} — nothing added (use update_segment to change it).`, segment_id: dupRow.id }
        }
      }
      const existing = (p.segment_count as number | null) ?? 0
      // Both ends of the range are rejected as a pair before anything is written —
      // migration 078's trigger raises on max < min, and a raise from inside the
      // RPC comes back as an opaque failure instead of something actionable.
      if (isInvertedNRange(args.target, args.target_max)) {
        return { error: `target_max (${fmtNum(args.target_max)}) can't be below target (${fmtNum(args.target)}) — the range is the other way round.` }
      }
      return confirmable(
        args,
        async () => ({
          summary:
            `Add segment "${args.label}" (target ${formatNRange(args.target, args.target_max)}, collected ${fmtNum(args.collected ?? 0)}) to ${p.project_code}` +
            (existing === 0
              ? ' — this splits its single N into segments; the total N becomes the sum of the segments'
              : ` (segment ${existing + 1})`),
        }),
        async () => {
          const row = await runAddSegment({
            projectId: p.id as string,
            label: args.label,
            target: args.target ?? null,
            targetMax: args.target_max ?? null,
            collected: args.collected ?? null,
            actual: args.actual ?? null,
            actor: `${userEmail} via Claude`,
          })
          meta.detail = { created_segment: { id: row.id, label: row.label } }
          return { ok: true, segment: { id: row.id, label: row.label, n_target: row.n_target, n_target_max: row.n_target_max, n_collected: row.n_collected, n_actual: row.n_actual } }
        }
      )
    },
  },
  {
    name: 'update_segment',
    description:
      "Edit an N segment's label or numbers (the target RANGE — target is the minimum, target_max the maximum — plus collected / actual). Identify the segment by its name or id. Moving one end of the range past the other pulls the other end along to match (shown in the preview). If it's unclear which segment, ask. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      segment_ref: z.string(),
      label: z.string().min(1).max(120).optional(),
      target: z.number().int().nullable().optional(),
      target_max: z.number().int().nullable().optional(),
      collected: z.number().int().nullable().optional(),
      actual: z.number().int().nullable().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; segment_ref: string; label?: string; target?: number | null; target_max?: number | null
        collected?: number | null; actual?: number | null; confirm?: boolean
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
      if (args.target_max !== undefined) patch.n_target_max = args.target_max
      if (args.collected !== undefined) patch.n_collected = args.collected
      if (args.actual !== undefined) patch.n_actual = args.actual
      if (Object.keys(patch).length === 0) {
        return { needs: 'a change', message: 'Specify at least one of: label, target, target_max, collected, actual.' }
      }
      // Only a pair the caller sent WHOLE can be transposed; one end on its own
      // is handled by alignNRangePatch below, not refused.
      if (isInvertedNRange(args.target, args.target_max)) {
        return { error: `target_max (${fmtNum(args.target_max)}) can't be below target (${fmtNum(args.target)}) — the range is the other way round.` }
      }
      // project_segments carries the same range trigger as survey_projects, so a
      // one-ended edit that crosses the stored other end has to move both.
      const aligned = alignNRangePatch(seg as Record<string, unknown>, patch)
      const desc = [
        args.label !== undefined ? `label → "${args.label}"` : null,
        'n_target' in aligned ? `target → ${fmtNum(aligned.n_target as number | null)}` : null,
        'n_target_max' in aligned ? `target max → ${fmtNum(aligned.n_target_max as number | null)}` : null,
        args.collected !== undefined ? `collected → ${fmtNum(args.collected ?? 0)}` : null,
        args.actual !== undefined ? `actual → ${fmtNum(args.actual)}` : null,
      ].filter(Boolean).join(', ')
      return confirmable(
        args,
        async () => ({ summary: `Update segment "${seg.label}" on ${p.project_code}: ${desc}` }),
        async () => {
          const row = await runUpdateSegment(seg.id as string, aligned, `${userEmail} via Claude`)
          meta.detail = { segment_id: row.id, updated: aligned }
          return { ok: true, segment: { id: row.id, label: row.label, n_target: row.n_target, n_target_max: row.n_target_max, n_collected: row.n_collected, n_actual: row.n_actual } }
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
      "Log (or update) a B2B blast against a project — its $/bid (the per-completion reward), the # of people it went to, the # of those who COMPLETED the survey, when it ran (optional), and an optional description of the audience. Its cost is $/bid × # of completes (we only pay people who completed, not everyone reached), and that counts toward the project's spend. If $/bid or # of people is missing, ask. If completes aren't known yet, pass 0 (spend stays $0 for this blast) — then fill them in later by re-calling with the SAME idem_key (it upserts, like log_launch), or via update_blast. You can also ingest a blast-platform campaign screenshot: per blast, map Reward→bid, that blast's Sent→people, Rewards Count→completes (so spend matches the platform's Total Issued; NOT the higher \"Completed\" count), its Scheduled date/time→blast_at, and channel/audience/template→description; resolve the project by campaign name or Survey ID, and set idem_key to \"<SurveyID>#<BlastLabel>\" so re-importing the same screenshot updates that same blast instead of double-logging. Preview first (shows create vs update); confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      bid: z.number().min(0),
      people: z.number().int().min(0),
      completes: z.number().int().min(0).optional(),
      blast_at: z.string().optional(),
      description: z.string().max(1000).optional(),
      confirm: z.boolean().optional(),
      idem_key: z.string().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; bid: number; people: number; completes?: number; blast_at?: string
        description?: string; confirm?: boolean; idem_key?: string
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      const completes = args.completes ?? 0
      const thisBlastTotal = blastTotal({ bid: args.bid, completes })
      const currentSpend = (p.actual_spend as number | null) ?? 0

      // Upsert on idem_key: if a blast with this idem_key already exists on the
      // project, re-logging UPDATES it (bid/people/completes/blast_at/description)
      // instead of no-op'ing — parity with log_launch's label upsert. Only an
      // explicit idem_key can collide; a bare call gets a fresh UUID → always new.
      const existing = args.idem_key ? await resolveBlast(p.id as string, args.idem_key) : null
      // Projected project spend: on update, swap this blast's OLD contribution for
      // the new one; on create, add it.
      const priorContribution = existing ? blastTotal({ bid: existing.bid, completes: existing.completes }) : 0
      const projectedSpend = currentSpend - priorContribution + thisBlastTotal

      return confirmable(
        args,
        async () => ({
          summary:
            `${existing ? 'Update' : 'Log'} blast on ${p.project_code}: ${completes} completes / ${args.people} people @ $${args.bid}/bid = ${money(thisBlastTotal)} → projected spend ${money(projectedSpend)}` +
            (existing ? ' (updates the existing blast with this idem_key — no duplicate)' : ''),
          mode: existing ? 'update' : 'create',
          people: args.people, completes, bid: args.bid, blast_at: args.blast_at ?? null,
          projected_actual_spend: projectedSpend,
        }),
        async () => {
          const row = await runLogBlast({
            projectId: p.id as string, bid: args.bid, people: args.people, completes,
            blastAt: args.blast_at ?? null, note: args.description ?? null,
            createdBy: userEmail.split('@')[0], idemKey: args.idem_key ?? randomUUID(),
            actor: `${userEmail} via Claude`,
          })
          const blast_spend_total = totalBidDollars(await listBlastsForProject(p.id as string) as never)
          meta.detail = { [existing ? 'updated' : 'created']: { id: row.id, people: row.people, completes: row.completes, bid: row.bid } }
          return {
            ok: true, mode: existing ? 'updated' : 'created',
            blast: { id: row.id, people: row.people, completes: row.completes, bid: row.bid, blast_at: row.blast_at },
            blast_spend_total,
          }
        }
      )
    },
  },

  {
    name: 'log_launch',
    description:
      "Log a PS launch (a fielding wave) on a project with its sample-supplier rows — each supplier's name, $/complete (CPI, in dollars e.g. 0.75), an optional per-supplier cap, and # collected so far. A PS project can have several launches; call once per launch. Actual spend = Σ(CPI × collected) — pay per complete, like blasts — and rolls up to the project automatically. Pass a target (goal N for the launch) so the pre-fielding estimate range shows, and an optional `note` (freeform — e.g. why this wave, supplier issues, timing). Supplier names not already in the roster are added. If the source has a Survey# (e.g. from a supplier-panel screenshot), pass it as `label` — it then serves as the stable unique key to update this same launch later (re-import = upsert, not a duplicate). Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      label: z.string().max(120).optional(),
      launch_date: z.string().optional(),
      target: z.number().int().positive().optional(),
      note: z.string().max(1000).optional(),
      suppliers: z.array(z.object({
        name: z.string().min(1),
        cpi: z.number().min(0),
        cap: z.number().int().positive().optional(),
        n_collected: z.number().int().min(0).default(0),
      })).min(1),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; label?: string; launch_date?: string; target?: number; note?: string
        suppliers: { name: string; cpi: number; cap?: number; n_collected?: number }[]; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      const suppliers: LaunchSupplierInput[] = args.suppliers.map(s => ({
        name: s.name, cpi: s.cpi, cap: s.cap ?? null, n_collected: s.n_collected ?? 0,
      }))
      const lines: SupplierLine[] = suppliers.map(s => ({ cpi: s.cpi, completes_cap: s.cap ?? 0, n_collected: s.n_collected }))
      const target = args.target ?? null
      const est = estimateRange(target, lines)
      const actual = actualCost(lines)

      // Idempotency: if a launch with this EXACT label (e.g. the Survey#) already
      // exists on the project, UPDATE it instead of creating a duplicate — so
      // re-importing the same launch/screenshot upserts, as documented.
      let existingId: string | null = null
      if (args.label && args.label.trim()) {
        const found = await resolveLaunch(p.id as string, args.label.trim())
        if (found && !('ambiguous' in found)) {
          const foundRow = found as Record<string, unknown>
          if (String(foundRow.label ?? '').trim().toLowerCase() === args.label.trim().toLowerCase()) {
            existingId = foundRow.id as string
          }
        }
      }

      return confirmable(
        args,
        async () => ({
          summary:
            `${existingId ? 'Update' : 'Log'} launch${args.label ? ` "${args.label}"` : ''} on ${p.project_code}: ${suppliers.length} suppliers` +
            (target ? `, target ${fmtNum(target)}` : '') +
            ` — actual ${money(actual)}` + (est ? `, est ${money(est.low)}–${money(est.high)}` : '') +
            (existingId ? ' (updates the existing launch with this label — no duplicate)' : ''),
          mode: existingId ? 'update' : 'create',
          target, suppliers, est_low: est?.low ?? null, est_high: est?.high ?? null, actual_spend: actual,
        }),
        async () => {
          if (existingId) {
            await runUpdateLaunch({
              launchId: existingId, projectId: p.id as string,
              label: args.label,
              launchDate: args.launch_date,                          // undefined ⇒ unchanged
              target: args.target != null ? args.target : undefined, // undefined ⇒ unchanged
              note: args.note,                                       // undefined ⇒ unchanged
              suppliers, createdBy: userEmail.split('@')[0],
            })
            const fresh = (await listLaunchesForProject(p.id as string)).find(l => l.id === existingId) ?? null
            meta.detail = { upserted_launch: { id: existingId, label: args.label ?? null, suppliers: suppliers.length } }
            return { ok: true, mode: 'updated', launch: fresh, economics: fresh ? launchEconOut(fresh) : null }
          }
          const launch = await runLogLaunch({
            projectId: p.id as string, label: args.label ?? null, launchDate: args.launch_date ?? null,
            target, note: args.note ?? null, suppliers, createdBy: userEmail.split('@')[0],
          })
          meta.detail = { created_launch: { id: launch.id, label: launch.label, suppliers: launch.suppliers.length } }
          return { ok: true, mode: 'created', launch, economics: launchEconOut(launch) }
        }
      )
    },
  },
  {
    name: 'list_launches',
    description:
      "List a project's PS launches with their supplier rows, actual spend (Σ CPI × collected), and pre-fielding estimate range (target × cheapest…priciest CPI), plus the project rollup.",
    kind: 'read',
    schema: { project: z.string() },
    handler: async (rawArgs) => {
      const args = rawArgs as { project: string }
      const resolved = await data.resolveProject(args.project)
      if (resolved === null) return { error: `No project found matching "${args.project}".` }
      if ('ambiguous' in resolved) return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
      const launches = await listLaunchesForProject(resolved.id as string)
      const lite = launches.map(l => ({ target: l.target ?? null, lines: launchLines(l) }))
      const projActual = projectActualCost(lite)
      const projEst = projectEstimateRange(lite)
      const projCollected = projectCollected(lite)
      const summary = launches.length
        ? `${launches.length} launch(es) on ${resolved.project_code}. Project actual ${money(projActual)}` +
          (projEst ? `, est ${money(projEst.low)}–${money(projEst.high)}` : '') +
          `:\n${launches.map(renderLaunch).join('\n\n')}`
        : `No launches logged on ${resolved.project_code}.`
      return {
        ok: true,
        project: { id: resolved.id, project_code: resolved.project_code, project_name: resolved.project_name },
        launches: launches.map(l => ({ ...l, economics: launchEconOut(l) })),
        project_actual_spend: projActual, project_collected: projCollected,
        project_est_low: projEst?.low ?? null, project_est_high: projEst?.high ?? null,
        summary,
      }
    },
  },
  {
    name: 'update_launch',
    description:
      "Update a PS launch — its label / launch_date / target / note, and/or upsert supplier rows by name (only the fields you pass change; supplier names not present are added). Identify the launch by its label or id — an exact label match wins, so the Survey# used as the launch's label works as a stable key (re-importing a supplier screenshot updates the same launch). Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      launch_ref: z.string(),
      label: z.string().max(120).optional(),
      launch_date: z.string().optional(),
      target: z.number().int().positive().nullable().optional(),
      note: z.string().max(1000).nullable().optional(),
      suppliers: z.array(z.object({
        name: z.string().min(1),
        cpi: z.number().min(0).optional(),
        cap: z.number().int().positive().nullable().optional(),
        n_collected: z.number().int().min(0).optional(),
      })).optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; launch_ref: string; label?: string; launch_date?: string; target?: number | null; note?: string | null
        suppliers?: { name: string; cpi?: number; cap?: number | null; n_collected?: number }[]; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const launch = await resolveLaunch(p.id as string, args.launch_ref)
      if (!launch) return { error: `No launch found matching "${args.launch_ref}" on this project.` }
      if ('ambiguous' in launch) return { note: 'Multiple launches match — be more specific.', candidates: launch.ambiguous }

      const desc = [
        args.label !== undefined ? `label → "${args.label}"` : null,
        args.launch_date !== undefined ? `date → ${args.launch_date}` : null,
        args.target !== undefined ? `target → ${args.target ?? '—'}` : null,
        args.note !== undefined ? `note → "${args.note ?? ''}"` : null,
        args.suppliers?.length ? `${args.suppliers.length} supplier row(s) upserted` : null,
      ].filter(Boolean).join(', ')
      if (!desc) return { needs: 'a change', message: 'Specify at least one of: label, launch_date, target, note, suppliers.' }

      return confirmable(
        args,
        async () => ({ summary: `Update launch "${String(launch.label ?? launch.id)}" on ${p.project_code}: ${desc}` }),
        async () => {
          await runUpdateLaunch({
            launchId: launch.id as string, projectId: p.id as string,
            label: args.label, launchDate: args.launch_date, target: args.target, note: args.note,
            suppliers: args.suppliers as LaunchSupplierPatch[] | undefined, createdBy: userEmail.split('@')[0],
          })
          const fresh = (await listLaunchesForProject(p.id as string)).find(l => l.id === launch.id) ?? null
          meta.detail = { updated_launch: { id: launch.id } }
          return { ok: true, launch: fresh, economics: fresh ? launchEconOut(fresh) : null }
        }
      )
    },
  },
  {
    name: 'remove_launch',
    description:
      "Remove a PS launch (and its supplier rows) from a project. Identify it by label or id. Destructive — preview first; confirm to apply.",
    kind: 'write',
    schema: { project: z.string(), launch_ref: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; launch_ref: string; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const launch = await resolveLaunch(p.id as string, args.launch_ref)
      if (!launch) return { error: `No launch found matching "${args.launch_ref}" on this project.` }
      if ('ambiguous' in launch) return { note: 'Multiple launches match — be more specific.', candidates: launch.ambiguous }

      return confirmable(
        args,
        async () => ({ summary: `Remove launch "${String(launch.label ?? launch.id)}" and its suppliers from ${p.project_code}` }),
        async () => {
          await runRemoveLaunch(launch.id as string)
          meta.detail = { removed_launch: { id: launch.id, label: launch.label ?? null }, by: userEmail }
          return { ok: true, removed: String(launch.label ?? launch.id) }
        }
      )
    },
  },
  {
    name: 'update_blast',
    description:
      "Update a B2B blast on a project — any of its $/bid, # of people, # of completes, when it ran (blast_at), or description. Identify it by `blast_ref` = its idem_key (e.g. \"<SurveyID>#<BlastLabel>\") or its id. Only the fields you pass change (idempotent). Cost = $/bid × completes recomputes into the project's spend. Use this to fill in completes on a blast logged from a campaign Overview tab. Preview first; confirm to apply.",
    kind: 'write',
    schema: {
      project: z.string(),
      blast_ref: z.string(),
      bid: z.number().min(0).optional(),
      people: z.number().int().min(0).optional(),
      completes: z.number().int().min(0).optional(),
      blast_at: z.string().nullable().optional(),
      description: z.string().max(1000).nullable().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; blast_ref: string; bid?: number; people?: number; completes?: number
        blast_at?: string | null; description?: string | null; confirm?: boolean
      }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const blast = await resolveBlast(p.id as string, args.blast_ref)
      if (!blast) return { error: `No blast found matching "${args.blast_ref}" on this project.` }

      // jsonb patch — only the fields passed (description maps to the note column).
      const patch: Record<string, unknown> = {}
      if (args.bid !== undefined) patch.bid = args.bid
      if (args.people !== undefined) patch.people = args.people
      if (args.completes !== undefined) patch.completes = args.completes
      if (args.blast_at !== undefined) patch.blast_at = args.blast_at
      if (args.description !== undefined) patch.note = args.description
      if (Object.keys(patch).length === 0) {
        return { needs: 'a change', message: 'Specify at least one of: bid, people, completes, blast_at, description.' }
      }
      const desc = [
        args.bid !== undefined ? `bid → $${args.bid}` : null,
        args.people !== undefined ? `people → ${args.people}` : null,
        args.completes !== undefined ? `completes → ${args.completes}` : null,
        args.blast_at !== undefined ? `blast_at → ${args.blast_at ?? '—'}` : null,
        args.description !== undefined ? `description → "${args.description ?? ''}"` : null,
      ].filter(Boolean).join(', ')

      return confirmable(
        args,
        async () => ({ summary: `Update blast ${blast.idem_key ? `"${blast.idem_key}"` : blast.id} on ${p.project_code}: ${desc}` }),
        async () => {
          const row = await runUpdateBlast({ blastId: blast.id, patch, actor: `${userEmail} via Claude` })
          const blast_spend_total = totalBidDollars(await listBlastsForProject(p.id as string) as never)
          meta.detail = { updated_blast: { id: row.id, people: row.people, completes: row.completes, bid: row.bid } }
          return {
            ok: true,
            blast: { id: row.id, people: row.people, completes: row.completes, bid: row.bid, blast_at: row.blast_at },
            blast_spend_total,
          }
        }
      )
    },
  },
  {
    name: 'remove_blast',
    description:
      "Remove a B2B blast from a project. Identify it by `blast_ref` = its idem_key or id. Destructive — the project's blast spend recomputes without it. Preview first; confirm to apply.",
    kind: 'write',
    schema: { project: z.string(), blast_ref: z.string(), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; blast_ref: string; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string
      const blast = await resolveBlast(p.id as string, args.blast_ref)
      if (!blast) return { error: `No blast found matching "${args.blast_ref}" on this project.` }

      return confirmable(
        args,
        async () => ({ summary: `Remove blast ${blast.idem_key ? `"${blast.idem_key}"` : blast.id} (${blast.completes} completes @ $${blast.bid}/bid) from ${p.project_code}` }),
        async () => {
          await runRemoveBlast(blast.id, `${userEmail} via Claude`)
          const blast_spend_total = totalBidDollars(await listBlastsForProject(p.id as string) as never)
          meta.detail = { removed_blast: { id: blast.id, idem_key: blast.idem_key ?? null }, by: userEmail }
          return { ok: true, removed: blast.idem_key ?? blast.id, blast_spend_total }
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
      "Move an Active project to a pipeline column, or mark it delivered (preview first; confirm to apply). Enforces the compliance gate (override_reason to proceed) AND, on the deliver transition, the Occam onboarding gate: the first time we deliver to a project's requested-by contact, it blocks (gate:'occam') until you confirm the Occam account invite (welcome email) was sent so the client can actually view the data. The two gates are independent — overriding compliance does NOT skip the Occam check. When it blocks on Occam, re-call with occam_invite_confirmed:true once the invite has gone out (records it, so the contact is never prompted again), or occam_override_reason to deliver without it.",
    kind: 'write',
    schema: {
      project: z.string(),
      to_column: z.string().optional(),
      mark_delivered: z.boolean().optional(),
      override_reason: z.string().optional(),
      occam_invite_confirmed: z.boolean().optional(),
      occam_override_reason: z.string().optional(),
      confirm: z.boolean().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project: string; to_column?: string; mark_delivered?: boolean; override_reason?: string
        occam_invite_confirmed?: boolean; occam_override_reason?: string; confirm?: boolean
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
        rerunNumber: gi.rerunNumber ?? undefined, complianceRequiredOverride: gi.complianceRequiredOverride,
      })
      if (gate.blocked && !args.override_reason) return { blocked: true, gate: 'compliance', reason: gate.message }

      // Occam onboarding gate — only on the deliver transition, only for a first-time
      // requested-by contact. Resolved: occam_invite_confirmed marks the contact invited
      // (so this never re-prompts); override_reason delivers without it (logged).
      let occamContactToMark: string | null = null
      const notes: string[] = []
      if (gate.blocked && args.override_reason) notes.push(`⚠ Compliance override (${gate.phase}): ${args.override_reason}`)
      if (willMarkDelivered) {
        const og = await loadOccamGate(p.id as string)
        const oGate = occamOnboardingGate({
          willMarkDelivered,
          requestedByContactId: og.requestedByContactId,
          projectUsesOccam: og.projectUsesOccam,
          contactHasPriorDelivery: og.contactHasPriorDelivery,
          contactOccamInvited: og.contactOccamInvited,
        })
        if (oGate.blocked) {
          // The Occam gate is resolved ONLY by its own signals — a compliance
          // override_reason must NOT silently clear it (that would skip the invite
          // check for exactly the compliance-sensitive clients most likely to care).
          if (args.occam_invite_confirmed) {
            occamContactToMark = og.requestedByContactId
          } else if (args.occam_override_reason) {
            notes.push(`⚠ Delivered without confirming the Occam invite: ${args.occam_override_reason}`)
          } else {
            const who = og.contactName ? `${og.contactName}${og.contactEmail ? ` <${og.contactEmail}>` : ''}` : 'the requested-by contact'
            return {
              blocked: true, gate: 'occam',
              reason: `${oGate.message} Contact: ${who}. Re-call with occam_invite_confirmed:true once the invite has been sent, or occam_override_reason to deliver without it.`,
            }
          }
        }
      }

      const patch: Record<string, unknown> = { ...stage }
      if (notes.length) {
        patch.latest_next_steps = autoStamp(userEmail.split('@')[0], p.latest_next_steps as string | null, notes.join(' · '))
      }

      return confirmable(
        args,
        async () => ({
          project_code: p.project_code, to: stage.board_column, delivered: willMarkDelivered,
          override: notes.length ? args.override_reason ?? null : null,
          occam_invite_confirmed: occamContactToMark ? true : undefined,
          updated_at: p.updated_at,
        }),
        async () => {
          const supabase = createAdminClient()
          const result = await runProjectWrite(supabase, { id: p.id as string, patch, actor: `${userEmail} via Claude` })
          if ('error' in result) return result
          if (occamContactToMark) await markContactOccamInvited(occamContactToMark, `${userEmail} via Claude`)
          meta.detail = {
            to_column: result.board_column, delivered: willMarkDelivered,
            override_reason: notes.length ? args.override_reason ?? null : null,
            occam_invite_confirmed: !!occamContactToMark,
          }
          return { ok: true, project_code: result.project_code, board_column: result.board_column }
        }
      )
    },
  },
  {
    name: 'set_project_status',
    description: "Set a project's status — Open, Hold, or Archived (Archived = removed from the active board but kept for history; the deliverable itself being sent is the Delivered pipeline stage, not a status). Preview first; confirm to apply.",
    kind: 'write',
    schema: { project: z.string(), status: z.enum(['Open', 'Hold', 'Archived', 'Closed']), confirm: z.boolean().optional() },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as { project: string; status: 'Open' | 'Hold' | 'Archived' | 'Closed'; confirm?: boolean }
      const { userEmail } = ctx
      const p = await resolveProjectWritable(args.project)
      if (!p) return { error: 'Project not found.' }
      if ('error' in p) return p
      if ('ambiguous' in p) return p
      meta.project_id = p.id as string

      // "Archived" is the user-facing label for the stored 'Closed' status.
      const dbStatus = args.status === 'Archived' ? 'Closed' : args.status
      const label = (s: unknown) => (s === 'Closed' ? 'Archived' : s)
      return confirmable(
        args,
        async () => ({ summary: `Status ${fmtChangeVal(label(p.status))} → ${label(dbStatus)}`, from: label(p.status), to: label(dbStatus), updated_at: p.updated_at }),
        async () => {
          const supabase = createAdminClient()
          const result = await runProjectWrite(supabase, { id: p.id as string, patch: { status: dbStatus }, actor: `${userEmail} via Claude` })
          if ('error' in result) return result
          meta.detail = { changed: { status: [label(p.status), label(result.status)] } }
          return { ok: true, project_code: result.project_code, status: label(result.status) }
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
      "Create a new survey project (preview first; confirm to apply). Set ALL provided fields in THIS one call — it accepts the dates (launch/due/deliver/submitted), the N target range (n_target is the minimum, n_target_max the maximum — pass both when the project was sold as a range) + internal target, audience + audience size, budget, row-level flag, the Y/N flags, latest-next-steps, and requested_by (the client contact who requested it — pass their name or email; it resolves an existing contact of that client and tags them) directly, so no follow-up update or set_requested_by is needed. budget is the TOTAL planned $ we intend to SPEND (a cost ceiling, not client revenue) — if the user gives a per-N rate (e.g. \"$37.5/N\"), multiply by the N being collected (usually the internal target) and note the assumption. It is finance-only: without finance access the project is still created and everything else is set, but budget is left blank and `budget_note` says so — pass it on, don't silently drop it. Warns about possible duplicate projects before creating.",
    kind: 'write',
    schema: {
      project_name: z.string(),
      client: z.string(),
      project_type: z.enum(['PS', 'B2B', 'Rerun']).optional(),
      captain: z.string().optional(),
      salesperson: z.string().optional(),
      requested_by: z.string().optional(),
      due_date: z.string().optional(),
      n_target: z.number().int().positive().optional(),
      n_target_max: z.number().int().positive().optional(),
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
      idem_key: z.string().optional(),
    },
    handler: async (rawArgs, ctx, meta) => {
      const args = rawArgs as {
        project_name: string; client: string; project_type?: 'PS' | 'B2B' | 'Rerun'
        captain?: string; salesperson?: string; requested_by?: string; due_date?: string
        n_target?: number; n_target_max?: number
        n_internal_target?: number; audience_size?: number; audience?: string; budget?: number
        launch_date?: string; deliver_date?: string; submitted_date?: string
        row_level_data?: boolean; longitudinal?: boolean; voter_survey_qa?: boolean
        citation_language_needed?: boolean; terminations?: boolean; latest_next_steps?: string
        skip_scoping?: boolean; confirm?: boolean; proceed_despite_duplicate?: boolean; idem_key?: string
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
      if (isInvertedNRange(args.n_target, args.n_target_max)) {
        return { error: `n_target_max (${fmtNum(args.n_target_max)}) can't be below n_target (${fmtNum(args.n_target)}) — the N range is the other way round.` }
      }

      // Canonicalize the client to an EXISTING one when it matches, so e.g. "A4A"
      // links to "Airlines 4 America (A4A)" instead of spawning a duplicate thin
      // client (the client-link trigger exact-matches the firm name). Ambiguous or
      // no match → keep what was given (a genuinely new client is fine).
      let effectiveClient = clientText
      let effectiveClientId: string | null = null
      {
        const resolvedClient = await data.resolveClient(firmNameFrom(clientText))
        if (resolvedClient && !('ambiguous' in resolvedClient)) {
          const suffix = clientText.includes(' - ') ? clientText.slice(clientText.indexOf(' - ')) : ''
          effectiveClient = String((resolvedClient as { name: string }).name) + suffix
          effectiveClientId = String((resolvedClient as { id: string }).id)
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
      // mcp_create_project inserts n_target (the range MINIMUM) but has no
      // n_target_max column in its hand-written insert, so the top of the range
      // rides along in the follow-up write — which goes through mcp_write_project,
      // where 078 did add the arm. Order is safe: the row lands with a null max,
      // and null-either-side is exactly the case 078's trigger lets through.
      if (args.n_target_max != null) extras.n_target_max = args.n_target_max
      if (args.n_internal_target != null) extras.n_internal_target = args.n_internal_target
      if (args.audience_size != null) extras.audience_size = args.audience_size
      if (args.audience != null) extras.audience = args.audience
      // budget is finance-only to WRITE as well as to read (same rule as
      // update_project). Here it's DROPPED with a note rather than refused,
      // because refusing the whole intake over one optional field is the worse
      // outcome — the same shape as the requested-by miss below. The project
      // lands with no ceiling and the note says who can set one.
      let budgetNote: string | null = null
      if (args.budget != null) {
        if (await data.callerCanViewFinancials(ctx)) extras.budget = args.budget
        else budgetNote = `Budget not set — it's finance-only, so I can't write it. Someone with finance access can set it in the app.`
      }
      if (args.launch_date) extras.launch_date = args.launch_date
      if (args.deliver_date) extras.deliver_date = args.deliver_date
      if (args.row_level_data != null) extras.row_level_data = args.row_level_data
      if (args.longitudinal != null) extras.longitudinal = args.longitudinal
      if (args.voter_survey_qa != null) extras.voter_survey_qa = args.voter_survey_qa
      if (args.citation_language_needed != null) extras.citation_language_needed = args.citation_language_needed
      if (args.terminations != null) extras.terminations = args.terminations
      if (args.latest_next_steps) extras.latest_next_steps = args.latest_next_steps

      // Requested-by: resolve the named person against the (existing) client's
      // contacts and tag them right here, so create_project lands requested-by in
      // one call instead of relying on a follow-up set_requested_by (which the model
      // kept skipping). New client / no match → note it, don't block the create.
      let requestedByNote: string | null = null
      if (args.requested_by) {
        if (!effectiveClientId) {
          requestedByNote = `Requested-by "${args.requested_by}" not set — "${normalizeClientText(effectiveClient)}" is a new client with no contacts yet. Add the contact, then set requested-by.`
        } else {
          const contact = await resolveContact(effectiveClientId, args.requested_by)
          if (contact && 'ambiguous' in contact) {
            return { note: `Multiple contacts match "${args.requested_by}" for this client — say which one and I'll retry.`, candidates: contact.ambiguous }
          } else if (contact) {
            const name = `${String(contact.first_name)} ${String(contact.last_name)}`.trim()
            extras.requested_by_contact_id = contact.id as string
            extras.requested_by_name = name
          } else {
            requestedByNote = `Requested-by "${args.requested_by}" not set — no matching contact on file for ${normalizeClientText(effectiveClient)}. Add them via add_contact, then set requested-by.`
          }
        }
      }

      return confirmable(
        args,
        async () => ({
          summary: `Create "${projectName}" for ${normalizeClientText(effectiveClient)}${args.skip_scoping ? ' (skip scoping — Active/Submitted)' : ''}`,
          fields: { ...patch, ...extras },
          requested_by_note: requestedByNote,
          budget_note: budgetNote,
          duplicate_warning: dupRows && dupRows.length > 0
            ? `${dupRows.length} similar project(s) already exist for this client/name — proceeding anyway.`
            : null,
        }),
        async () => {
          const row = await runCreateProject(patch, `${userEmail} via Claude`, args.idem_key ?? randomUUID())
          if (Object.keys(extras).length > 0) {
            await runProjectWrite(supabase, { id: row.id as string, patch: extras, actor: `${userEmail} via Claude` })
          }
          meta.project_id = row.id
          if (row.client_id) meta.client_id = row.client_id
          meta.detail = { created: { project_code: row.project_code, project_name: row.project_name, client: row.client }, extras }
          return {
            ok: true, project_code: row.project_code, id: row.id,
            client: row.client, client_id: row.client_id, phase: row.phase, board_column: row.board_column,
            ...(budgetNote ? { budget_note: budgetNote } : {}),
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

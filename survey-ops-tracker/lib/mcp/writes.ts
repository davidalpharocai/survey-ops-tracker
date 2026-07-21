import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'
import type { ClientCompliance, SubmissionLite } from '@/lib/utils/compliance'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, Json } from '@/lib/supabase/types'
import { resolveProject } from './data'

// Whitelisted editable fields for update_project (the tool-facing subset).
export const PROJECT_WRITE_FIELDS = [
  'project_name','client','project_type','captain_id','co_captain_ids','salesperson','priority','blocked_by',
  'submitted_date','launch_date','due_date','deliver_date','rerun_date',
  'n_target','n_collected','n_actual','n_internal_target','audience_size','budget',
  'longitudinal','voter_survey_qa','citation_language_needed','row_level_data','terminations',
  'survey_tool_id','slack_channel_url','latest_next_steps',
  // Added 2026-07-20 (migration 057): plain fields the connector couldn't set before.
  'audience','category','objective','sprint_number','n_floor_override','n_floor_override_reason',
] as const

type Patch = Record<string, unknown>

/** Keep only whitelisted keys actually present; report everything else the caller tried to set. */
export function pickProjectPatch(input: Patch): { patch: Patch; rejected: string[] } {
  const allow = new Set<string>(PROJECT_WRITE_FIELDS)
  const patch: Patch = {}
  const rejected: string[] = []
  for (const k of Object.keys(input)) {
    if (allow.has(k)) patch[k] = input[k]
    else rejected.push(k)
  }
  return { patch, rejected }
}

/** Coupled stage columns. For a normal advance use getCheckboxesForColumn; for delivery set all six true. */
export function stageColumnsFor(opts: { toColumn?: BoardColumn; markDelivered?: boolean }) {
  if (opts.markDelivered) {
    return {
      board_column: 'Delivery' as const,
      stage_doc_programming: true, stage_survey_programming: true, stage_edwin_qa: true,
      stage_fielding: true, stage_data_qa: true, stage_delivery: true,
    }
  }
  const col = opts.toColumn as BoardColumn
  return { board_column: col, ...getCheckboxesForColumn(col) }
}

/** {field:[old,new]} for only the fields whose value changed. Value-aware (JSON-compared) so
 *  array fields like co_captain_ids/linked_documents don't always show as "changed" due to
 *  reference inequality. */
export function diffSummary(before: Patch, patch: Patch): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of Object.keys(patch)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(patch[k] ?? null)) out[k] = [before[k] ?? null, patch[k] ?? null]
  }
  return out
}

// ============================================================================
// Server write helpers: gate input, writable/step/contact resolvers, RPC runners.
// (No import/build-time throws — createAdminClient() only throws when called.)
// ============================================================================

type Row = Record<string, unknown>

/** {field:[old,new]}-ready compliance-gate input for a single project, fetched fresh (mirrors useComplianceState's shape via the client_id FK, same as getProjectDetail). */
export interface GateInputData {
  client: ClientCompliance | null
  override: boolean | null
  submissions: SubmissionLite[]
}

/** Fetch the raw pieces complianceGate needs for a project: its compliance_override, its client's
 *  before/after-fielding flags, and its question_submissions. Merge the result with
 *  {targetColumn, willMarkDelivered} to build a full GateInput for complianceGate(). */
export async function loadGateInput(projectId: string): Promise<GateInputData> {
  const supabase = createAdminClient()

  const { data: project, error: projErr } = await supabase
    .from('survey_projects')
    .select('compliance_override, client_id')
    .eq('id', projectId)
    .maybeSingle()
  if (projErr) throw projErr

  const { data: subs, error: subsErr } = await supabase
    .from('question_submissions')
    .select('phase, status')
    .eq('project_id', projectId)
  if (subsErr) throw subsErr

  let client: ClientCompliance | null = null
  const clientId = project?.client_id ?? null
  if (clientId) {
    const { data: c, error: clientErr } = await supabase
      .from('clients')
      .select('compliance_before_fielding, compliance_after_fielding')
      .eq('id', clientId)
      .maybeSingle()
    if (clientErr) throw clientErr
    client = c
      ? { compliance_before_fielding: c.compliance_before_fielding, compliance_after_fielding: c.compliance_after_fielding }
      : null
  }

  return {
    client,
    override: project?.compliance_override ?? null,
    submissions: (subs ?? []) as SubmissionLite[],
  }
}

/** A clean, tool-facing error (never a throw) for a rejected/blocked resolution. */
export type WritableError = { error: string }

/** Like resolveProject, but also rejects project_type='Internal' — those projects
 *  aren't editable via the connector. */
export async function resolveProjectWritable(
  ref: string
): Promise<Awaited<ReturnType<typeof resolveProject>> | WritableError> {
  const p = await resolveProject(ref)
  if (!p || 'ambiguous' in p) return p
  const row = p as Row
  if (row.project_type === 'Internal') {
    return { error: "Internal projects can't be changed via the connector." }
  }
  return p
}

export type Candidate = { id: string; label: string }

/** Resolve a step within a project: exact id match, else a case-insensitive substring
 *  match on its text. 0 -> null, 1 -> row, >1 -> ambiguous candidates. */
export async function resolveStep(
  projectId: string, ref: string
): Promise<Row | { ambiguous: Candidate[] } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('project_steps')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]

  const byId = rows.find(r => r.id === ref)
  if (byId) return byId

  const s = ref.trim().toLowerCase()
  const matches = rows.filter(r => String(r.text ?? '').toLowerCase().includes(s))
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return { ambiguous: matches.map(r => ({ id: r.id as string, label: String(r.text) })) }
}

/** Resolve a segment within a project: exact id match, else a case-insensitive
 *  substring match on its label. 0 -> null, 1 -> row, >1 -> ambiguous candidates. */
export async function resolveSegment(
  projectId: string, ref: string
): Promise<Row | { ambiguous: Candidate[] } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('project_segments')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order')
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]

  const byId = rows.find(r => r.id === ref)
  if (byId) return byId

  const s = ref.trim().toLowerCase()
  const matches = rows.filter(r => String(r.label ?? '').toLowerCase().includes(s))
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return { ambiguous: matches.map(r => ({ id: r.id as string, label: String(r.label) })) }
}

/** Resolve a contact within a client: exact id match, else a case-insensitive match on
 *  "First Last" or email. Archived contacts are excluded by default — pass includeArchived:true
 *  (e.g. to let archive_contact find an already-archived contact so it can restore it).
 *  0 -> null, 1 -> row, >1 -> ambiguous. */
export async function resolveContact(
  clientId: string, ref: string, includeArchived = false
): Promise<Row | { ambiguous: Candidate[] } | null> {
  const supabase = createAdminClient()
  let q = supabase
    .from('client_contacts')
    .select('*')
    .eq('client_id', clientId)
  if (!includeArchived) q = q.eq('archived', false)
  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]

  const byId = rows.find(r => r.id === ref)
  if (byId) return byId

  const s = ref.trim().toLowerCase()
  const matches = rows.filter(r => {
    const full = `${String(r.first_name ?? '')} ${String(r.last_name ?? '')}`.trim().toLowerCase()
    const email = String(r.email ?? '').toLowerCase()
    return (full.length > 0 && full.includes(s)) || (email.length > 0 && email === s)
  })
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return { ambiguous: matches.map(r => ({ id: r.id as string, label: `${String(r.first_name)} ${String(r.last_name)}` })) }
}

// ---- RPC runners ----

type SurveyProjectRow = Database['public']['Tables']['survey_projects']['Row']
type ProjectStepRow = Database['public']['Tables']['project_steps']['Row']
type ProjectBlastRow = Database['public']['Tables']['project_blasts']['Row']
type ProjectSegmentRow = Database['public']['Tables']['project_segments']['Row']

/** A clean "someone else changed this first" result — never a throw, so the tool can surface it as-is. */
export type StaleWriteError = { error: string }

/** Whitelisted-patch project update via mcp_write_project. Takes the shared admin client
 *  (route.ts holds one) since it's called from the same request as plain service-role writes. */
export async function runProjectWrite(
  supabase: SupabaseClient<Database>,
  opts: { id: string; patch: Record<string, unknown>; actor: string; expectedUpdatedAt?: string | null }
): Promise<SurveyProjectRow | StaleWriteError> {
  const { data, error } = await supabase.rpc('mcp_write_project', {
    p_id: opts.id,
    p_patch: opts.patch as unknown as Json,
    p_actor: opts.actor,
    p_expected_updated_at: opts.expectedUpdatedAt ?? null,
  })
  if (error) {
    if (/stale_write/i.test(error.message)) {
      return { error: 'This project changed since you looked — re-check and try again.' }
    }
    throw new Error(error.message)
  }
  return data as SurveyProjectRow
}

export async function runCreateProject(patch: Record<string, unknown>, actor: string): Promise<SurveyProjectRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_create_project', {
    p_patch: patch as unknown as Json,
    p_actor: actor,
  })
  if (error) throw new Error(error.message)
  return data as SurveyProjectRow
}

export async function runAddStep(
  projectId: string, text: string, createdBy: string, actor: string
): Promise<ProjectStepRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_add_step', {
    p_project: projectId, p_text: text, p_created_by: createdBy, p_actor: actor,
  })
  if (error) throw new Error(error.message)
  return data as ProjectStepRow
}

export async function runCompleteStep(
  stepId: string, done: boolean, by: string, actor: string
): Promise<ProjectStepRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_complete_step', {
    p_step: stepId, p_done: done, p_by: by, p_actor: actor,
  })
  if (error) throw new Error(error.message)
  return data as ProjectStepRow
}

export async function runEditStep(stepId: string, text: string, actor: string): Promise<ProjectStepRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_edit_step', {
    p_step: stepId, p_text: text, p_actor: actor,
  })
  if (error) throw new Error(error.message)
  return data as ProjectStepRow
}

export async function runLogBlast(opts: {
  projectId: string; bid: number; people: number; completes: number; blastAt: string | null
  note: string | null; createdBy: string; idemKey: string; actor: string
}): Promise<ProjectBlastRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_log_blast', {
    p_project: opts.projectId,
    p_bid: opts.bid,
    p_people: opts.people,
    p_completes: opts.completes,
    p_blast_at: opts.blastAt,
    p_note: opts.note ?? '',
    p_created_by: opts.createdBy,
    p_idem: opts.idemKey,
    p_actor: opts.actor,
  })
  if (error) throw new Error(error.message)
  return data as ProjectBlastRow
}

// ---- Segment runners (project_segments; parent N totals kept by trigger) ----

export async function runAddSegment(
  opts: { projectId: string; label: string; target: number | null; collected: number | null; actual: number | null; actor: string }
): Promise<ProjectSegmentRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_add_segment', {
    p_project: opts.projectId,
    p_label: opts.label,
    p_actor: opts.actor,
    p_target: opts.target,
    p_collected: opts.collected,
    p_actual: opts.actual,
  })
  if (error) throw new Error(error.message)
  return data as ProjectSegmentRow
}

export async function runUpdateSegment(
  segmentId: string, patch: Record<string, unknown>, actor: string
): Promise<ProjectSegmentRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_update_segment', {
    p_segment: segmentId,
    p_patch: patch as unknown as Json,
    p_actor: actor,
  })
  if (error) throw new Error(error.message)
  return data as ProjectSegmentRow
}

export async function runRemoveSegment(segmentId: string, actor: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('mcp_remove_segment', {
    p_segment: segmentId,
    p_actor: actor,
  })
  if (error) throw new Error(error.message)
}

export async function runRenameClient(clientId: string, newName: string, actor: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('mcp_rename_client', {
    p_id: clientId,
    p_new_name: newName,
    p_actor: actor,
  })
  if (error) throw new Error(error.message)
}

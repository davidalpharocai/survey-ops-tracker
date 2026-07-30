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

// ---- Launch runners (project_launches + project_suppliers) ----
// PS launches/suppliers have no RPC — the app writes them directly (see
// useProjectSuppliers) and the `project_suppliers_spend` trigger (migration 059)
// keeps actual_spend in sync, plus `trg_audit_project_supplier` (054) audits the
// change. So these mirror that: direct admin-client writes. Zod validates the
// tool args before any write, and a failed supplier batch rolls the launch back
// (compensating delete) so there's never a half-saved launch. A supplier is a FK
// to the master `suppliers` table, so names resolve to ids (auto-created if new).

export interface LaunchSupplierInput {
  name: string
  cpi: number
  cap?: number | null
  n_collected: number
}
/** Update variant — every supplier field except the name is optional (patch/upsert by name). */
export interface LaunchSupplierPatch {
  name: string
  cpi?: number
  cap?: number | null
  n_collected?: number
}
export interface LaunchSupplierView {
  id: string
  supplier_id: string
  name: string
  cpi: number
  cap: number
  n_collected: number
}
export interface LaunchView {
  id: string
  project_id: string
  label: string | null
  launch_date: string | null
  target: number | null
  suppliers: LaunchSupplierView[]
}

/** Match an active-or-not supplier by name (case-insensitive exact); create one if none matches. */
export async function resolveOrCreateSupplier(name: string, createdBy: string): Promise<string> {
  const supabase = createAdminClient()
  const trimmed = name.trim()
  const { data: existing, error } = await supabase
    .from('suppliers').select('id').ilike('name', trimmed).limit(1)
  if (error) throw new Error(error.message)
  if (existing && existing.length > 0) return existing[0].id
  const { data: created, error: insErr } = await supabase
    .from('suppliers').insert({ name: trimmed, active: true, created_by: createdBy }).select('id').single()
  if (insErr) throw new Error(insErr.message)
  return created.id
}

async function supplierNames(supabase: SupabaseClient<Database>, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniq = [...new Set(ids)]
  if (uniq.length === 0) return map
  const { data } = await supabase.from('suppliers').select('id, name').in('id', uniq)
  for (const s of data ?? []) map.set(s.id, s.name)
  return map
}

export async function runLogLaunch(opts: {
  projectId: string; label: string | null; launchDate: string | null; target: number | null
  suppliers: LaunchSupplierInput[]; createdBy: string
}): Promise<LaunchView> {
  const supabase = createAdminClient()
  // Resolve/create every supplier id up front (before the launch row exists).
  const supplierIds: string[] = []
  for (const s of opts.suppliers) supplierIds.push(await resolveOrCreateSupplier(s.name, opts.createdBy))

  const { data: launch, error: lErr } = await supabase
    .from('project_launches')
    .insert({ project_id: opts.projectId, label: opts.label, launch_date: opts.launchDate, target: opts.target, created_by: opts.createdBy })
    .select('id, project_id, label, launch_date, target')
    .single()
  if (lErr) throw new Error(lErr.message)

  const rows = opts.suppliers.map((s, i) => ({
    project_id: opts.projectId, launch_id: launch.id, supplier_id: supplierIds[i],
    cpi: s.cpi, completes_cap: s.cap ?? 0, n_collected: s.n_collected ?? 0, created_by: opts.createdBy,
  }))
  const { data: sup, error: sErr } = await supabase
    .from('project_suppliers').insert(rows).select('id, supplier_id, cpi, completes_cap, n_collected')
  if (sErr) {
    await supabase.from('project_launches').delete().eq('id', launch.id) // compensating rollback — no orphan
    throw new Error(sErr.message)
  }
  const names = await supplierNames(supabase, supplierIds)
  return {
    id: launch.id, project_id: launch.project_id, label: launch.label, launch_date: launch.launch_date, target: launch.target,
    suppliers: (sup ?? []).map(r => ({ id: r.id, supplier_id: r.supplier_id, name: names.get(r.supplier_id) ?? '', cpi: r.cpi, cap: r.completes_cap, n_collected: r.n_collected })),
  }
}

/** Resolve a launch within a project: exact id, else case-insensitive substring on its label. */
export async function resolveLaunch(
  projectId: string, ref: string
): Promise<Row | { ambiguous: Candidate[] } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('project_launches').select('*').eq('project_id', projectId).order('created_at')
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]
  const byId = rows.find(r => r.id === ref)
  if (byId) return byId
  const s = ref.trim().toLowerCase()
  const matches = rows.filter(r => String(r.label ?? '').toLowerCase().includes(s))
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return { ambiguous: matches.map(r => ({ id: r.id as string, label: String(r.label ?? r.id) })) }
}

export async function listLaunchesForProject(projectId: string): Promise<LaunchView[]> {
  const supabase = createAdminClient()
  const { data: launches, error } = await supabase
    .from('project_launches').select('id, project_id, label, launch_date, target').eq('project_id', projectId).order('created_at')
  if (error) throw error
  const ls = launches ?? []
  if (ls.length === 0) return []
  const { data: sup, error: sErr } = await supabase
    .from('project_suppliers').select('id, launch_id, supplier_id, cpi, completes_cap, n_collected')
    .in('launch_id', ls.map(l => l.id)).order('created_at')
  if (sErr) throw sErr
  const names = await supplierNames(supabase, (sup ?? []).map(r => r.supplier_id))
  return ls.map(l => ({
    id: l.id, project_id: l.project_id, label: l.label, launch_date: l.launch_date, target: l.target,
    suppliers: (sup ?? []).filter(r => r.launch_id === l.id).map(r => ({
      id: r.id, supplier_id: r.supplier_id, name: names.get(r.supplier_id) ?? '', cpi: r.cpi, cap: r.completes_cap, n_collected: r.n_collected,
    })),
  }))
}

export async function runUpdateLaunch(opts: {
  launchId: string; projectId: string; label?: string | null; launchDate?: string | null
  target?: number | null; suppliers?: LaunchSupplierPatch[]; createdBy: string
}): Promise<void> {
  const supabase = createAdminClient()
  const patch: Database['public']['Tables']['project_launches']['Update'] = {}
  if (opts.label !== undefined) patch.label = opts.label
  if (opts.launchDate !== undefined) patch.launch_date = opts.launchDate
  if (opts.target !== undefined) patch.target = opts.target
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('project_launches').update(patch).eq('id', opts.launchId)
    if (error) throw new Error(error.message)
  }
  if (opts.suppliers && opts.suppliers.length > 0) {
    const { data: existing, error: exErr } = await supabase
      .from('project_suppliers').select('id, supplier_id, cpi, completes_cap, n_collected').eq('launch_id', opts.launchId)
    if (exErr) throw new Error(exErr.message)
    const names = await supplierNames(supabase, (existing ?? []).map(r => r.supplier_id))
    for (const s of opts.suppliers) {
      const key = s.name.trim().toLowerCase()
      const match = (existing ?? []).find(r => (names.get(r.supplier_id) ?? '').toLowerCase() === key)
      if (match) {
        const p: Database['public']['Tables']['project_suppliers']['Update'] = {}
        if (s.cpi !== undefined) p.cpi = s.cpi
        if (s.cap !== undefined) p.completes_cap = s.cap ?? 0
        if (s.n_collected !== undefined) p.n_collected = s.n_collected
        if (Object.keys(p).length > 0) {
          const { error } = await supabase.from('project_suppliers').update(p).eq('id', match.id)
          if (error) throw new Error(error.message)
        }
      } else {
        const supplier_id = await resolveOrCreateSupplier(s.name, opts.createdBy)
        const { error } = await supabase.from('project_suppliers').insert({
          project_id: opts.projectId, launch_id: opts.launchId, supplier_id,
          cpi: s.cpi ?? 0, completes_cap: s.cap ?? 0, n_collected: s.n_collected ?? 0, created_by: opts.createdBy,
        })
        if (error) throw new Error(error.message)
      }
    }
  }
}

export async function runRemoveLaunch(launchId: string): Promise<void> {
  const supabase = createAdminClient()
  // Remove child supplier rows first (each delete triggers the spend recompute), then the launch.
  const { error: sErr } = await supabase.from('project_suppliers').delete().eq('launch_id', launchId)
  if (sErr) throw new Error(sErr.message)
  const { error } = await supabase.from('project_launches').delete().eq('id', launchId)
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

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
  // n_target is the BOTTOM of the N range and n_target_max the top (migration
  // 078). Both are writable, and alignNRangePatch() below is why a caller may
  // name just one of them.
  'n_target','n_target_max','n_collected','n_actual','n_internal_target','audience_size','budget',
  // voter_survey_qa, citation_language_needed and terminations are RETIRED flags
  // (no UI, no auto-set since migration 090) but stay writable here on purpose:
  // update_project takes a generic `fields` record, so nothing advertises them to
  // a caller, and undo_last_change replays audited values through this same
  // whitelist — an audit row for a retired column should still be undoable.
  'longitudinal','voter_survey_qa','citation_language_needed','row_level_data','terminations',
  'survey_tool_id','slack_channel_url','latest_next_steps',
  // Added 2026-07-20 (migration 057): plain fields the connector couldn't set before.
  'audience','category','objective','sprint_number','n_floor_override','n_floor_override_reason',
] as const

/**
 * Fields undo_last_change may auto-revert: PLAIN scalar content only, whose audited
 * OLD.col::text round-trips cleanly through mcp_write_project's ::type coercion, and
 * which have NO side effects. Deliberately EXCLUDES:
 *   - lifecycle (status/phase/scoping_stage/board_column/stage_*) — use advance/status tools
 *   - trigger-owned/segment-synced (n_collected, actual_spend) — would be overwritten
 *   - relational/identity (client, project_type, captain_id, co_captain_ids, requested_by_*)
 *   - gated semantics (compliance_override, n_floor_override[_reason])
 *   - money-line + synthetic audit rows (blast_*, segment_*, launch, created, merged)
 * Anything not here is refused with a "fix it in the app / use the dedicated tool" note.
 */
export const UNDOABLE_FIELDS = new Set<string>([
  'project_name', 'salesperson', 'priority', 'blocked_by',
  'submitted_date', 'launch_date', 'due_date', 'deliver_date', 'rerun_date',
  'n_target', 'n_target_max', 'n_actual', 'n_internal_target', 'audience_size', 'budget',
  'audience', 'category', 'objective', 'sprint_number',
  'longitudinal', 'voter_survey_qa', 'citation_language_needed', 'row_level_data', 'terminations',
  'latest_next_steps', 'survey_tool_id', 'slack_channel_url',
])

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

/**
 * Keep a one-ended N-range write from inverting the range.
 *
 * Since migration 078 `n_target` is the MINIMUM and `n_target_max` the maximum,
 * and enforce_n_target_range RAISES on max < min while seeing only the columns
 * the patch carries. So "set N target to 2000" on a 1,000–1,200 project used to
 * come back as a DB error instead of doing what the user asked — the connector
 * could not widen a range at all.
 *
 * When the caller names ONE end and it crosses the stored other end, the other
 * end is pulled along to MATCH: the range collapses to the single number they
 * named, which is exactly the pre-078 "one agreed N" case. Nothing is silent —
 * update_project previews the extra line ("N target max 1,200 → 2,000") and only
 * writes on confirm. A caller who names BOTH ends owns the result, inverted or
 * not, so the trigger can still refuse a genuinely transposed pair.
 */
export function alignNRangePatch(before: Patch, patch: Patch): Patch {
  const hasMin = 'n_target' in patch
  const hasMax = 'n_target_max' in patch
  if (hasMin === hasMax) return patch
  const num = (v: unknown) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const min = num(hasMin ? patch.n_target : before.n_target)
  const max = num(hasMax ? patch.n_target_max : before.n_target_max)
  // Either end null means there's no range to invert (a null max is "no upper end
  // agreed"), and the trigger only fires when both are set.
  if (min == null || max == null || max >= min) return patch
  return hasMin
    ? { ...patch, n_target_max: patch.n_target }
    : { ...patch, n_target: patch.n_target_max }
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
  rerunNumber: number | null
  complianceRequiredOverride: boolean | null
}

/** Fetch the raw pieces complianceGate needs for a project: its compliance_override, its client's
 *  before/after-fielding flags, and its question_submissions. Merge the result with
 *  {targetColumn, willMarkDelivered} to build a full GateInput for complianceGate(). */
export async function loadGateInput(projectId: string): Promise<GateInputData> {
  const supabase = createAdminClient()

  const { data: project, error: projErr } = await supabase
    .from('survey_projects')
    .select('compliance_override, client_id, rerun_number, compliance_required_override')
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
    rerunNumber: project?.rerun_number ?? null,
    complianceRequiredOverride: project?.compliance_required_override ?? null,
  }
}

/** Occam onboarding gate input for a project: its requested-by contact + whether
 *  that contact has already been confirmed as invited to Occam. Used by
 *  advance_project (and the in-app gate) to block a first delivery until confirmed. */
export async function loadOccamGate(projectId: string): Promise<{
  requestedByContactId: string | null
  projectUsesOccam: boolean
  contactHasPriorDelivery: boolean
  contactOccamInvited: boolean
  contactName: string | null
  contactEmail: string | null
}> {
  const supabase = createAdminClient()
  const { data: project, error: pErr } = await supabase
    .from('survey_projects')
    .select('requested_by_contact_id, occam')
    .eq('id', projectId)
    .maybeSingle()
  if (pErr) throw new Error(pErr.message)
  const projectUsesOccam = !!project?.occam
  const contactId = project?.requested_by_contact_id ?? null
  if (!contactId) return { requestedByContactId: null, projectUsesOccam, contactHasPriorDelivery: false, contactOccamInvited: false, contactName: null, contactEmail: null }

  // Prior delivery = any OTHER delivered OCCAM project for this same contact
  // (i.e. they already got an Occam account on that delivery). MUST be scoped to
  // occam=true: a contact whose earlier delivery was a NON-Occam study has no
  // Occam account, so their first Occam delivery must still trigger the invite.
  const { data: prior, error: priorErr } = await supabase
    .from('survey_projects')
    .select('id')
    .eq('requested_by_contact_id', contactId)
    .eq('stage_delivery', true)
    .eq('occam', true)
    .neq('id', projectId)
    .is('deleted_at', null)
    .limit(1)
  if (priorErr) throw new Error(priorErr.message)
  const contactHasPriorDelivery = (prior?.length ?? 0) > 0

  const { data: contact, error: cErr } = await supabase
    .from('client_contacts')
    .select('first_name, last_name, email, occam_invited')
    .eq('id', contactId)
    .maybeSingle()
  if (cErr) throw new Error(cErr.message)
  if (!contact) return { requestedByContactId: contactId, projectUsesOccam, contactHasPriorDelivery, contactOccamInvited: false, contactName: null, contactEmail: null }
  return {
    requestedByContactId: contactId,
    projectUsesOccam,
    contactHasPriorDelivery,
    contactOccamInvited: !!contact.occam_invited,
    contactName: `${contact.first_name} ${contact.last_name}`.trim() || null,
    contactEmail: contact.email,
  }
}

/** Record that a contact has been invited to Occam (welcome email sent), so the
 *  delivery gate stops prompting for them. */
export async function markContactOccamInvited(contactId: string, actor: string): Promise<void> {
  const supabase = createAdminClient()
  // Only stamp on the false→true transition so a redundant confirm never overwrites
  // the original invite date/author.
  const { error } = await supabase
    .from('client_contacts')
    .update({ occam_invited: true, occam_invited_at: new Date().toISOString(), occam_invited_by: actor })
    .eq('id', contactId)
    .eq('occam_invited', false)
  if (error) throw new Error(error.message)
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

export async function runCreateProject(patch: Record<string, unknown>, actor: string, idemKey?: string | null): Promise<SurveyProjectRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_create_project', {
    p_patch: patch as unknown as Json,
    p_actor: actor,
    p_idem: idemKey ?? null,
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

/** Postgres 23502 (not-null violation) on a blast figure can only mean one thing:
 *  migration 091, which makes bid/people/completes nullable so "not recorded" is
 *  representable, has not been applied yet. David applies migrations by hand days
 *  after the code deploys, so this window is real. Translate it — the raw
 *  "null value in column \"completes\" violates not-null constraint" tells the
 *  caller nothing about what to do next. */
function rethrowBlastWriteError(error: { code?: string; message: string }): never {
  if (error.code === '23502') {
    throw new Error(
      'This blast figure cannot be left unrecorded until database migration 091 is applied — ' +
      'pass an explicit number for now, or ask David to run supabase/migrations/091_blast_unrecorded.sql.',
    )
  }
  throw new Error(error.message)
}

/** Log (or upsert, on idem_key) a blast. `bid` / `people` / `completes` accept
 *  null = NOT RECORDED YET, which is a different fact from 0 (migration 091) —
 *  0 says the blast produced nothing, null says nobody has counted. On an
 *  idem_key upsert the RPC coalesces, so passing null LEAVES an already-recorded
 *  figure alone rather than erasing it; use runUpdateBlast to un-record on
 *  purpose. */
export async function runLogBlast(opts: {
  projectId: string; bid: number | null; people: number | null; completes: number | null
  blastAt: string | null
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
  if (error) rethrowBlastWriteError(error)
  return data as ProjectBlastRow
}

/** Resolve a blast on a project by its id or (exact) idem_key. Both are unique
 *  per project (project_blasts_idem_uq), so there's no ambiguity — returns the
 *  row or null. Mirrors resolveLaunch, but blasts have no label so the ref is an
 *  id or an idem_key. */
export async function resolveBlast(projectId: string, ref: string): Promise<ProjectBlastRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('project_blasts').select('*').eq('project_id', projectId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as ProjectBlastRow[]
  const r = ref.trim()
  return rows.find((b) => b.id === r) ?? rows.find((b) => (b.idem_key ?? '') === r) ?? null
}

/** A project's blasts (for the spend rollup + tool results). */
export async function listBlastsForProject(projectId: string): Promise<ProjectBlastRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('project_blasts').select('*').eq('project_id', projectId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as ProjectBlastRow[]
}

/** Patch a blast by id — only keys present in `patch` change (jsonb-patch RPC,
 *  mirrors runUpdateSegment). Sets app.actor; the spend + audit triggers fire.
 *
 *  A key present with a null value writes NULL, i.e. un-records that figure:
 *  jsonb `?` is true for a key whose value is JSON null and `->>` yields SQL
 *  NULL, so `{completes: null}` means "nobody has counted these yet" while
 *  OMITTING the key means "leave whatever is there". This is the only path that
 *  can walk a figure back to unrecorded — mcp_log_blast's upsert deliberately
 *  coalesces so a re-import can't erase a hand-typed number. */
export async function runUpdateBlast(opts: {
  blastId: string; patch: Record<string, unknown>; actor: string
}): Promise<ProjectBlastRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_update_blast', {
    p_blast: opts.blastId, p_patch: opts.patch as unknown as Json, p_actor: opts.actor,
  })
  if (error) rethrowBlastWriteError(error)
  return data as ProjectBlastRow
}

/** Delete a blast by id (mirrors runRemoveSegment). Sets app.actor; triggers fire. */
export async function runRemoveBlast(blastId: string, actor: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('mcp_remove_blast', { p_blast: blastId, p_actor: actor })
  if (error) throw new Error(error.message)
}

// ---- Segment runners (project_segments; parent N totals kept by trigger) ----

/** Add a segment. `targetMax` is the top of the segment's N range (migration 078
 *  added mcp_add_segment's p_target_max as a trailing defaulted arg); it is
 *  required here rather than defaulted so a new call site can't quietly create a
 *  segment with a floor and no ceiling. Pass null for a single agreed number. */
export async function runAddSegment(
  opts: {
    projectId: string; label: string; target: number | null; targetMax: number | null
    collected: number | null; actual: number | null; actor: string
  }
): Promise<ProjectSegmentRow> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('mcp_add_segment', {
    p_project: opts.projectId,
    p_label: opts.label,
    p_actor: opts.actor,
    p_target: opts.target,
    p_target_max: opts.targetMax,
    p_collected: opts.collected,
    p_actual: opts.actual,
    // Migration 078 is applied in prod but lib/supabase/types.ts is regenerated
    // separately, so p_target_max isn't in the generated Args yet. Asserting the
    // one added arg keeps the rest of the call type-checked; drop the cast when
    // the regenerated types land.
  } as Database['public']['Functions']['mcp_add_segment']['Args'] & { p_target_max: number | null })
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
  note: string | null
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
  note?: string | null; suppliers: LaunchSupplierInput[]; createdBy: string
}): Promise<LaunchView> {
  const supabase = createAdminClient()
  // Resolve/create every supplier id up front (before the launch row exists).
  const supplierIds: string[] = []
  for (const s of opts.suppliers) supplierIds.push(await resolveOrCreateSupplier(s.name, opts.createdBy))

  const { data: launch, error: lErr } = await supabase
    .from('project_launches')
    .insert({ project_id: opts.projectId, label: opts.label, launch_date: opts.launchDate, target: opts.target, note: opts.note ?? null, created_by: opts.createdBy })
    .select('id, project_id, label, launch_date, target, note')
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
    id: launch.id, project_id: launch.project_id, label: launch.label, launch_date: launch.launch_date, target: launch.target, note: launch.note,
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
  // Exact label match wins before any substring match — so a Survey# used as the
  // launch label resolves precisely as a stable unique key (re-dropping the same
  // supplier screenshot updates that launch instead of ambiguously matching).
  const byExactLabel = rows.find(r => String(r.label ?? '').trim().toLowerCase() === s)
  if (byExactLabel) return byExactLabel
  const matches = rows.filter(r => String(r.label ?? '').toLowerCase().includes(s))
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  return { ambiguous: matches.map(r => ({ id: r.id as string, label: String(r.label ?? r.id) })) }
}

export async function listLaunchesForProject(projectId: string): Promise<LaunchView[]> {
  const supabase = createAdminClient()
  const { data: launches, error } = await supabase
    .from('project_launches').select('id, project_id, label, launch_date, target, note').eq('project_id', projectId).order('created_at')
  if (error) throw error
  const ls = launches ?? []
  if (ls.length === 0) return []
  const { data: sup, error: sErr } = await supabase
    .from('project_suppliers').select('id, launch_id, supplier_id, cpi, completes_cap, n_collected')
    .in('launch_id', ls.map(l => l.id)).order('created_at')
  if (sErr) throw sErr
  const names = await supplierNames(supabase, (sup ?? []).map(r => r.supplier_id))
  return ls.map(l => ({
    id: l.id, project_id: l.project_id, label: l.label, launch_date: l.launch_date, target: l.target, note: l.note,
    suppliers: (sup ?? []).filter(r => r.launch_id === l.id).map(r => ({
      id: r.id, supplier_id: r.supplier_id, name: names.get(r.supplier_id) ?? '', cpi: r.cpi, cap: r.completes_cap, n_collected: r.n_collected,
    })),
  }))
}

export async function runUpdateLaunch(opts: {
  launchId: string; projectId: string; label?: string | null; launchDate?: string | null
  target?: number | null; note?: string | null; suppliers?: LaunchSupplierPatch[]; createdBy: string
}): Promise<void> {
  const supabase = createAdminClient()
  const patch: Database['public']['Tables']['project_launches']['Update'] = {}
  if (opts.label !== undefined) patch.label = opts.label
  if (opts.launchDate !== undefined) patch.launch_date = opts.launchDate
  if (opts.target !== undefined) patch.target = opts.target
  if (opts.note !== undefined) patch.note = opts.note
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

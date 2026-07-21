import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { runCreateProject, runProjectWrite } from '@/lib/mcp/writes'

// Clone a project into a fresh one. Setup fields carry over (toggleable);
// run-data resets (dates, N collected/actual, survey IDs, pipeline stage → lands
// in Submitted). Blasts / deliverables / activity are NOT copied (those belong to
// the source). The new project records a "cloned_from" entry in its audit log.

export interface CloneCarry {
  people?: boolean // captain + co-captains, salesperson, requested-by
  audienceN?: boolean // audience, N target, N internal target, audience size
  flags?: boolean // longitudinal, voter QA, citation, row-level, terminations
  suppliers?: boolean // copy PS suppliers (CPIs + caps; N collected reset to 0)
  budget?: boolean // total budget
}

const on = (v: boolean | undefined) => v !== false // default: carry unless explicitly false

export async function cloneProject(opts: {
  sourceId: string
  newName: string
  carry: CloneCarry
  actor: string
}): Promise<{ id: string; project_code: string | null; project_name: string; cloned_from: string | null }> {
  const admin = createAdminClient()
  const { data: src, error } = await admin
    .from('survey_projects')
    .select('*')
    .eq('id', opts.sourceId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!src) throw new Error('Source project not found.')

  const name = opts.newName.trim()
  if (!name) throw new Error('A name for the clone is required.')
  const c = opts.carry

  // 1) Base create — lands in the pipeline (Active / Submitted), no dates.
  const basePatch: Record<string, unknown> = {
    project_name: name,
    client: src.client,
    phase: 'Active',
    board_column: 'Submitted',
  }
  if (src.project_type) basePatch.project_type = src.project_type
  if (on(c.people) && src.captain_id) basePatch.captain_id = src.captain_id
  if (on(c.people) && src.salesperson) basePatch.salesperson = src.salesperson
  if (on(c.audienceN) && src.n_target != null) basePatch.n_target = src.n_target
  const created = await runCreateProject(basePatch, opts.actor)

  // 2) Carry the remaining setup fields via the audited write RPC.
  const patch: Record<string, unknown> = {}
  if (on(c.people)) {
    if (src.co_captain_ids) patch.co_captain_ids = src.co_captain_ids
    if (src.requested_by_contact_id) patch.requested_by_contact_id = src.requested_by_contact_id
    if (src.requested_by_name) patch.requested_by_name = src.requested_by_name
  }
  if (on(c.audienceN)) {
    if (src.audience != null) patch.audience = src.audience
    if (src.n_internal_target != null) patch.n_internal_target = src.n_internal_target
    if (src.audience_size != null) patch.audience_size = src.audience_size
  }
  if (on(c.flags)) {
    patch.longitudinal = src.longitudinal
    patch.voter_survey_qa = src.voter_survey_qa
    patch.citation_language_needed = src.citation_language_needed
    patch.row_level_data = src.row_level_data
    patch.terminations = src.terminations
  }
  if (on(c.budget) && src.budget != null) patch.budget = src.budget
  // Compliance override follows the client relationship — carry it as-is.
  if (src.compliance_override != null) patch.compliance_override = src.compliance_override
  if (Object.keys(patch).length > 0) {
    await runProjectWrite(admin, { id: created.id, patch, actor: opts.actor })
  }

  // 3) Copy PS suppliers (CPIs + caps), resetting N collected.
  if (on(c.suppliers)) {
    const { data: sup } = await admin
      .from('project_suppliers')
      .select('supplier_id, cpi, completes_cap')
      .eq('project_id', opts.sourceId)
    if (sup && sup.length > 0) {
      await admin.from('project_suppliers').insert(
        sup.map((s) => ({
          project_id: created.id,
          supplier_id: s.supplier_id,
          cpi: s.cpi,
          completes_cap: s.completes_cap,
          n_collected: 0,
          created_by: opts.actor.split(/[@ ]/)[0],
        }))
      )
    }
  }

  // 4) Record in the audit log what this is a clone of.
  await admin.from('project_audit').insert({
    project_id: created.id,
    field: 'cloned_from',
    new_value: src.project_code ?? opts.sourceId,
    changed_by: opts.actor,
  })

  return {
    id: created.id,
    project_code: created.project_code,
    project_name: created.project_name,
    cloned_from: src.project_code,
  }
}

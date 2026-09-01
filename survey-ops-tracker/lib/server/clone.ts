import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TablesInsert } from '@/lib/supabase/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { runCreateProject, runProjectWrite } from '@/lib/mcp/writes'

// Clone a project into a fresh one. Setup fields carry over (toggleable);
// run-data resets (dates, N collected/actual, survey IDs, pipeline stage → lands
// in Submitted). Blasts / deliverables / activity are NOT copied (those belong to
// the source). The new project records a "cloned_from" entry in its audit log.
//
// Two things travel that used to be dropped: the N range's CEILING
// (`n_target_max`, migration 078 — copying `n_target` alone reset an agreed
// maximum to nothing) and the client's price per N (migration 082). Both are
// handled below with the reason spelled out at each site.

export interface CloneCarry {
  people?: boolean // captain + co-captains, salesperson, requested-by
  audienceN?: boolean // audience, N target, N internal target, audience size
  flags?: boolean // longitudinal, row-level, terminations
  suppliers?: boolean // copy PS suppliers (CPIs + caps; N collected reset to 0)
  budget?: boolean // total budget
  // The client's price per N (project_financials, migration 082). Carried by
  // default like everything else here: a clone is normally the same commercial
  // deal for the same client, and a wave with no rate reads as $0 revenue in
  // every margin figure — which is worse than blank, because $0 looks like an
  // answer somebody gave. Turn it off for a clone being re-quoted.
  pricing?: boolean
}

const on = (v: boolean | undefined) => v !== false // default: carry unless explicitly false

type Admin = ReturnType<typeof createAdminClient>

// Migration 082 (project_financials + project_segments.price_per_n) is applied by
// hand, and the generated Database type is regenerated in its own pass, so
// nothing below can name price_per_n through the typed client. Same untyped
// handle + narrow-here shape as lib/hooks/useProjectFinancials.ts.
const untyped = (admin: Admin) => admin as unknown as SupabaseClient

/**
 * Per-segment price overrides for one project, keyed by segment id.
 *
 * Its OWN query on purpose — never folded into the segment select below. Pre-082
 * `price_per_n` is a missing COLUMN, and PostgREST fails the ENTIRE request when
 * an explicit select list names one, so a single widened select would 400 every
 * clone and every spawned rerun wave the moment this code deployed ahead of the
 * SQL (082's own apply-order note calls out this exact function). Isolated, a
 * missing column costs us the prices and nothing else.
 *
 * Returns null when the column isn't there yet — the signal to leave the key out
 * of the INSERT entirely, since sending an unknown column 400s just as hard.
 */
async function readSegmentRates(
  admin: Admin,
  projectId: string
): Promise<Map<string, number | null> | null> {
  const { data, error } = await untyped(admin)
    .from('project_segments')
    .select('id, price_per_n')
    .eq('project_id', projectId)
  if (error || !data) return null
  const rows = data as { id: string; price_per_n: number | null }[]
  return new Map(rows.map((r) => [r.id, r.price_per_n]))
}

/** What happened to the price on a copy path — reported rather than thrown, so a
 *  clone or a spawned wave is never lost over a rate. */
export type PricingCopyResult =
  /** The source had a rate and the target now has the same one. */
  | 'copied'
  /** The source was never priced — the target stays unpriced, which reads as
   *  UNKNOWN ('—'), never as zero. */
  | 'none'
  /** project_financials isn't there yet (082 not applied). The target is
   *  unpriced for the same reason, and someone has to type the rate in once the
   *  migration lands. */
  | 'unavailable'

/**
 * Copy the project-level client rate from one project to another.
 *
 * Isolated from every other copy for the reason above: a missing TABLE 400s too,
 * and neither a clone nor a rerun wave may fail because revenue hasn't shipped
 * yet. UPSERT rather than insert — 082 makes `project_id` the primary key and
 * backfills nothing, so the target normally has no row at all, and a re-run of a
 * partially-completed copy must not collide.
 */
export async function copyProjectPricing(
  admin: Admin,
  sourceProjectId: string,
  targetProjectId: string,
  actor: string
): Promise<PricingCopyResult> {
  const db = untyped(admin)
  const { data, error } = await db
    .from('project_financials')
    .select('price_per_n')
    .eq('project_id', sourceProjectId)
    .maybeSingle()
  if (error) return 'unavailable'
  const rate = (data as { price_per_n: number | null } | null)?.price_per_n ?? null
  if (rate == null) return 'none'
  const { error: upErr } = await db
    .from('project_financials')
    .upsert({ project_id: targetProjectId, price_per_n: rate, created_by: actor }, { onConflict: 'project_id' })
  return upErr ? 'unavailable' : 'copied'
}

/** Copy the PS launch structure (launches + supplier rows) from one project
 * to another. Run-data resets: `launch_date` is left blank (a fresh plan) and
 * each supplier's `n_collected` resets to 0; `cpi`/`completes_cap` carry over
 * verbatim. Shared by `cloneProject` (Clone button, below) and the rerun
 * auto-spawn cron (`app/api/cron/spawn-reruns/route.ts`), which copies the
 * same structure onto a newly spawned wave. */
export async function copySupplierLaunches(
  admin: Admin,
  sourceProjectId: string,
  targetProjectId: string,
  createdBy: string
): Promise<void> {
  const { data: srcLaunches } = await admin
    .from('project_launches')
    .select('id, label, target, created_at')
    .eq('project_id', sourceProjectId)
    .order('created_at', { ascending: true })
  if (!srcLaunches || srcLaunches.length === 0) return
  const { data: srcSuppliers } = await admin
    .from('project_suppliers')
    .select('launch_id, supplier_id, cpi, completes_cap')
    .eq('project_id', sourceProjectId)
  const byLaunch = new Map<string, { supplier_id: string; cpi: number; completes_cap: number }[]>()
  for (const s of srcSuppliers ?? []) {
    if (!s.launch_id) continue
    const arr = byLaunch.get(s.launch_id) ?? []
    arr.push({ supplier_id: s.supplier_id, cpi: s.cpi, completes_cap: s.completes_cap })
    byLaunch.set(s.launch_id, arr)
  }
  for (const l of srcLaunches) {
    const { data: newLaunch } = await admin
      .from('project_launches')
      .insert({ project_id: targetProjectId, label: l.label, target: l.target, created_by: createdBy })
      .select('id')
      .single()
    if (!newLaunch) continue
    const supRows = byLaunch.get(l.id) ?? []
    if (supRows.length > 0) {
      await admin.from('project_suppliers').insert(
        supRows.map((s) => ({
          project_id: targetProjectId,
          launch_id: newLaunch.id,
          supplier_id: s.supplier_id,
          cpi: s.cpi,
          completes_cap: s.completes_cap,
          n_collected: 0,
          created_by: createdBy,
        }))
      )
    }
  }
}

/** Copy B2B blast config rows from one project to another, resetting
 * run-data (# people reached, # completes) to 0 since the new wave hasn't
 * sent anything yet — `bid` ($/completion) and the description (`note`)
 * carry over as the plan. Used ONLY by the rerun auto-spawn cron so a new
 * wave's Money section lands populated (not empty) like the prior wave.
 * Deliberately NOT called by `cloneProject` below — a Clone is a brand-new
 * project, and blasts belong to the source project they were actually sent
 * from, not a copy (see the CloneCarry doc + `components/project/CloneProjectModal.tsx`). */
export async function copyProjectBlasts(
  admin: Admin,
  sourceProjectId: string,
  targetProjectId: string,
  createdBy: string
): Promise<void> {
  const { data: srcBlasts } = await admin
    .from('project_blasts')
    .select('bid, note')
    .eq('project_id', sourceProjectId)
  if (!srcBlasts || srcBlasts.length === 0) return
  // people/completes are OMITTED, not set to 0 — the same choice BlastBlocks makes
  // when logging a blast by hand, and for a sharper reason here.
  //
  // This runs unattended: spawnSeries.ts calls it for every auto-spawned rerun
  // wave. A wave that has not sent anything yet has an UNKNOWN reach and an
  // UNKNOWN completes count, and writing 0 states both as fact — the new wave
  // would show "$0.00" as a settled cost, never trip the unrecorded-cost banner,
  // and hard-fail data-health check 7b the moment it collects any N. That is the
  // exact defect migration 091 exists to remove, manufactured on a cron.
  //
  // Omitting rather than sending null keeps this correct against BOTH schemas:
  // pre-091 the `default 0` still fires (today's behaviour, nothing breaks), and
  // post-091 the row is born genuinely unrecorded. `bid` DOES carry over — it is
  // the rate agreed for the study, known in advance, and not a measurement.
  await admin.from('project_blasts').insert(
    srcBlasts.map((b) => ({
      project_id: targetProjectId,
      bid: b.bid,
      note: b.note,
      created_by: createdBy,
    }))
  )
}

/** Copy multi-segment N rows from one project to another, resetting
 * `n_collected` to 0 and `n_actual` to null — the segment structure/targets
 * carry over, the collection run-data doesn't. Used ONLY by the rerun
 * auto-spawn cron (same rationale as `copyProjectBlasts` above).
 *
 * BOTH ends of the N range travel together. `n_target` has been the MINIMUM
 * since migration 078, so copying it alone silently reset every segment's
 * agreed ceiling — and it has to go in the same statement as the min, because
 * 078's enforce_n_target_range trigger only sees the fields the write carries.
 * An INSERT carries both by construction, which is why this is safe here and
 * why the range must never be split across two writes.
 *
 * The per-segment client rate rides along too when 082 is applied (see
 * `readSegmentRates`) — a rerun wave is the same study at the same price, and an
 * unpriced wave reads as $0 revenue rather than as unknown. */
export async function copyProjectSegments(
  admin: Admin,
  sourceProjectId: string,
  targetProjectId: string
): Promise<void> {
  const { data: srcSegments } = await admin
    .from('project_segments')
    .select('id, label, n_target, n_target_max, n_internal_target, audience, audience_size, sort_order')
    .eq('project_id', sourceProjectId)
    .order('sort_order', { ascending: true })
  if (!srcSegments || srcSegments.length === 0) return
  // Keyed by segment id, not label or sort_order — two segments may share
  // either, and pairing a price with the wrong segment is worse than no price.
  const rates = await readSegmentRates(admin, sourceProjectId)
  const rows = srcSegments.map((s) => ({
    project_id: targetProjectId,
    label: s.label,
    n_target: s.n_target,
    n_target_max: s.n_target_max,
    n_internal_target: s.n_internal_target,
    n_collected: 0,
    n_actual: null,
    audience: s.audience,
    audience_size: s.audience_size,
    // audience_used is absent on purpose, twice over: it is run data (see
    // cloneProject's note), and naming it in the select above would fail the
    // whole read wherever migration 094 has not been applied.
    sort_order: s.sort_order,
    // The key is omitted ENTIRELY pre-082 — naming a column that doesn't exist
    // fails the insert, so "no prices" has to mean no key, not a null.
    ...(rates ? { price_per_n: rates.get(s.id) ?? null } : {}),
  }))
  await admin.from('project_segments').insert(rows as unknown as TablesInsert<'project_segments'>[])
}

export async function cloneProject(opts: {
  sourceId: string
  newName: string
  carry: CloneCarry
  actor: string
}): Promise<{
  id: string
  project_code: string | null
  project_name: string
  cloned_from: string | null
  /** What became of the client rate — so a caller can say "priced like the
   *  original" or "you'll need to set the price" instead of guessing. */
  pricing: PricingCopyResult | 'skipped'
}> {
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
    // audience_size travels, audience_used does NOT. The pool the team handed
    // over is a property of the study we are copying; how much of it has already
    // been sent to is a property of the RUN, and clone resets run data (dates, N
    // collected, stage). Carrying it would open a fresh wave already claiming a
    // spent list, and AudienceRemaining would render "no contacts left" on a
    // project that has not sent one message.
    if (src.audience != null) patch.audience = src.audience
    if (src.n_internal_target != null) patch.n_internal_target = src.n_internal_target
    if (src.audience_size != null) patch.audience_size = src.audience_size
    // The N range's ceiling can only be carried HERE, not in the create above:
    // mcp_create_project (migration 070) inserts a hand-listed column set that
    // 078 never extended, so an `n_target_max` in that patch is silently
    // dropped — the clone would come out with the min alone and a ceiling
    // agreed with a client would vanish without an error. mcp_write_project
    // does have the arm. Both ends go in ONE patch because 078's
    // enforce_n_target_range trigger only sees the fields the write carries;
    // re-sending the unchanged min costs nothing (audit_field skips equal values).
    if (src.n_target_max != null) {
      patch.n_target = src.n_target
      patch.n_target_max = src.n_target_max
    }
  }
  if (on(c.flags)) {
    patch.longitudinal = src.longitudinal
    // voter_survey_qa / citation_language_needed are NOT carried: both are
    // retired (migration 090 stopped the 009 auto-set), so a clone that copied
    // them would be the only thing still writing a dead column.
    patch.row_level_data = src.row_level_data
    patch.terminations = src.terminations
  }
  if (on(c.budget) && src.budget != null) patch.budget = src.budget
  // Compliance override follows the client relationship — carry it as-is.
  if (src.compliance_override != null) patch.compliance_override = src.compliance_override
  if (Object.keys(patch).length > 0) {
    await runProjectWrite(admin, { id: created.id, patch, actor: opts.actor })
  }

  // 3) Copy the PS launch structure: recreate each launch (label + target; launch_date
  //    resets — it's a fresh plan) then copy its supplier rows (CPIs + caps), N collected
  //    reset to 0.
  if (on(c.suppliers)) {
    const creator = opts.actor.split(/[@ ]/)[0]
    await copySupplierLaunches(admin, opts.sourceId, created.id, creator)
  }

  // 3b) Carry the client rate. Never fatal: 082 is applied by hand, so 'unavailable'
  //     is the normal answer until it lands, and a clone must not fail over a
  //     number the schema doesn't have yet. Either way the new project is
  //     UNPRICED, which every reader renders as '—' (unknown), never as $0.
  const pricing: PricingCopyResult | 'skipped' = on(c.pricing)
    ? await copyProjectPricing(admin, opts.sourceId, created.id, opts.actor)
    : 'skipped'

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
    pricing,
  }
}

import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { totalBidDollars } from '@/lib/utils/blast'
import { beforeFieldingRequired, afterFieldingRequired, beforeFieldingMet, afterFieldingMet } from '@/lib/utils/compliance'
import { VIEW_FINANCIALS } from '@/lib/auth/capabilityNames'
import { isRestrictedAuditField } from '@/lib/utils/auditFormat'
import type { Database } from '@/lib/supabase/types'

/** Tool args are user-controlled: strip PostgREST-reserved chars, escape LIKE wildcards, cap length. */
export function sanitizeQuery(q: string): string {
  // Slice to length BEFORE escaping wildcards: escaping first could truncate mid-escape
  // and leave a dangling backslash that breaks the LIKE pattern.
  return q.replace(/[,().]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 100).replace(/([%_\\])/g, '\\$1')
}

/** [owner initials][client+project abbrev][YYYYMMDD][region?] — anchor on the 8-digit date. */
export function decodeSurveyId(
  id: string, teamInitials: string[]
): { owner: string | null; abbreviation: string; date: string; region: string | null; note: string | null } | null {
  // Lazy prefix so an abbreviation containing digits (e.g. "B2B") still parses —
  // the anchor is the first run of 8 consecutive digits (the YYYYMMDD).
  const m = id.toUpperCase().match(/^(.+?)(\d{8})([A-Z]*)$/)
  if (!m) return null
  const [, prefix, ymd, region] = m
  const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
  // longest-prefix match against team initials to peel off the owner
  const owner = [...teamInitials].sort((a, b) => b.length - a.length)
    .find(i => prefix.startsWith(i.toUpperCase())) ?? null
  return {
    owner,
    abbreviation: owner ? prefix.slice(owner.length) : prefix,
    date,
    region: region || null,
    note: owner ? null : 'owner initials not recognized',
  }
}

// Noise columns dropped from the `select('*')` project payloads. sheet_synced_at /
// sheet_synced_hash are here because the SOCC->Surveys write-back that maintained them
// is deleted: the columns survive (migration 053, historical data kept) but are frozen,
// so surfacing them would tell a reader the sheet is still being mirrored.
const STRIPPED = [
  'created_at', 'updated_at', 'calendar_event_id', 'survey_ids_from_sheet',
  'survey_ids_synced_at', 'stage_doc_programming', 'stage_survey_programming',
  'stage_edwin_qa', 'stage_fielding', 'stage_data_qa', 'stage_delivery',
  'sheet_synced_at', 'sheet_synced_hash',
] as const

type Row = Record<string, unknown>

// ---- finance visibility (a SOFT gate, not a security boundary) ------------
//
// The cost CEILING (`budget`) and everything revenue-side (client price per N,
// contract value, margin — migration 082) are limited to the three people who
// hold `view_financials` (migration 079). What it costs to RUN a project —
// actual_spend, supplier CPI, blast bids, project_costs lines — is public to the
// whole team, so none of that is touched here.
//
// Be honest about the strength of this: every query in this file runs as
// service_role, and the connector only knows who is asking when the tool handler
// forwards its ctx. So this is "don't put the number in front of someone who
// shouldn't see it", NOT "the number is protected". It fails CLOSED — a caller
// whose identity doesn't reach us is treated as NOT holding the capability, so
// the worst case is one of the three holders seeing one number fewer in a
// connector answer, never the reverse.

/** True for a field the model must not be shown without `view_financials`.
 *  `budget` is named explicitly; the revenue columns land in migration 082, so
 *  match their tokens too — a new price/margin/contract column is then
 *  suppressed the day the SQL runs, not the day someone remembers this list.
 *  No existing survey_projects/clients column matches the pattern. */
export function isRestrictedMoneyField(field: string): boolean {
  return field === 'budget' || /(^|_)(price|margin|contract_value)/.test(field)
}

/** The row minus its restricted-money fields. Returns the row untouched for a
 *  capability holder. Keys are DELETED rather than nulled: a null reads to the
 *  model as "no budget set", which is a different (and false) claim. */
export function redactRestrictedMoney(row: Row, canViewFinancials: boolean): Row {
  if (canViewFinancials) return row
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) if (!isRestrictedMoneyField(k)) out[k] = v
  return out
}

/** Does the calling user hold VIEW_FINANCIALS? Service-role read (this file
 *  has no session cookie — the MCP route authenticates an OAuth token and hands
 *  us ctx.userId), keyed on the profile id. Never throws and never defaults
 *  open: no ctx, no id, a failed query, or a missing table all answer false.
 *  Mirrors lib/auth/capabilities.ts, which is the browser/session-scoped reader
 *  for the same table. */
export async function callerCanViewFinancials(
  ctx?: { userId?: string | null }
): Promise<boolean> {
  if (!ctx?.userId) return false
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase.from('profile_capabilities')
      .select('capability')
      .eq('profile_id', ctx.userId)
      .eq('capability', VIEW_FINANCIALS)
      .maybeSingle()
    if (error) return false
    return !!data
  } catch {
    return false
  }
}

export function slimProject(p: Row, canViewFinancials = false): Row {
  if (p.status === 'Closed') {
    return redactRestrictedMoney({
      project_code: p.project_code, project_name: p.project_name, client: p.client,
      project_type: p.project_type, status: 'Closed', submitted_date: p.submitted_date,
      deliver_date: p.deliver_date, n_target: p.n_target, n_target_max: p.n_target_max,
      n_actual: p.n_actual,
      budget: p.budget, actual_spend: p.actual_spend, salesperson: p.salesperson,
    }, canViewFinancials)
  }
  const slim: Row = { ...p }
  for (const f of STRIPPED) delete slim[f]
  return redactRestrictedMoney(slim, canViewFinancials)
}

// ---- query helpers (service-role; caller has already passed the analyst gate) ----

/** The caller's own team_members {name, initials} + profiles.role, resolved via profiles.email
 *  -> team_members.email. Powers get_me and mine:true on search_projects/pipeline_summary.
 *  Returns null if the profile or a matching team_members row can't be found (no throw). */
export async function getMe(
  userId: string
): Promise<{ name: string; initials: string; role: string } | null> {
  const supabase = createAdminClient()
  const { data: profile, error: profErr } = await supabase.from('profiles')
    .select('email, role').eq('id', userId).maybeSingle()
  if (profErr) throw profErr
  if (!profile) return null

  const { data: member, error: memErr } = await supabase.from('team_members')
    .select('name, initials').eq('email', profile.email).maybeSingle()
  if (memErr) throw memErr
  if (!member) return null

  return { name: member.name, initials: member.initials, role: profile.role }
}

/** The only projects that can be "due", "overdue", or "open/active": in-flight
 *  operational surveys. Excludes Closed & On-Hold (status='Hold'), pre-sale
 *  Scoping (phase), and Delivered — the final 'Delivery' board column, shown in
 *  the UI as "Delivered". A delivered project can still carry status='Open' until
 *  it's manually closed, so board_column must be checked, not status alone. */
export function isActiveOperational(p: {
  status?: unknown; phase?: unknown; board_column?: unknown
}): boolean {
  return p.status === 'Open' && p.phase === 'Active' && p.board_column !== 'Delivery'
}

export async function searchProjects(args: {
  query?: string; status?: string; phase?: string; captain?: string; salesperson?: string;
  due_before?: string; due_after?: string; limit?: number; mine?: boolean; userId?: string;
  active_only?: boolean
}) {
  const supabase = createAdminClient()

  // mine:true resolves the caller's own initials and filters by them, same as an explicit
  // captain filter — an explicit `captain` still wins if somehow both are passed.
  let captainFilter = args.captain ?? null
  if (args.mine && args.userId) {
    const me = await getMe(args.userId)
    if (me) captainFilter = captainFilter ?? me.initials
  }

  let q = supabase.from('survey_projects')
    .select('project_code, project_name, client, status, phase, scoping_stage, board_column, due_date, n_collected, n_target, salesperson, captain:team_members(name, initials)')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    // Placeholder rerun waves (migration 075) are delivered/Closed stubs pending
    // data — they aren't real searchable projects, so keep them out of connector
    // search results (they live in the rerun views only). Null-safe for pre-075 rows.
    .or('is_placeholder.is.null,is_placeholder.eq.false')
  // Default to only in-flight operational projects (see isActiveOperational) so
  // "due this week", "open surveys for <captain>", etc. never surface Closed,
  // On-Hold, Delivered, or pre-sale Scoping work. If the caller explicitly asks
  // for a Closed/Hold status or the Scoping phase, honor that instead; a passed
  // active_only always wins.
  const asksInactive =
    args.status === 'Closed' || args.status === 'Cancelled' || args.status === 'Hold' || args.phase === 'Scoping'
  const wantsActive = args.active_only ?? !asksInactive
  if (wantsActive) q = q.eq('status', 'Open').eq('phase', 'Active').neq('board_column', 'Delivery')
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`project_name.ilike.%${s}%,client.ilike.%${s}%,project_code.ilike.%${s}%`)
  }
  if (args.status) q = q.eq('status', args.status as never)
  if (args.phase) q = q.eq('phase', args.phase as never)
  // Salesperson is a plain text column (free-text names like "Alex Pinsky"), so a
  // contains-match filters in SQL directly — "Alex" finds "Alex Pinsky". (Captain,
  // below, is a joined relation and is filtered in JS instead.)
  if (args.salesperson) q = q.ilike('salesperson', `%${sanitizeQuery(args.salesperson)}%`)
  if (args.due_before) q = q.lte('due_date', args.due_before)
  if (args.due_after) q = q.gte('due_date', args.due_after)
  q = q.order('due_date', { ascending: true, nullsFirst: false })
  // When filtering by captain, the SQL limit would cap the pre-filter set and could
  // drop matches — fetch all matching rows, filter in JS, THEN slice to the limit.
  if (!captainFilter) q = q.limit(Math.min(args.limit ?? 20, 50))
  const { data, error } = await q
  if (error) throw error
  let rows = (data ?? []) as unknown as Row[]
  if (captainFilter) {
    const c = captainFilter.toLowerCase()
    rows = rows.filter(r => {
      const cap = r.captain as { name?: string; initials?: string } | null
      return cap?.name?.toLowerCase().includes(c) || cap?.initials?.toLowerCase() === c
    })
    rows = rows.slice(0, Math.min(args.limit ?? 20, 50))
  }
  return rows
}

type ProjectCandidate = { project_code: string | null; project_name: string; client: string }

/** Resolve a project ref (PR-code exact, then name ilike). 0 -> null, 1 -> row, >1 -> ambiguous candidates. */
export async function resolveProject(
  ref: string
): Promise<Row | { ambiguous: ProjectCandidate[] } | null> {
  const supabase = createAdminClient()
  const byCode = await supabase.from('survey_projects')
    .select('*, captain:team_members(name, initials)')
    .is('deleted_at', null)
    .ilike('project_code', ref.trim().replace(/([%_\\])/g, '\\$1'))
    .maybeSingle()
  if (byCode.data) return byCode.data as unknown as Row

  const s = sanitizeQuery(ref)
  const { data, error } = await supabase.from('survey_projects')
    .select('*, captain:team_members(name, initials)')
    .is('deleted_at', null)
    .ilike('project_name', `%${s}%`)
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]
  return {
    ambiguous: rows.map(r => ({
      project_code: r.project_code as string | null,
      project_name: r.project_name as string,
      client: r.client as string,
    })),
  }
}

/** linked_documents elements are either a JSON string `{name,url}` (has a title) or a bare
 *  url string (no title found at link time) — normalize both into {name,url} objects. */
export function parseLinkedDocuments(raw: unknown): { name: string | null; url: string }[] {
  if (!Array.isArray(raw)) return []
  return raw.map(entry => {
    if (typeof entry !== 'string') return { name: null, url: String(entry) }
    try {
      const parsed = JSON.parse(entry) as unknown
      if (parsed && typeof parsed === 'object' && typeof (parsed as Row).url === 'string') {
        const name = (parsed as Row).name
        return { name: typeof name === 'string' ? name : null, url: (parsed as Row).url as string }
      }
    } catch {
      // Not JSON — it's a bare url string, fall through.
    }
    return { name: null, url: entry }
  })
}

export async function getProjectDetail(id: string, userId: string) {
  const supabase = createAdminClient()
  // Resolved once, up front: the whole return shape is assembled below and the
  // restricted fields have to be gone before it leaves this function.
  const canViewFinancials = await callerCanViewFinancials({ userId })

  const { data: project, error } = await supabase.from('survey_projects')
    .select('*, captain:team_members(name, initials)')
    .eq('id', id).maybeSingle()
  if (error) throw error
  if (!project) return null

  const p = project as unknown as Row

  const [
    bidsRes, blastsRes, stepsRes, activityRes, deliverablesRes, segmentsRes,
    clientRes, submissionsRes, remindersRes,
  ] = await Promise.all([
    supabase.from('project_bids').select('amount, blasts, note, created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('project_blasts').select('bid, people, completes, blast_at, note, created_at').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('project_steps').select('id, text, done, completed_at, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('project_activity').select('type, direction, sender, subject, snippet, occurred_at').eq('project_id', id).is('deleted_at', null).order('occurred_at', { ascending: false }).limit(10),
    supabase.from('deliverables').select('file_name, status, source_url, kind, created_at').eq('project_id', id).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('project_segments').select('label, n_target, n_collected, n_actual, sort_order').eq('project_id', id).order('sort_order', { ascending: true }),
    supabase.from('clients').select('compliance_before_fielding, compliance_after_fielding').eq('id', p.client_id as string).maybeSingle(),
    supabase.from('question_submissions').select('phase, status, submitted_at').eq('project_id', id).order('submitted_at', { ascending: false }),
    supabase.from('reminders').select('id, text, due_date, done').eq('project_id', id).eq('user_id', userId).order('due_date', { ascending: true }),
  ])

  const blasts = blastsRes.data ?? []
  const submissions = (submissionsRes.data ?? []) as { phase: string; status: string }[]
  const client = clientRes.data as { compliance_before_fielding: boolean; compliance_after_fielding: boolean } | null

  const compliance = {
    before_fielding_required: beforeFieldingRequired(
      client, p.compliance_override as boolean | null,
      p.rerun_number as number | null ?? undefined, p.compliance_required_override as boolean | null
    ),
    before_fielding_met: beforeFieldingMet(submissions),
    after_fielding_required: afterFieldingRequired(
      client, p.compliance_override as boolean | null,
      p.rerun_number as number | null ?? undefined, p.compliance_required_override as boolean | null
    ),
    after_fielding_met: afterFieldingMet(submissions),
  }

  return {
    ...slimProject(p, canViewFinancials),
    linked_documents: parseLinkedDocuments(p.linked_documents),
    bids: bidsRes.data ?? [],
    blasts,
    blast_spend_total: totalBidDollars(blasts as never),
    steps: stepsRes.data ?? [],
    activity: activityRes.data ?? [],
    deliverables: deliverablesRes.data ?? [],
    segments: segmentsRes.data ?? [],
    compliance,
    reminders: remindersRes.data ?? [],
  }
}

/** A project's prior/sibling waves in a longitudinal/rerun series, ordered by wave number.
 *  A spawned wave's own rerun_series_id points at the original wave's id; the original
 *  itself has rerun_series_id = null, so the "effective" series id is
 *  `rerun_series_id ?? id` and the family is `id = seriesId OR rerun_series_id = seriesId`.
 *  This lets the tool work whether asked from the original or from a later wave — the plan's
 *  literal spec only covers the "has rerun_series_id" case; this is a superset of that. */
export async function getProjectHistory(
  projectRef: string,
  ctx?: { userId?: string | null }
) {
  const resolved = await resolveProject(projectRef)
  if (resolved === null) return { error: `No project found matching "${projectRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
  }
  const p = resolved as Row
  const seriesId = (p.rerun_series_id as string | null) ?? (p.id as string)

  const canViewFinancials = await callerCanViewFinancials(ctx)
  const supabase = createAdminClient()
  // n_target is the MINIMUM of the N range since migration 078 — select the max
  // alongside it so a wave reads as "1,000–1,200", not a bare 1,000.
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, status, phase, board_column, rerun_number, launch_date, deliver_date, due_date, n_target, n_target_max, n_collected, n_actual, budget, actual_spend')
    .is('deleted_at', null)
    .or(`id.eq.${seriesId},rerun_series_id.eq.${seriesId}`)
    .order('rerun_number', { ascending: true })
  if (error) throw error

  const waves = (data ?? []).map(w => redactRestrictedMoney(w as unknown as Row, canViewFinancials))
  if (waves.length <= 1) {
    return { waves: [], note: 'not a longitudinal/rerun series' }
  }
  return { waves }
}

type ClientCandidate = { code: string | null; name: string }

/** Resolve a client ref (Cl-code exact, then name ilike). 0 -> null, 1 -> row, >1 -> ambiguous candidates. */
export async function resolveClient(
  ref: string
): Promise<Row | { ambiguous: ClientCandidate[] } | null> {
  const supabase = createAdminClient()
  const byCode = await supabase.from('clients')
    .select('*')
    .is('deleted_at', null)
    .ilike('code', ref.trim().replace(/([%_\\])/g, '\\$1'))
    .maybeSingle()
  if (byCode.data) return byCode.data as unknown as Row

  const s = sanitizeQuery(ref)
  const { data, error } = await supabase.from('clients')
    .select('*')
    .is('deleted_at', null)
    .ilike('name', `%${s}%`)
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]
  return {
    ambiguous: rows.map(r => ({ code: r.code as string | null, name: r.name as string })),
  }
}

export async function getClientDetail(id: string) {
  const supabase = createAdminClient()

  const { data: client, error } = await supabase.from('clients').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!client) return null

  const [contactsRes, notesRes, projectsRes] = await Promise.all([
    supabase.from('client_contacts').select('first_name, last_name, email, title, phone').eq('client_id', id).eq('archived', false),
    supabase.from('client_notes').select('body, created_by, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('survey_projects').select('project_code, project_name, status, due_date').eq('client_id', id).is('deleted_at', null).order('due_date', { ascending: true, nullsFirst: false }),
  ])

  return {
    ...(client as unknown as Row),
    contacts: contactsRes.data ?? [],
    notes: notesRes.data ?? [],
    projects: projectsRes.data ?? [],
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mode<T>(vals: T[]): T | null {
  if (vals.length === 0) return null
  const counts = new Map<T, number>()
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | null = null
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c }
  }
  return best
}

/**
 * "What did we do last time for this client?" — past & current projects (most-recent 50) plus
 * derived patterns computed over the client's FULL non-deleted history (not just the capped
 * page — cheap since this is one extra query, and a client with >50 projects shouldn't have
 * its typical-N/cadence skewed by the cap) and any explicitly stated preferences.
 */
export async function getClientHistory(
  clientRef: string,
  ctx?: { userId?: string | null }
) {
  const resolved = await resolveClient(clientRef)
  if (resolved === null) return { error: `No client found matching "${clientRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple clients match — specify the client code.', candidates: resolved.ambiguous }
  }
  const client = resolved as Row
  const clientId = client.id as string

  const canViewFinancials = await callerCanViewFinancials(ctx)
  const supabase = createAdminClient()

  const { data: allRows, error } = await supabase.from('survey_projects')
    .select(
      'id, project_code, project_name, project_type, status, phase, ' +
      'n_target, n_target_max, n_collected, n_actual, budget, actual_spend, launch_date, deliver_date, due_date, ' +
      'salesperson, linked_documents, created_at, captain:team_members(name, initials)'
    )
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error

  const rows = (allRows ?? []) as unknown as Row[]
  const recent = rows.slice(0, 50)

  const ids = recent.map(r => r.id as string)
  const deliverableCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: delivRows, error: delivErr } = await supabase.from('deliverables')
      .select('project_id').in('project_id', ids).is('deleted_at', null)
    if (delivErr) throw delivErr
    for (const d of delivRows ?? []) {
      const pid = d.project_id
      if (pid) deliverableCounts.set(pid, (deliverableCounts.get(pid) ?? 0) + 1)
    }
  }

  const projects = recent.map(r => {
    const cap = r.captain as { name?: string; initials?: string } | null
    return redactRestrictedMoney({
      project_code: r.project_code, project_name: r.project_name, project_type: r.project_type,
      status: r.status, phase: r.phase,
      // n_target is the BOTTOM of the N range (migration 078); n_target_max is
      // the top. They're equal on every pre-078 project.
      n_target: r.n_target, n_target_max: r.n_target_max,
      n_collected: r.n_collected, n_actual: r.n_actual,
      budget: r.budget, actual_spend: r.actual_spend,
      launch_date: r.launch_date, deliver_date: r.deliver_date, due_date: r.due_date,
      captain: cap ? { initials: cap.initials ?? null, name: cap.name ?? null } : null,
      salesperson: r.salesperson,
      linked_documents: parseLinkedDocuments(r.linked_documents),
      deliverables_count: deliverableCounts.get(r.id as string) ?? 0,
    }, canViewFinancials)
  })

  // ---- patterns (over the full history) ----
  // Since migration 078 an N target is a RANGE: n_target is the floor we commit
  // to, n_target_max the ceiling. A single `typical_n_target` would now be read
  // as "the N they usually order" when it's really "the least N they'd accept",
  // so report both ends under names that say which is which. (A project with no
  // max recorded falls back to its min — the range is a point.) The two medians
  // are computed independently, so the pair is a typical floor and a typical
  // ceiling, not necessarily one real project's range.
  const nTargetMins = rows.map(r => r.n_target).filter((n): n is number => typeof n === 'number')
  const nTargetMaxes = rows
    .map(r => (typeof r.n_target_max === 'number' ? r.n_target_max : r.n_target))
    .filter((n): n is number => typeof n === 'number')
  const types = rows.map(r => r.project_type).filter((t): t is string => typeof t === 'string')
  const fieldingDays = rows
    .filter(r => typeof r.launch_date === 'string' && typeof r.deliver_date === 'string')
    .map(r => (new Date(r.deliver_date as string).getTime() - new Date(r.launch_date as string).getTime()) / 86_400_000)
    .filter(d => Number.isFinite(d) && d >= 0)
  const createdTimes = rows
    .map(r => (typeof r.created_at === 'string' ? new Date(r.created_at).getTime() : NaN))
    .filter(t => Number.isFinite(t))

  let cadencePerYear: number | null = null
  if (createdTimes.length >= 2) {
    const spanYears = (Math.max(...createdTimes) - Math.min(...createdTimes)) / (365.25 * 86_400_000)
    cadencePerYear = spanYears > 0 ? Math.round((rows.length / spanYears) * 10) / 10 : rows.length
  }

  const avgFieldingDaysRaw = median(fieldingDays)

  const [contactsRes, notesRes] = await Promise.all([
    supabase.from('client_contacts').select('first_name, last_name, email, title, phone')
      .eq('client_id', clientId).eq('archived', false),
    supabase.from('client_notes').select('body, created_by, created_at')
      .eq('client_id', clientId).like('body', 'PREF:%').order('created_at', { ascending: false }),
  ])

  const recurringContacts = (contactsRes.data ?? []).map(c => ({
    name: `${c.first_name} ${c.last_name}`.trim(), title: c.title, email: c.email, phone: c.phone,
  }))
  const statedPreferences = (notesRes.data ?? []).map(n => ({
    text: n.body.replace(/^PREF:\s*/, ''), created_by: n.created_by, created_at: n.created_at,
  }))

  return {
    client: { code: client.code as string | null, name: client.name as string },
    projects,
    patterns: {
      typical_n_target_min: median(nTargetMins),
      typical_n_target_max: median(nTargetMaxes),
      common_project_type: mode(types),
      avg_fielding_days: avgFieldingDaysRaw === null ? null : Math.round(avgFieldingDaysRaw),
      cadence_per_year: cadencePerYear,
      recurring_contacts: recurringContacts,
    },
    stated_preferences: statedPreferences,
  }
}

const DAY_MS = 86_400_000
/** Today (YYYY-MM-DD) in the team's timezone — mirrors toolHelpers.todayEastern and
 *  the app UI. All date comparisons here are against date-only (YYYY-MM-DD) columns,
 *  so using a UTC "today" mis-dates work during the evening-ET window. */
function todayET(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}
/** Shift a YYYY-MM-DD date by n days (UTC-anchored; safe for date-only comparisons). */
function addDays(isoDate: string, n: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Port of the daily-digest logic (overdue / due-soon / fielding-behind-pace) plus counts.
 *  mine:true scopes everything (overdue/due-soon/fielding-behind AND the counts) to the
 *  caller's own captained projects, resolved via getMe(userId). */
export async function pipelineSummary(args: { mine?: boolean; userId?: string } = {}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, client, board_column, due_date, n_target, n_target_max, n_collected, status, phase, captain:team_members(name, initials)')
    .eq('status', 'Open')
    .eq('phase', 'Active')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (error) throw error

  let rows = (data ?? []) as unknown as Row[]
  // SQL already restricts to Open+Active, but a delivered project can sit in the
  // 'Delivery' (Delivered) column with status still Open — drop those so the
  // overdue / due-soon buckets never flag finished work as due.
  rows = rows.filter(isActiveOperational)

  let myInitials: string | null = null
  if (args.mine && args.userId) {
    const me = await getMe(args.userId)
    // Fail closed: if the caller isn't in Team Members we CAN'T scope to "them" —
    // don't silently fall through and return the whole portfolio as if it were theirs.
    if (!me) return { error: "Could not resolve your team-member record (no matching Team Members row) — can't scope this to you." }
    myInitials = me.initials
  }
  if (myInitials) {
    const ci = myInitials.toLowerCase()
    rows = rows.filter(r => ((r.captain as { initials?: string } | null)?.initials ?? '').toLowerCase() === ci)
  }

  const today = todayET()
  const soon = addDays(today, 3)

  // overdue = due date strictly in the past. A date falling on today is NOT overdue —
  // it's due_soon (matches lib/utils/date.ts getDueUrgency, and whats_at_risk).
  const overdue = rows.filter(p => p.due_date && (p.due_date as string) < today)
  const dueSoon = rows.filter(p => p.due_date && (p.due_date as string) >= today && (p.due_date as string) <= soon)
  const fieldingBehind = rows.filter(p =>
    p.board_column === 'Fielding' &&
    p.n_target != null &&
    (p.n_collected as number) < (p.n_target as number) &&
    p.due_date != null &&
    (p.due_date as string) <= soon
  )

  const { data: allOpen } = await supabase.from('survey_projects')
    .select('board_column, status, phase, captain:team_members(initials)')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    // Exclude both archived buckets from the breakdown: Closed (archived) and
    // Cancelled (client cancelled) are off-board, so they shouldn't inflate the
    // in-flight counts — same treatment either way.
    .neq('status', 'Closed')
    .neq('status', 'Cancelled')

  let allOpenRows = (allOpen ?? []) as unknown as Row[]
  if (myInitials) {
    const ci = myInitials.toLowerCase()
    allOpenRows = allOpenRows.filter(r => ((r.captain as { initials?: string } | null)?.initials ?? '').toLowerCase() === ci)
  }

  const countsByColumn: Record<string, number> = {}
  const countsByStatus: Record<string, number> = {}
  const countsByPhase: Record<string, number> = {}
  for (const r of allOpenRows) {
    const col = r.board_column as string
    const status = r.status as string
    const phase = r.phase as string
    countsByColumn[col] = (countsByColumn[col] ?? 0) + 1
    countsByStatus[status] = (countsByStatus[status] ?? 0) + 1
    countsByPhase[phase] = (countsByPhase[phase] ?? 0) + 1
  }

  return {
    // The count of in-flight operational projects (isActiveOperational; mine-scoped
    // when mine:true) — the single trustworthy "how many open/active projects"
    // number. counts.by_status.Open below is NOT that (it includes Scoping/Hold/
    // Delivered), so callers should read active_count, not by_status.Open.
    active_count: rows.length,
    overdue, due_soon: dueSoon, fielding_behind: fieldingBehind,
    counts: { by_board_column: countsByColumn, by_status: countsByStatus, by_phase: countsByPhase },
  }
}

/** Simple linear projection of where fielding N will land by the due date, from
 *  the collection rate so far (n_collected / days since launch). Returns nulls when
 *  there's no target, or no launch/due date to project against. */
function projectShortfall(p: Row, today: string): {
  collection_pct: number | null; projected_final: number | null; shortfall: number | null
} {
  const target = p.n_target as number | null
  const collected = (p.n_collected as number | null) ?? 0
  if (target == null || target <= 0) return { collection_pct: null, projected_final: null, shortfall: null }
  const collection_pct = Math.round((collected / target) * 100)
  const launch = p.launch_date as string | null
  const due = p.due_date as string | null
  if (!launch || !due) return { collection_pct, projected_final: null, shortfall: null }
  // No projection until at least a day of fielding has elapsed. Guards both the
  // launched-today divide-by-zero AND a future/mistyped launch_date (which would
  // otherwise treat all of n_collected as one day's pace and wildly overstate the rate).
  const elapsed = Math.round((Date.parse(today) - Date.parse(launch)) / DAY_MS)
  if (elapsed < 1) return { collection_pct, projected_final: null, shortfall: null }
  const daysLeft = Math.max(0, Math.round((Date.parse(due) - Date.parse(today)) / DAY_MS))
  const rate = collected / elapsed
  const projected_final = Math.round(collected + rate * daysLeft)
  const shortfall = Math.max(0, target - projected_final)
  return { collection_pct, projected_final, shortfall }
}

/** One triage call: everything on the ACTIVE operational board that needs attention
 *  now, bucketed by risk DIMENSION (a project can appear in more than one — that's the
 *  point) and sorted by severity within each:
 *   - overdue: due date strictly passed (with days_overdue)
 *   - due_soon: due today .. +3 days (with days_until; days_until 0 = due today)
 *   - fielding_behind: in Fielding, under target, due within the window, with a
 *     projected final N + shortfall extrapolated from the collection rate so far
 *   - over_budget: actual_spend > budget (with the overage) — RESTRICTED, see below
 *   - reruns_overdue: recurring reruns past due (from the first-class rerun_series_status via rerunRadar)
 *  at_risk_count is the DISTINCT project count across the four project buckets, so the
 *  headline isn't inflated by a project that's in several. mine:true scopes projects to
 *  your captained work and reruns to the ones you own.
 *
 *  over_budget is a budget COMPARISON, so it's limited to `view_financials`
 *  holders — and the whole bucket goes, not just its numbers: even a bare count
 *  of over-budget projects is a statement about the ceiling. For everyone else
 *  the key is ABSENT (not an empty list, which reads as "nothing is over
 *  budget") and `restricted` names what was withheld, so the model can say it
 *  doesn't know instead of asserting all-clear. Dropping the bucket also drops
 *  those projects from at_risk_count when nothing else flags them — correct: you
 *  can't act on a risk whose evidence you can't see. */
export async function whatsAtRisk(args: { mine?: boolean; userId?: string; userEmail?: string } = {}) {
  const canViewFinancials = await callerCanViewFinancials(args)
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, client, board_column, due_date, launch_date, n_target, n_target_max, n_collected, budget, actual_spend, status, phase, captain:team_members(name, initials)')
    .eq('status', 'Open').eq('phase', 'Active').is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (error) throw error
  let rows = ((data ?? []) as unknown as Row[]).filter(isActiveOperational)

  if (args.mine && args.userId) {
    const me = await getMe(args.userId)
    // Fail closed: no Team Members row → we can't scope to "you"; don't return the
    // whole portfolio as if it were the caller's (reruns scope by email independently,
    // so a silent fall-through would also be inconsistent).
    if (!me) return { error: "Could not resolve your team-member record (no matching Team Members row) — can't scope this to you." }
    const ci = me.initials.toLowerCase()
    rows = rows.filter(r => ((r.captain as { initials?: string } | null)?.initials ?? '').toLowerCase() === ci)
  }

  const today = todayET()
  const soon = addDays(today, 3)
  const capOf = (r: Row) => (r.captain as { initials?: string } | null)?.initials ?? null
  const base = (r: Row) => ({
    project_code: r.project_code, project_name: r.project_name, client: r.client,
    board_column: r.board_column, captain: capOf(r), due_date: r.due_date,
  })

  const overdue = rows
    .filter(r => r.due_date && (r.due_date as string) < today)
    .map(r => ({ ...base(r), days_overdue: Math.round((Date.parse(today) - Date.parse(r.due_date as string)) / DAY_MS) }))
    .sort((a, b) => b.days_overdue - a.days_overdue)

  const dueSoon = rows
    .filter(r => r.due_date && (r.due_date as string) >= today && (r.due_date as string) <= soon)
    .map(r => ({ ...base(r), days_until: Math.round((Date.parse(r.due_date as string) - Date.parse(today)) / DAY_MS) }))
    .sort((a, b) => a.days_until - b.days_until)

  const fieldingBehind = rows
    .filter(r =>
      r.board_column === 'Fielding' &&
      r.n_target != null &&
      (((r.n_collected as number | null) ?? 0) < (r.n_target as number)) &&
      r.due_date != null &&
      (r.due_date as string) <= soon)
    // Judged against n_target — the FLOOR of the range, i.e. the N we committed
    // to; n_target_max rides along so the model reports the range, not the floor
    // as if it were the whole ask.
    .map(r => ({ ...base(r), n_target: r.n_target, n_target_max: r.n_target_max, n_collected: (r.n_collected as number | null) ?? 0, ...projectShortfall(r, today) }))
    .sort((a, b) => (b.shortfall ?? 0) - (a.shortfall ?? 0))

  const overBudget = canViewFinancials
    ? rows
        .filter(r => r.budget != null && r.actual_spend != null && (r.actual_spend as number) > (r.budget as number))
        .map(r => ({ ...base(r), budget: r.budget, actual_spend: r.actual_spend, overage: Math.round((r.actual_spend as number) - (r.budget as number)) }))
        .sort((a, b) => b.overage - a.overage)
    : null

  const reruns = await rerunRadar(args.mine && args.userEmail ? { ownerEmail: args.userEmail } : {})
  const rerunsOverdue = reruns.overdue

  // A project can surface in several buckets (different dimensions); count DISTINCT
  // projects for the headline so it isn't double/triple-counted.
  const distinct = new Set<string>()
  for (const x of [...overdue, ...dueSoon, ...fieldingBehind, ...(overBudget ?? [])]) distinct.add(String(x.project_code))
  const at_risk_count = distinct.size

  const counts: {
    overdue: number; due_soon: number; fielding_behind: number
    over_budget?: number; reruns_overdue: number
  } = {
    overdue: overdue.length, due_soon: dueSoon.length, fielding_behind: fieldingBehind.length,
    reruns_overdue: rerunsOverdue.length,
  }
  if (overBudget) counts.over_budget = overBudget.length
  // "Nothing at risk" would overstate for a caller whose over-budget bucket was
  // never checked, so qualify the all-clear rather than letting it read absolute.
  const summary = (at_risk_count === 0 && rerunsOverdue.length === 0)
    ? (overBudget
        ? 'Nothing flagged at risk right now.'
        : "Nothing flagged at risk right now, except that budget vs spend wasn't checked (finance-only).")
    : `${at_risk_count} project(s) at risk — ${counts.overdue} overdue, ${counts.due_soon} due soon, ${counts.fielding_behind} fielding behind pace` +
      (overBudget ? `, ${overBudget.length} over budget` : '') +
      (rerunsOverdue.length ? ` · ${rerunsOverdue.length} rerun(s) overdue` : '') + '.'
  return {
    ok: true, at_risk_count, counts,
    overdue, due_soon: dueSoon, fielding_behind: fieldingBehind,
    ...(overBudget ? { over_budget: overBudget } : {}),
    reruns_overdue: rerunsOverdue,
    ...(overBudget ? {} : {
      restricted: [
        'over_budget — budget vs spend is limited to finance-capability holders, so it was not checked. Do not tell the user nothing is over budget; say you cannot see budgets.',
      ],
    }),
    summary,
  }
}

/** Recent field-level change history for one project, from the project_audit log
 *  (populated by DB triggers for app, AI, sync, and manual-SQL writes). Newest
 *  first. Resolves the project ref the same way get_project does.
 *
 *  The audit log is the back door onto every restricted number: a row for
 *  `budget` carries BOTH the old and the new ceiling as text, so an ungated
 *  history read hands out more than the field itself ever would. Rows for
 *  restricted fields are therefore dropped for a caller without
 *  `view_financials`, and the fields they named come back in `restricted` —
 *  naming the FIELD is fine, it's the values that are limited, and the model has
 *  to know something was withheld or it will report "nothing else changed".
 *
 *  Which rows those are is auditFormat's isRestrictedAuditField — the same
 *  predicate the app's audit feeds use, so the connector and the Logs tab hide
 *  exactly the same rows. */
export async function getChangeHistory(
  projectRef: string,
  limit = 20,
  ctx?: { userId?: string | null }
) {
  const resolved = await resolveProject(projectRef)
  if (resolved === null) return { error: `No project found matching "${projectRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
  }
  const p = resolved as Row
  const canViewFinancials = await callerCanViewFinancials(ctx)
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('project_audit')
    .select('field, old_value, new_value, changed_by, changed_at')
    .eq('project_id', p.id as string)
    .order('changed_at', { ascending: false })
    .limit(Math.min(limit, 100))
  if (error) throw error
  const withheld = new Set<string>()
  const changes = (data ?? [])
    .filter(c => {
      if (canViewFinancials || !isRestrictedAuditField(c.field)) return true
      withheld.add(c.field)
      return false
    })
    .map(c => ({
      field: c.field, from: c.old_value, to: c.new_value, by: c.changed_by, at: c.changed_at,
    }))
  return {
    project_code: p.project_code as string | null,
    project_name: p.project_name as string,
    count: changes.length,
    changes,
    ...(withheld.size ? { restricted: [restrictedAuditNote([...withheld])] } : {}),
  }
}

/** The one sentence a tool says when it dropped audit rows for restricted
 *  fields. Names the fields and forbids the "so nothing changed" reading —
 *  same job as whatsAtRisk's `restricted` note. */
export function restrictedAuditNote(fields: string[]): string {
  return `${fields.sort().join(', ')} — finance-only field(s), so their changes were left out of this history. ` +
    'Do not tell the user those fields did not change; say you cannot see them.'
}

/** The most recent EDIT (all audit rows sharing the newest changed_at — a single
 *  UPDATE audits one row per changed field, all with the same transaction timestamp)
 *  for a project, or null. Powers undo_last_change, which reverts the batch as a unit
 *  so a multi-field edit is undone together and the target is order-independent.
 *
 *  Same gate as getChangeHistory, and it does double duty here: a restricted row
 *  is dropped from `rows`, so a caller without `view_financials` neither reads
 *  the old ceiling out of the preview NOR reverts a number they can't see. What
 *  was dropped comes back in `restricted_fields` so the tool can list it as
 *  skipped instead of pretending that field wasn't part of the edit. */
export async function getLastChangeBatch(
  projectId: string,
  ctx?: { userId?: string | null }
): Promise<
  {
    changed_at: string
    changed_by: string
    rows: { field: string; old_value: string | null; new_value: string | null }[]
    restricted_fields: string[]
  } | null
> {
  const canViewFinancials = await callerCanViewFinancials(ctx)
  const supabase = createAdminClient()
  const { data: top, error: e1 } = await supabase.from('project_audit')
    .select('changed_at, changed_by')
    .eq('project_id', projectId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (e1) throw e1
  if (!top) return null
  const { data, error: e2 } = await supabase.from('project_audit')
    .select('field, old_value, new_value')
    .eq('project_id', projectId)
    .eq('changed_at', top.changed_at as string)
  if (e2) throw e2
  const all = (data ?? []) as { field: string; old_value: string | null; new_value: string | null }[]
  const restricted_fields = canViewFinancials ? [] : all.filter(r => isRestrictedAuditField(r.field)).map(r => r.field)
  return {
    changed_at: top.changed_at as string,
    changed_by: top.changed_by as string,
    rows: canViewFinancials ? all : all.filter(r => !isRestrictedAuditField(r.field)),
    restricted_fields,
  }
}

// ---------------------------------------------------------------------------
// Reruns — the first-class rerun_series model (migration 073) is the source of
// truth. rerun_radar and search/report/detail/calendar all read it directly;
// the legacy sheet-mirror (rerun_status) has been RETIRED as a rerun view. All
// date comparisons are date-only (YYYY-MM-DD), America/New_York.
// ---------------------------------------------------------------------------

type SeriesStatusRow = Database['public']['Views']['rerun_series_status']['Row']

/** cadence_months → a human keyword for display. Inverse of seriesOps.cadenceToMonths. */
export function cadenceLabel(months: number | null): string {
  if (months == null) return 'adhoc'
  if (months === 1) return 'monthly'
  if (months === 3) return 'quarterly'
  if (months === 6) return 'semiannual'
  if (months === 12) return 'yearly'
  return `${months}mo`
}

/** The compact per-series shape returned by search_reruns / rerun_calendar. */
function shapeSeries(r: SeriesStatusRow) {
  return {
    id: r.id,
    client: r.client,
    survey_name: r.survey_name,
    base_type: r.base_type,
    // Legacy seeded series can carry no base type yet — surface the flag so
    // callers can tell a blank base_type apart from a mistake (migration 074).
    rerun_service: r.rerun_service,
    cadence: cadenceLabel(r.cadence_months),
    cadence_months: r.cadence_months,
    service_mode: r.service_mode,
    in_service: r.in_service,
    paused: r.paused,
    is_overdue: r.is_overdue,
    owner_email: r.owner_email,
    effective_next: r.effective_next,
    days_to_next: r.days_to_next,
  }
}

/** Resolve a rerun-series ref: a uuid matches `id` directly; otherwise a text
 *  query matches client/survey_name on the status view. 0 → null, 1 → {id},
 *  >1 → { ambiguous: [...] }. Mirrors resolveProject/resolveClient. */
export async function resolveRerunSeries(
  ref: string
): Promise<{ id: string } | { ambiguous: { id: string; client: string; survey_name: string }[] } | null> {
  const supabase = createAdminClient()
  const trimmed = ref.trim()
  // A uuid ref matches a series id exactly.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    const { data, error } = await supabase.from('rerun_series_status').select('id').eq('id', trimmed).maybeSingle()
    if (error) throw error
    if (data) return { id: data.id }
    return null
  }
  const s = sanitizeQuery(trimmed)
  const { data, error } = await supabase
    .from('rerun_series_status')
    .select('id, client, survey_name')
    .or(`client.ilike.%${s}%,survey_name.ilike.%${s}%`)
    .limit(10)
  if (error) throw error
  const rows = (data ?? []) as { id: string; client: string; survey_name: string }[]
  if (rows.length === 0) return null
  if (rows.length === 1) return { id: rows[0].id }
  return { ambiguous: rows.map((r) => ({ id: r.id, client: r.client, survey_name: r.survey_name })) }
}

/** Search first-class rerun series with filters — the connector/assistant
 *  reader for "which reruns are …". status maps to the view's flags:
 *  in_service / paused / is_overdue; 'ended' = not in service. */
export async function searchReruns(args: {
  query?: string
  client?: string
  base_type?: string
  status?: 'in_service' | 'paused' | 'ended' | 'overdue'
  owner?: string
  mine?: boolean
  userEmail?: string
  limit?: number
}) {
  const supabase = createAdminClient()
  let q = supabase.from('rerun_series_status').select('*')
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`client.ilike.%${s}%,survey_name.ilike.%${s}%`)
  }
  if (args.client) q = q.ilike('client', `%${sanitizeQuery(args.client)}%`)
  if (args.base_type) q = q.eq('base_type', args.base_type)
  if (args.status === 'in_service') q = q.eq('in_service', true)
  else if (args.status === 'paused') q = q.eq('paused', true)
  else if (args.status === 'ended') q = q.eq('in_service', false)
  else if (args.status === 'overdue') q = q.eq('is_overdue', true)
  // mine (own email) wins over an explicit owner substring filter.
  if (args.mine && args.userEmail) q = q.eq('owner_email', args.userEmail)
  else if (args.owner) q = q.ilike('owner_email', `%${sanitizeQuery(args.owner)}%`)

  const { data, error } = await q
    .order('effective_next', { ascending: true, nullsFirst: false })
    .limit(Math.min(args.limit ?? 50, 100))
  if (error) throw error
  const series = ((data ?? []) as SeriesStatusRow[]).map(shapeSeries)
  const overdue = series.filter((s) => s.is_overdue).length
  const paused = series.filter((s) => s.paused).length
  const summary =
    series.length === 0
      ? 'No rerun series match.'
      : `${series.length} rerun series — ${overdue} overdue, ${paused} paused.`
  return { ok: true, count: series.length, series, summary }
}

/** One rerun series' status row + its waves (as normal survey_projects rows),
 *  ordered by wave number. Mirrors useRerunSeriesRecord's read.
 *
 *  The row carries `future_defaults` — untyped jsonb of what the next wave
 *  inherits, and `budget` is one of the keys nextWaveInherit reads out of it
 *  (lib/reruns/series.ts). So the blob gets the same treatment as a project row
 *  before it leaves. */
export async function getRerunSeries(seriesId: string, ctx?: { userId?: string | null }) {
  const canViewFinancials = await callerCanViewFinancials(ctx)
  const supabase = createAdminClient()
  const { data: series, error: sErr } = await supabase
    .from('rerun_series_status')
    .select('*')
    .eq('id', seriesId)
    .maybeSingle()
  if (sErr) throw sErr
  if (!series) return { error: 'No rerun series with that id.' }
  const { data: waves, error: wErr } = await supabase
    .from('survey_projects')
    .select(
      'id, project_code, project_name, rerun_number, submitted_date, launch_date, deliver_date, delivered_at, n_target, n_collected, n_actual, survey_tool_id, status, board_column'
    )
    .eq('series_id', seriesId)
    .is('deleted_at', null)
    .order('rerun_number', { ascending: true })
  if (wErr) throw wErr
  const s = series as SeriesStatusRow
  const waveList = waves ?? []
  const summary =
    `${s.client} — ${s.survey_name}: ${waveList.length} wave(s), ` +
    `next ${s.effective_next ?? '—'}, ${s.owner_email ?? 'unassigned'}` +
    (s.paused ? ' (paused)' : !s.in_service ? ' (ended)' : '')
  return {
    series: { ...s, future_defaults: redactFutureDefaults(s.future_defaults, canViewFinancials) },
    waves: waveList,
    summary,
  }
}

/** `rerun_series.future_defaults` minus its restricted-money keys. The blob is
 *  jsonb with no type to lean on, so anything non-object comes back as an empty
 *  object rather than being passed through unread. */
export function redactFutureDefaults(raw: unknown, canViewFinancials: boolean): Record<string, unknown> {
  const blob = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? (raw as Row) : {}
  return redactRestrictedMoney(blob, canViewFinancials)
}

/** Resolve a series ref for a WRITE tool: same resolution as resolveRerunSeries
 *  (uuid or client/survey-name query) but returns the ready-to-use pieces the
 *  lifecycle tools need — the series id, a "<client> — <survey>" label, and the
 *  status ROW (no waves — the lifecycle writes don't need the wave list). Errors
 *  and ambiguity come back as the same { error } / { note, candidates } sentinels
 *  the tools already forward. */
export async function resolveSeriesForWrite(
  ref: string
): Promise<
  | { error: string }
  | { note: string; candidates: { id: string; client: string; survey_name: string }[] }
  | { seriesId: string; label: string; series: SeriesStatusRow }
> {
  const resolved = await resolveRerunSeries(ref)
  if (resolved === null) return { error: `No rerun series found matching "${ref}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple rerun series match — specify the series id.', candidates: resolved.ambiguous }
  }
  const supabase = createAdminClient()
  const { data: series, error } = await supabase
    .from('rerun_series_status')
    .select('*')
    .eq('id', resolved.id)
    .maybeSingle()
  if (error) throw error
  if (!series) return { error: 'No rerun series with that id.' }
  const s = series as SeriesStatusRow
  return { seriesId: s.id, label: `${s.client} — ${s.survey_name}`, series: s }
}

/** Rerun calendar — in-service, non-paused series bucketed by effective_next
 *  relative to today (ET): overdue / due within the window horizon / upcoming.
 *  window is week (7d) / month (30d) / quarter (90d). */
export async function rerunCalendar(args: { window?: 'week' | 'month' | 'quarter'; mine?: boolean; userEmail?: string }) {
  const supabase = createAdminClient()
  let q = supabase.from('rerun_series_status').select('*').eq('paused', false).eq('in_service', true)
  if (args.mine && args.userEmail) q = q.eq('owner_email', args.userEmail)
  const { data, error } = await q
  if (error) throw error

  const window = args.window ?? 'week'
  const windowDays = window === 'week' ? 7 : window === 'month' ? 30 : 90
  const today = todayET()
  const horizon = addDays(today, windowDays)

  type Item = ReturnType<typeof shapeSeries>
  const overdue: Item[] = []
  const due_in_window: Item[] = []
  const upcoming: Item[] = []
  for (const r of (data ?? []) as SeriesStatusRow[]) {
    const item = shapeSeries(r)
    if (r.is_overdue) overdue.push(item)
    else if (r.effective_next && r.effective_next <= horizon) due_in_window.push(item)
    else if (r.effective_next) upcoming.push(item)
  }
  const byNext = (a: Item, b: Item) => String(a.effective_next ?? '').localeCompare(String(b.effective_next ?? ''))
  overdue.sort(byNext)
  due_in_window.sort(byNext)
  upcoming.sort(byNext)

  const counts = { overdue: overdue.length, due_in_window: due_in_window.length, upcoming: upcoming.length }
  const summary =
    `Reruns (${window}) — ${counts.overdue} overdue, ${counts.due_in_window} due this ${window}, ` +
    `${counts.upcoming} upcoming.`
  return { ok: true, window, counts, overdue, due_in_window, upcoming, summary }
}

/** Days of lead time before a first-class series' effective_next at which it
 *  enters rerun_radar's "prep window" bucket. The series view carries no
 *  per-row lead_days, so the radar applies this single default. */
const SERIES_PREP_LEAD_DAYS = 14

/** Rerun Radar — recurring reruns that need attention, bucketed into overdue /
 *  needs-definition / prep-window / upcoming (each in ONE bucket by priority).
 *  Reads the FIRST-CLASS rerun_series model (rerun_series_status) ONLY. The
 *  legacy sheet-mirror (rerun_status) has been RETIRED as a rerun view (the nav
 *  badge + every other rerun surface already count first-class only); unioning
 *  it back in here only double-showed studies and inflated the buckets with
 *  phantom-overdue rows. Paused / ended series are excluded (they don't need
 *  attention). needs_definition is always empty: a first-class series always
 *  makes a DELIBERATE cadence choice at creation (adhoc → null cadence is "by
 *  choice", not "undefined"), so an adhoc / no-anchor series simply carries no
 *  due date and isn't surfaced on a due-date radar. The bucket is kept in the
 *  output shape (as 0/[]) so callers don't have to branch. Optional owner
 *  filter. */
export async function rerunRadar(opts: { ownerEmail?: string } = {}) {
  const supabase = createAdminClient()

  type Item = {
    id: unknown; name: string | null; client: unknown; platform: unknown; cadence: unknown
    last_wave_on: unknown; due: unknown; days_to_due: unknown; owner: unknown; survey_ids: unknown
  }
  const buckets = {
    overdue: [] as Item[],
    needs_definition: [] as Item[],
    prep_window: [] as Item[],
    upcoming: [] as Item[],
  }

  let sq = supabase
    .from('rerun_series_status')
    .select('*')
    .eq('paused', false)
    .eq('in_service', true)
  if (opts.ownerEmail) sq = sq.eq('owner_email', opts.ownerEmail)
  const { data: seriesRows, error: sErr } = await sq
  if (sErr) throw sErr
  for (const r of (seriesRows ?? []) as SeriesStatusRow[]) {
    const item: Item = {
      id: r.id, name: r.survey_name, client: r.client, platform: r.base_type,
      cadence: cadenceLabel(r.cadence_months), last_wave_on: r.last_on, due: r.effective_next,
      days_to_due: r.days_to_next, owner: r.owner_email, survey_ids: null,
    }
    if (r.is_overdue) buckets.overdue.push(item)
    else if (r.effective_next && r.days_to_next != null && r.days_to_next <= SERIES_PREP_LEAD_DAYS)
      buckets.prep_window.push(item)
    else if (r.effective_next) buckets.upcoming.push(item)
    // else: adhoc / no-anchor (no due date) → not surfaced; no needs_definition state.
  }

  // Soonest-first within the date-bearing buckets.
  const byDue = (a: { due: unknown }, b: { due: unknown }) => String(a.due ?? '').localeCompare(String(b.due ?? ''))
  buckets.overdue.sort(byDue); buckets.prep_window.sort(byDue); buckets.upcoming.sort(byDue)

  const counts = {
    overdue: buckets.overdue.length,
    needs_definition: buckets.needs_definition.length,
    prep_window: buckets.prep_window.length,
    upcoming: buckets.upcoming.length,
  }
  const summary =
    `Reruns — ${counts.overdue} overdue, ${counts.prep_window} in the prep window, ` +
    `${counts.upcoming} upcoming.`
  return { ok: true, counts, ...buckets, summary }
}

export async function searchClients(args: { query?: string; limit?: number }) {
  const supabase = createAdminClient()
  let q = supabase.from('clients').select('*').is('deleted_at', null)
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`name.ilike.%${s}%,code.ilike.%${s}%`)
  }
  const { data, error } = await q.order('name', { ascending: true }).limit(Math.min(args.limit ?? 20, 50))
  if (error) throw error
  const clients = (data ?? []) as unknown as Row[]

  const results = await Promise.all(clients.map(async c => {
    const { data: projects } = await supabase.from('survey_projects')
      .select('status, phase, board_column').eq('client_id', c.id as string).is('deleted_at', null)
    // "open" = in-flight/active (excludes Closed, On-Hold, and Delivered), matching
    // how the rest of the connector treats "open"/"active".
    const open = (projects ?? []).filter(isActiveOperational).length
    const closed = (projects ?? []).filter(p => p.status === 'Closed').length
    return {
      code: c.code, name: c.name,
      open_projects: open, closed_projects: closed,
      compliance_before_fielding: c.compliance_before_fielding,
      compliance_after_fielding: c.compliance_after_fielding,
    }
  }))
  return results
}

export async function listActivity(projectId: string | null, limit = 20, search?: string) {
  const supabase = createAdminClient()
  let q = supabase.from('project_activity')
    .select('id, project_id, type, direction, sender, subject, snippet, occurred_at, survey_projects(project_code, project_name)')
    .is('deleted_at', null)
  if (projectId) q = q.eq('project_id', projectId)
  if (search) {
    const s = sanitizeQuery(search)
    q = q.or(`subject.ilike.%${s}%,body.ilike.%${s}%,sender.ilike.%${s}%`)
  }
  q = q.order('occurred_at', { ascending: false }).limit(Math.min(limit, 50))
  const { data, error } = await q
  if (error) throw error
  // Snippets only (not full bodies) to keep the connector's context lean — use
  // getActivityDetail(id) for the full body of a specific entry.
  return (data ?? []).map((a: Record<string, unknown>) => {
    const proj = a.survey_projects as { project_code: string | null; project_name: string } | null
    return {
      id: a.id,
      project_code: proj?.project_code ?? null,
      project_name: proj?.project_name ?? null,
      type: a.type, direction: a.direction, sender: a.sender,
      subject: a.subject, snippet: a.snippet, occurred_at: a.occurred_at,
    }
  })
}

/** Full body + participants of one logged activity entry (email) by id — the
 *  on-demand full-body fetch behind the connector's get_email tool. */
export async function getActivityDetail(id: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('project_activity')
    .select('id, type, direction, sender, recipients, subject, body, occurred_at, external_id, survey_projects(project_code, project_name)')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw error
  if (!data) return { error: 'No activity entry with that id.' }
  const a = data as Record<string, unknown>
  const proj = a.survey_projects as { project_code: string | null; project_name: string } | null
  return {
    id: a.id,
    project_code: proj?.project_code ?? null,
    project_name: proj?.project_name ?? null,
    type: a.type, direction: a.direction, sender: a.sender, recipients: a.recipients,
    subject: a.subject, body: a.body, occurred_at: a.occurred_at, external_id: a.external_id,
  }
}

export async function getTeamInitials(): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('team_members').select('initials')
  if (error) throw error
  return (data ?? []).map(t => t.initials)
}

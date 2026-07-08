import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { totalBidDollars } from '@/lib/utils/blast'
import { beforeFieldingRequired, afterFieldingRequired, beforeFieldingMet, afterFieldingMet } from '@/lib/utils/compliance'

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

const STRIPPED = [
  'created_at', 'updated_at', 'calendar_event_id', 'survey_ids_from_sheet',
  'survey_ids_synced_at', 'stage_doc_programming', 'stage_survey_programming',
  'stage_edwin_qa', 'stage_fielding', 'stage_data_qa', 'stage_delivery',
] as const

type Row = Record<string, unknown>

export function slimProject(p: Row): Row {
  if (p.status === 'Closed') {
    return {
      project_code: p.project_code, project_name: p.project_name, client: p.client,
      project_type: p.project_type, status: 'Closed', submitted_date: p.submitted_date,
      deliver_date: p.deliver_date, n_target: p.n_target, n_actual: p.n_actual,
      budget: p.budget, actual_spend: p.actual_spend, salesperson: p.salesperson,
    }
  }
  const slim: Row = { ...p }
  for (const f of STRIPPED) delete slim[f]
  return slim
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
  query?: string; status?: string; phase?: string; captain?: string;
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
  // Default to only in-flight operational projects (see isActiveOperational) so
  // "due this week", "open surveys for <captain>", etc. never surface Closed,
  // On-Hold, Delivered, or pre-sale Scoping work. If the caller explicitly asks
  // for a Closed/Hold status or the Scoping phase, honor that instead; a passed
  // active_only always wins.
  const asksInactive =
    args.status === 'Closed' || args.status === 'Hold' || args.phase === 'Scoping'
  const wantsActive = args.active_only ?? !asksInactive
  if (wantsActive) q = q.eq('status', 'Open').eq('phase', 'Active').neq('board_column', 'Delivery')
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`project_name.ilike.%${s}%,client.ilike.%${s}%,project_code.ilike.%${s}%`)
  }
  if (args.status) q = q.eq('status', args.status as never)
  if (args.phase) q = q.eq('phase', args.phase as never)
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
    supabase.from('project_blasts').select('delivered, bid, blast_cost, note, created_at').eq('project_id', id).order('created_at', { ascending: false }),
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
    before_fielding_required: beforeFieldingRequired(client, p.compliance_override as boolean | null),
    before_fielding_met: beforeFieldingMet(submissions),
    after_fielding_required: afterFieldingRequired(client, p.compliance_override as boolean | null),
    after_fielding_met: afterFieldingMet(submissions),
  }

  return {
    ...slimProject(p),
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
export async function getProjectHistory(projectRef: string) {
  const resolved = await resolveProject(projectRef)
  if (resolved === null) return { error: `No project found matching "${projectRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple projects match — specify the project code.', candidates: resolved.ambiguous }
  }
  const p = resolved as Row
  const seriesId = (p.rerun_series_id as string | null) ?? (p.id as string)

  const supabase = createAdminClient()
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, status, phase, board_column, rerun_number, launch_date, deliver_date, due_date, n_target, n_collected, n_actual, budget, actual_spend')
    .is('deleted_at', null)
    .or(`id.eq.${seriesId},rerun_series_id.eq.${seriesId}`)
    .order('rerun_number', { ascending: true })
  if (error) throw error

  const waves = data ?? []
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
export async function getClientHistory(clientRef: string) {
  const resolved = await resolveClient(clientRef)
  if (resolved === null) return { error: `No client found matching "${clientRef}".` }
  if ('ambiguous' in resolved) {
    return { note: 'Multiple clients match — specify the client code.', candidates: resolved.ambiguous }
  }
  const client = resolved as Row
  const clientId = client.id as string

  const supabase = createAdminClient()

  const { data: allRows, error } = await supabase.from('survey_projects')
    .select(
      'id, project_code, project_name, project_type, status, phase, ' +
      'n_target, n_collected, n_actual, budget, actual_spend, launch_date, deliver_date, due_date, ' +
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
    return {
      project_code: r.project_code, project_name: r.project_name, project_type: r.project_type,
      status: r.status, phase: r.phase,
      n_target: r.n_target, n_collected: r.n_collected, n_actual: r.n_actual,
      budget: r.budget, actual_spend: r.actual_spend,
      launch_date: r.launch_date, deliver_date: r.deliver_date, due_date: r.due_date,
      captain: cap ? { initials: cap.initials ?? null, name: cap.name ?? null } : null,
      salesperson: r.salesperson,
      linked_documents: parseLinkedDocuments(r.linked_documents),
      deliverables_count: deliverableCounts.get(r.id as string) ?? 0,
    }
  })

  // ---- patterns (over the full history) ----
  const nTargets = rows.map(r => r.n_target).filter((n): n is number => typeof n === 'number')
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
      typical_n_target: median(nTargets),
      common_project_type: mode(types),
      avg_fielding_days: avgFieldingDaysRaw === null ? null : Math.round(avgFieldingDaysRaw),
      cadence_per_year: cadencePerYear,
      recurring_contacts: recurringContacts,
    },
    stated_preferences: statedPreferences,
  }
}

/** Port of the daily-digest logic (overdue / due<=3d / fielding-behind-pace) plus counts.
 *  mine:true scopes everything (overdue/due-soon/fielding-behind AND the counts) to the
 *  caller's own captained projects, resolved via getMe(userId). */
export async function pipelineSummary(args: { mine?: boolean; userId?: string } = {}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, client, board_column, due_date, n_target, n_collected, status, phase, captain:team_members(name, initials)')
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
    myInitials = me?.initials ?? null
  }
  if (myInitials) {
    const ci = myInitials.toLowerCase()
    rows = rows.filter(r => ((r.captain as { initials?: string } | null)?.initials ?? '').toLowerCase() === ci)
  }

  const today = new Date().toISOString().split('T')[0]
  const soon = new Date(Date.now() + 3 * 86400_000).toISOString().split('T')[0]

  const overdue = rows.filter(p => p.due_date && (p.due_date as string) <= today)
  const dueSoon = rows.filter(p => p.due_date && (p.due_date as string) > today && (p.due_date as string) <= soon)
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
    .neq('status', 'Closed')

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
    overdue, due_soon: dueSoon, fielding_behind: fieldingBehind,
    counts: { by_board_column: countsByColumn, by_status: countsByStatus, by_phase: countsByPhase },
  }
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

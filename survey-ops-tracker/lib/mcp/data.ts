import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { totalBidDollars } from '@/lib/utils/blast'
import { beforeFieldingRequired, afterFieldingRequired, beforeFieldingMet, afterFieldingMet } from '@/lib/utils/compliance'

/** Tool args are user-controlled: strip PostgREST-reserved chars, escape LIKE wildcards, cap length. */
export function sanitizeQuery(q: string): string {
  return q.replace(/[,().]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/([%_\\])/g, '\\$1').slice(0, 100)
}

/** [owner initials][client+project abbrev][YYYYMMDD][region?] — anchor on the 8-digit date. */
export function decodeSurveyId(
  id: string, teamInitials: string[]
): { owner: string | null; abbreviation: string; date: string; region: string | null } | null {
  const m = id.toUpperCase().match(/^([A-Z]+)(\d{8})([A-Z]*)$/)
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

export async function searchProjects(args: {
  query?: string; status?: string; phase?: string; captain?: string;
  due_before?: string; due_after?: string; limit?: number
}) {
  const supabase = createAdminClient()
  let q = supabase.from('survey_projects')
    .select('project_code, project_name, client, status, phase, scoping_stage, board_column, due_date, n_collected, n_target, salesperson, captain:team_members(name, initials)')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (args.query) {
    const s = sanitizeQuery(args.query)
    q = q.or(`project_name.ilike.%${s}%,client.ilike.%${s}%,project_code.ilike.%${s}%`)
  }
  if (args.status) q = q.eq('status', args.status as never)
  if (args.phase) q = q.eq('phase', args.phase as never)
  if (args.due_before) q = q.lte('due_date', args.due_before)
  if (args.due_after) q = q.gte('due_date', args.due_after)
  const { data, error } = await q.order('due_date', { ascending: true, nullsFirst: false })
    .limit(Math.min(args.limit ?? 20, 50))
  if (error) throw error
  let rows = (data ?? []) as unknown as Row[]
  if (args.captain) {
    const c = args.captain.toLowerCase()
    rows = rows.filter(r => {
      const cap = r.captain as { name?: string; initials?: string } | null
      return cap?.name?.toLowerCase().includes(c) || cap?.initials?.toLowerCase() === c
    })
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
    .ilike('project_code', ref.trim())
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
    supabase.from('project_steps').select('text, done, completed_at, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('project_activity').select('type, direction, sender, subject, snippet, occurred_at').eq('project_id', id).order('occurred_at', { ascending: false }).limit(10),
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

type ClientCandidate = { code: string | null; name: string }

/** Resolve a client ref (Cl-code exact, then name ilike). 0 -> null, 1 -> row, >1 -> ambiguous candidates. */
export async function resolveClient(
  ref: string
): Promise<Row | { ambiguous: ClientCandidate[] } | null> {
  const supabase = createAdminClient()
  const byCode = await supabase.from('clients')
    .select('*')
    .is('deleted_at', null)
    .ilike('code', ref.trim())
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

/** Port of the daily-digest logic (overdue / due<=3d / fielding-behind-pace) plus counts. */
export async function pipelineSummary() {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('survey_projects')
    .select('project_code, project_name, client, board_column, due_date, n_target, n_collected, status, phase, captain:team_members(name, initials)')
    .eq('status', 'Open')
    .eq('phase', 'Active')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
  if (error) throw error

  const rows = (data ?? []) as unknown as Row[]
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
    .select('board_column, status, phase')
    .is('deleted_at', null)
    .or('project_type.is.null,project_type.neq.Internal')
    .neq('status', 'Closed')

  const countsByColumn: Record<string, number> = {}
  const countsByStatus: Record<string, number> = {}
  const countsByPhase: Record<string, number> = {}
  for (const r of allOpen ?? []) {
    countsByColumn[r.board_column] = (countsByColumn[r.board_column] ?? 0) + 1
    countsByStatus[r.status] = (countsByStatus[r.status] ?? 0) + 1
    countsByPhase[r.phase] = (countsByPhase[r.phase] ?? 0) + 1
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
      .select('status').eq('client_id', c.id as string).is('deleted_at', null)
    const open = (projects ?? []).filter(p => p.status !== 'Closed').length
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

export async function listActivity(projectId: string | null, limit = 20) {
  const supabase = createAdminClient()
  let q = supabase.from('project_activity')
    .select('project_id, type, direction, sender, subject, snippet, occurred_at, survey_projects(project_code, project_name)')
    .order('occurred_at', { ascending: false })
    .limit(Math.min(limit, 50))
  if (projectId) q = q.eq('project_id', projectId)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((a: Record<string, unknown>) => {
    const proj = a.survey_projects as { project_code: string | null; project_name: string } | null
    return {
      project_code: proj?.project_code ?? null,
      project_name: proj?.project_name ?? null,
      type: a.type, direction: a.direction, sender: a.sender,
      subject: a.subject, snippet: a.snippet, occurred_at: a.occurred_at,
    }
  })
}

export async function getTeamInitials(): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('team_members').select('initials')
  if (error) throw error
  return (data ?? []).map(t => t.initials)
}

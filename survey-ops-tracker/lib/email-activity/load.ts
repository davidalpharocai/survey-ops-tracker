import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import { tokenizeSurveyIds } from './parse'

/** All fields the email matcher needs off a project. Loaded for EVERY non-deleted
 *  project (any status/phase/board_column) so an explicit PR-code / validated
 *  survey-ID can match Closed/Delivered projects too — the operational gate is
 *  applied per-candidate in the matcher, never as a pre-filter here. */
export type EmailProjectRec = {
  id: string
  project_code: string | null
  client_id: string | null
  project_name: string
  status: string
  phase: string
  board_column: string
  rerun_series_id: string | null
  rerun_number: number
  delivered_at: string | null
  survey_ids_from_sheet: string | null
}

/** A relevance signal: an email address tied to a client (and maybe a project). */
export type EmailContactRec = { email: string; client_id: string | null; project_id: string | null }

export type EmailMatchData = {
  projects: EmailProjectRec[]
  contacts: EmailContactRec[]
  /** All non-deleted clients (id + name) — for the content-scan tier that looks
   *  for a client name/contact/domain anywhere in the email text. */
  clients: { id: string; name: string }[]
  /** validated survey-ID (upper-cased) → owning project id(s). >1 = ambiguous. */
  surveyIdMap: Map<string, string[]>
}

const normEmail = (e: string | null | undefined): string => (e ?? '').toLowerCase().trim()

/**
 * Load the data the email matcher runs against:
 *  - `projects`: ALL non-deleted projects, every state.
 *  - `contacts`: union of client_contacts (archived=false, non-null email) and
 *    project_recipients. `client_contacts` is authoritative on an email conflict
 *    (it is what the Gmail filters are built from, so it defines "client-tied").
 *  - `surveyIdMap`: validated surveyId → projectId[] from `survey_ids_from_sheet`.
 */
export async function loadEmailMatchData(
  admin: ReturnType<typeof createAdminClient>
): Promise<EmailMatchData> {
  const [projectsRes, contactsRes, recipsRes, clientsRes] = await Promise.all([
    admin
      .from('survey_projects')
      .select(
        'id, project_code, client_id, project_name, status, phase, board_column, rerun_series_id, rerun_number, delivered_at, survey_ids_from_sheet'
      )
      .is('deleted_at', null),
    admin
      .from('client_contacts')
      .select('email, client_id')
      .eq('archived', false)
      .not('email', 'is', null),
    admin.from('project_recipients').select('email, project_id'),
    admin.from('clients').select('id, name').is('deleted_at', null),
  ])

  const projects = (projectsRes.data ?? []) as unknown as EmailProjectRec[]
  const projClientById = new Map(projects.map((p) => [p.id, p.client_id]))

  // Build the roster. Accumulate EVERY client an address is tied to (across
  // project_recipients + client_contacts) and emit one record per (email, client),
  // so an address shared by two clients yields two records — the matcher then sees
  // >1 client and routes to review instead of silently collapsing to one.
  const byEmail = new Map<string, Map<string, string | null>>() // email → clientId → project_id?
  const tie = (email: string, clientId: string | null, projectId: string | null) => {
    if (!email || !clientId) return // no client tie = no relevance signal
    const inner = byEmail.get(email) ?? new Map<string, string | null>()
    if (!inner.has(clientId) || (projectId && !inner.get(clientId))) inner.set(clientId, projectId)
    byEmail.set(email, inner)
  }
  for (const r of recipsRes.data ?? []) {
    tie(normEmail(r.email), projClientById.get(r.project_id) ?? null, r.project_id)
  }
  for (const c of contactsRes.data ?? []) {
    tie(normEmail(c.email), c.client_id, null)
  }
  const contacts: EmailContactRec[] = []
  for (const [email, inner] of byEmail) {
    for (const [client_id, project_id] of inner) contacts.push({ email, client_id, project_id })
  }

  // Validate survey-ID tokens before they become auto-log keys — this column is
  // human-typed free text, so drop placeholders (a real ID is >=6 chars with a digit).
  const isPlausibleSurveyId = (t: string) => t.length >= 6 && /\d/.test(t)
  const surveyIdMap = new Map<string, string[]>()
  for (const p of projects) {
    for (const id of tokenizeSurveyIds(p.survey_ids_from_sheet)) {
      if (!isPlausibleSurveyId(id)) continue
      const owners = surveyIdMap.get(id) ?? []
      if (!owners.includes(p.id)) owners.push(p.id)
      surveyIdMap.set(id, owners)
    }
  }

  const clients = (clientsRes.data ?? []) as { id: string; name: string }[]

  return { projects, contacts, clients, surveyIdMap }
}

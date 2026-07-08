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
  const [projectsRes, contactsRes, recipsRes] = await Promise.all([
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
  ])

  const projects = (projectsRes.data ?? []) as unknown as EmailProjectRec[]
  const projClientById = new Map(projects.map((p) => [p.id, p.client_id]))

  // Build the roster; project_recipients first, then let client_contacts win on conflict.
  const byEmail = new Map<string, EmailContactRec>()
  for (const r of recipsRes.data ?? []) {
    const email = normEmail(r.email)
    if (!email) continue
    byEmail.set(email, {
      email,
      client_id: projClientById.get(r.project_id) ?? null,
      project_id: r.project_id,
    })
  }
  for (const c of contactsRes.data ?? []) {
    const email = normEmail(c.email)
    if (!email) continue
    // client_contacts is authoritative: it carries the client tie but no project hint.
    byEmail.set(email, { email, client_id: c.client_id, project_id: null })
  }

  const surveyIdMap = new Map<string, string[]>()
  for (const p of projects) {
    for (const id of tokenizeSurveyIds(p.survey_ids_from_sheet)) {
      const owners = surveyIdMap.get(id) ?? []
      if (!owners.includes(p.id)) owners.push(p.id)
      surveyIdMap.set(id, owners)
    }
  }

  return { projects, contacts: [...byEmail.values()], surveyIdMap }
}

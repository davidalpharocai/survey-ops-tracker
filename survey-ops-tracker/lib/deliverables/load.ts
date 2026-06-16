import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ClientRec, ContactRec, ProjectRec } from './types'

const SHARED_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'aol.com', 'me.com'])

export function buildDomainMap(contacts: ContactRec[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of contacts) {
    if (!c.client_id) continue
    const dom = (c.email.split('@')[1] ?? '').toLowerCase().trim()
    if (!dom || SHARED_DOMAINS.has(dom) || map[dom]) continue
    map[dom] = c.client_id
  }
  return map
}

export async function loadMatchData(admin: ReturnType<typeof createAdminClient>): Promise<{
  clients: ClientRec[]; projects: ProjectRec[]; contacts: ContactRec[]; domainMap: Record<string, string>
}> {
  const [{ data: clients }, { data: projects }, { data: recips }] = await Promise.all([
    admin.from('clients').select('id, name, code'),
    admin.from('survey_projects').select('id, client_id, project_code, project_name').is('deleted_at', null).not('project_code', 'is', null),
    admin.from('project_recipients').select('email, project_id'),
  ])

  // attach client_id to each recipient via its project
  const projById = new Map((projects ?? []).map((p) => [p.id, p.client_id]))
  const contacts: ContactRec[] = (recips ?? []).map((r) => ({
    email: r.email,
    project_id: r.project_id,
    client_id: projById.get(r.project_id) ?? null,
  }))

  return {
    clients: (clients ?? []) as ClientRec[],
    projects: (projects ?? []) as ProjectRec[],
    contacts,
    domainMap: buildDomainMap(contacts),
  }
}

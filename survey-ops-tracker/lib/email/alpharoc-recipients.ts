import 'server-only'
import type { createAdminClient } from '@/lib/supabase/admin'

// Who gets "approved/rejected" notifications. Defaults: the analyst who
// submitted, the project captain (if different), and ops (Shanu), plus any
// explicitly configured alpharoc recipients.
// ALPHAROC_NOTIFY_OVERRIDE replaces the whole list — set to a single inbox
// during pre-beta testing; remove the env var to enable the real defaults.
const DEFAULT_OPS_NOTIFY = ['shanu@alpharoc.ai']

export async function getAlphaRocNotifyList(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  submittedBy: string | null
): Promise<string[]> {
  const override = process.env.ALPHAROC_NOTIFY_OVERRIDE
  if (override) {
    return [...new Set(override.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]
  }

  const emails = new Set<string>(DEFAULT_OPS_NOTIFY)

  const { data: explicit } = await admin
    .from('project_recipients')
    .select('email')
    .eq('project_id', projectId)
    .eq('role', 'alpharoc')
  for (const r of explicit ?? []) emails.add(r.email.toLowerCase())

  if (submittedBy) {
    const { data: submitter } = await admin
      .from('profiles').select('email').eq('id', submittedBy).maybeSingle()
    if (submitter) emails.add(submitter.email.toLowerCase())
  }

  const { data: project } = await admin
    .from('survey_projects').select('captain_id').eq('id', projectId).maybeSingle()
  if (project?.captain_id) {
    const { data: captain } = await admin
      .from('team_members').select('email').eq('id', project.captain_id).maybeSingle()
    if (captain) emails.add(captain.email.toLowerCase())
  }

  return [...emails]
}

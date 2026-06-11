import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractEdwinSurveyId, findEdwinUrl } from '@/lib/utils/edwin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Runs daily via Vercel Cron (see vercel.json). Pulls each open project's
// survey ID straight from its Edwin link's source= param — no sheet needed.
// Rules:
//   - Survey IDs blank -> fill from Edwin
//   - Edwin ID already among the Survey IDs -> all good, clear any flag
//   - Mismatch -> set a discrepancy flag for the team to review (never overwrite)
function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  // manual trigger with the webhook secret also allowed
  const secret = process.env.WEBHOOK_SECRET
  return !!secret && req.headers.get('x-webhook-secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('id, project_name, linked_documents, survey_tool_id, survey_id_discrepancy')
    .eq('status', 'Open')

  if (error) return new Response('Database error', { status: 500 })

  let filled = 0
  let flagged = 0
  let cleared = 0
  const details: string[] = []

  for (const p of projects ?? []) {
    const edwinUrl = findEdwinUrl(p.linked_documents)
    if (!edwinUrl) continue
    const edwinId = extractEdwinSurveyId(edwinUrl)
    if (!edwinId) continue

    const current = (p.survey_tool_id ?? '').trim()
    const ids = current.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

    if (!current) {
      await supabase
        .from('survey_projects')
        .update({
          survey_tool_id: edwinId,
          survey_id_discrepancy: null,
          survey_ids_synced_at: new Date().toISOString(),
        })
        .eq('id', p.id)
      filled++
      details.push(`filled ${p.project_name}: ${edwinId}`)
    } else if (ids.includes(edwinId.toLowerCase())) {
      if (p.survey_id_discrepancy) {
        await supabase
          .from('survey_projects')
          .update({ survey_id_discrepancy: null })
          .eq('id', p.id)
        cleared++
      }
    } else {
      const flag = `Edwin link reports "${edwinId}" but Survey IDs says "${current}" — review which is right.`
      if (p.survey_id_discrepancy !== flag) {
        await supabase
          .from('survey_projects')
          .update({ survey_id_discrepancy: flag })
          .eq('id', p.id)
        flagged++
        details.push(`flagged ${p.project_name}`)
      }
    }
  }

  return Response.json({ checked: projects?.length ?? 0, filled, flagged, cleared, details })
}

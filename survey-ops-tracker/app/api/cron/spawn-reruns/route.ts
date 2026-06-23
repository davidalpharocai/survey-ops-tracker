import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { nextRerunName } from '@/lib/utils/rerun'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Daily (see vercel.json). Spawns the next wave of each longitudinal survey
// whose rerun_date is within a week and that hasn't spawned yet. The copy lands
// in Submitted for the captain to review; setup carried over, run-data reset,
// numbered + linked as a series. One-shot: the copy's rerun_date is left blank
// for a human to set the next wave.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

const LEAD_DAYS = 7

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const horizon = new Date(Date.now() + LEAD_DAYS * 86400_000).toISOString().split('T')[0]
  const today = new Date().toISOString().split('T')[0]

  const { data: due, error } = await supabase
    .from('survey_projects')
    .select(
      'id, project_name, client, captain_id, co_captain_ids, salesperson, n_target, audience_size, linked_documents, voter_survey_qa, citation_language_needed, row_level_data, compliance_override, rerun_number, rerun_series_id'
    )
    .eq('longitudinal', true)
    .not('rerun_date', 'is', null)
    .lte('rerun_date', horizon)
    .is('rerun_spawned_at', null)
    .is('deleted_at', null)
    .neq('status', 'Closed')

  if (error) {
    await logSystemEvent({ source: 'spawn-reruns', status: 'error', detail: `Database error: ${error.message}` })
    return new Response('Database error', { status: 500 })
  }

  const spawned: string[] = []
  const errors: string[] = []

  for (const p of due ?? []) {
    const nextNum = (p.rerun_number ?? 1) + 1
    const name = nextRerunName(p.project_name, nextNum)
    const copy = {
      project_name: name,
      client: p.client,
      project_type: 'Rerun' as const,
      phase: 'Active' as const,
      status: 'Open' as const,
      board_column: 'Submitted' as const,
      captain_id: p.captain_id,
      co_captain_ids: p.co_captain_ids,
      salesperson: p.salesperson,
      n_target: p.n_target,
      n_collected: 0,
      n_actual: null,
      audience_size: p.audience_size,
      longitudinal: true,
      voter_survey_qa: p.voter_survey_qa,
      citation_language_needed: p.citation_language_needed,
      row_level_data: p.row_level_data,
      compliance_override: p.compliance_override,
      linked_documents: p.linked_documents,
      stage_doc_programming: false,
      stage_survey_programming: false,
      stage_edwin_qa: false,
      stage_fielding: false,
      stage_data_qa: false,
      stage_delivery: false,
      submitted_date: today,
      rerun_number: nextNum,
      rerun_series_id: p.rerun_series_id ?? p.id,
    }
    const { error: insErr } = await supabase.from('survey_projects').insert(copy)
    if (insErr) {
      errors.push(`${p.project_name}: ${insErr.message}`)
      continue
    }
    // Stamp the source so it never re-spawns this wave.
    const { error: stampErr } = await supabase
      .from('survey_projects')
      .update({ rerun_spawned_at: new Date().toISOString() })
      .eq('id', p.id)
    if (stampErr) errors.push(`stamp ${p.project_name}: ${stampErr.message}`)
    spawned.push(name)
  }

  await logSystemEvent({
    source: 'spawn-reruns',
    status: errors.length ? 'partial' : 'ok',
    detail: spawned.length ? `Spawned ${spawned.length} rerun(s): ${spawned.join(', ')}` : 'No reruns due.',
    meta: { spawned, errors },
  })

  return Response.json(
    { checked: due?.length ?? 0, spawned, errors },
    { status: errors.length ? 207 : 200 }
  )
}

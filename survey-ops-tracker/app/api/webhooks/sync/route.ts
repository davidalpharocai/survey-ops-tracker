import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveSurveyIds } from '@/lib/utils/surveyIdsSync'
import { safeEqual } from '@/lib/utils/secureCompare'
import type { Database } from '@/lib/supabase/types'

export const dynamic = 'force-dynamic'

// Shared-secret auth for external workflows (Make.com etc.) — constant-time compare
function authorized(req: NextRequest): boolean {
  const header =
    req.headers.get('x-webhook-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return safeEqual(header, process.env.WEBHOOK_SECRET)
}

// GET: list open projects with the fields the sync workflow needs
// (project id, linked documents to find the Google Sheet, current sync state)
export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('survey_projects')
    .select(
      'id, project_name, status, phase, linked_documents, survey_tool_id, survey_ids_from_sheet, n_collected, n_target'
    )
    .eq('status', 'Open')
    .is('deleted_at', null)

  if (error) return new Response('Database error', { status: 500 })
  return Response.json({ projects: data })
}

// POST: update a project from the sync workflow.
// Body: { project_id, survey_ids_from_sheet?, n_collected? }
// Survey IDs follow the blank-or-sheet-changed rule; manual edits survive
// as long as the sheet itself hasn't changed.
export async function POST(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  let body: {
    project_id?: string
    survey_ids_from_sheet?: string | null
    n_collected?: number
  }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }
  if (!body.project_id) return new Response('project_id required', { status: 400 })

  const supabase = createAdminClient()
  const { data: project, error: fetchError } = await supabase
    .from('survey_projects')
    .select('id, survey_tool_id, survey_ids_from_sheet')
    .eq('id', body.project_id)
    .single()

  if (fetchError || !project) return new Response('Project not found', { status: 404 })

  const updates: Database['public']['Tables']['survey_projects']['Update'] = {}
  const result: Record<string, unknown> = { project_id: project.id }

  if (body.survey_ids_from_sheet !== undefined) {
    const { next, changed } = resolveSurveyIds(
      project.survey_tool_id,
      project.survey_ids_from_sheet,
      body.survey_ids_from_sheet
    )
    if (changed) updates.survey_tool_id = next
    updates.survey_ids_from_sheet = body.survey_ids_from_sheet
    updates.survey_ids_synced_at = new Date().toISOString()
    result.survey_ids_updated = changed
    result.survey_tool_id = next
  }

  if (typeof body.n_collected === 'number' && body.n_collected >= 0) {
    updates.n_collected = Math.floor(body.n_collected)
    updates.n_last_synced = new Date().toISOString()
    result.n_collected_updated = true
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ ...result, message: 'Nothing to update' })
  }

  const { error: updateError } = await supabase
    .from('survey_projects')
    .update(updates)
    .eq('id', project.id)

  if (updateError) return new Response('Update failed', { status: 500 })
  return Response.json(result)
}

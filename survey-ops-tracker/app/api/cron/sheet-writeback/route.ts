import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { mappedCells, fullRow, rowHash, updateData, headerGuardOk, type SurveyProject } from '@/lib/sheets/surveysMap'
import { readHeader, readPrCodeRows, appendRow, updateCells } from '@/lib/sheets/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SOCC -> Surveys write-back. Mirrors client (PS/B2B) projects down into the
// legacy sheet's Surveys tab: appends new ones, updates changed ones (SOCC is the
// source of truth). Change detection is a content hash of the mapped cells, so it
// doesn't depend on updated_at. OFF by default (dry-run) — only writes when
// SHEET_WRITEBACK_ENABLED is true/1/yes. Always returns 200 so Vercel Cron doesn't
// retry. A header-guard aborts the run if the sheet's columns drift.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function live(): boolean {
  const v = (process.env.SHEET_WRITEBACK_ENABLED ?? '').trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })
  const dry = !live()
  const supabase = createAdminClient()

  // Candidates: client projects (PS/B2B), not deleted. Excludes Internal + Rerun.
  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('*')
    .in('project_type', ['PS', 'B2B'])
    .is('deleted_at', null)
  if (error) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Query failed: ${error.message}` })
    return Response.json({ mode: dry ? 'dry-run' : 'live', appended: 0, updated: 0, skipped: 0, failed: 0 })
  }

  // team_members -> initials, to resolve captain + co-captains (col S is comma-joined).
  const { data: members } = await supabase.from('team_members').select('id, initials')
  const initialsById = new Map((members ?? []).map((m) => [m.id, m.initials]))
  const captainCell = (p: SurveyProject) =>
    [p.captain_id, ...(p.co_captain_ids ?? [])]
      .map((id) => (id ? initialsById.get(id) : null))
      .filter(Boolean)
      .join(', ')

  // Header guard — abort the whole run on drift (write nothing).
  let header: string[]
  try {
    header = await readHeader()
  } catch (e) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Header read failed: ${(e as Error).message}`.slice(0, 500) })
    return Response.json({ mode: dry ? 'dry-run' : 'live', aborted: 'header-read-failed' })
  }
  if (!headerGuardOk(header)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: 'Surveys header drifted from the expected mapping — aborting, wrote nothing.' })
    return Response.json({ mode: dry ? 'dry-run' : 'live', aborted: 'header-guard' })
  }

  const prRows = await readPrCodeRows() // PR code -> row number (for updates)
  let appended = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const p of (projects ?? []) as SurveyProject[]) {
    try {
      const cells = mappedCells(p, captainCell(p))
      const hash = rowHash(cells)
      if (p.sheet_synced_hash === hash) {
        skipped++
        continue
      }

      const rowNum = p.project_code ? prRows.get(p.project_code) : undefined
      const isNew = !p.sheet_synced_hash

      if (dry) {
        const action = isNew || !rowNum ? 'APPEND' : `UPDATE row ${rowNum}`
        await logSystemEvent({
          source: 'sheet-writeback',
          status: 'ok',
          detail: `[dry-run] would ${action}: ${p.project_code ?? '(no code)'} ${p.client} / ${p.project_name}`,
        })
        isNew || !rowNum ? appended++ : updated++
        continue
      }

      if (isNew || !rowNum) {
        await appendRow(fullRow(cells))
        appended++
      } else {
        await updateCells(updateData(cells, rowNum))
        updated++
      }

      await supabase
        .from('survey_projects')
        .update({ sheet_synced_hash: hash, sheet_synced_at: new Date().toISOString() })
        .eq('id', p.id)
    } catch (e) {
      failed++
      await logSystemEvent({
        source: 'sheet-writeback',
        status: 'error',
        detail: `Write failed for ${p.project_code ?? p.id}: ${(e as Error).message}`.slice(0, 500),
      })
    }
  }

  const result = { mode: dry ? 'dry-run' : 'live', appended, updated, skipped, failed }
  if (!dry && failed === 0 && (appended || updated)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `Appended ${appended}, updated ${updated}.` })
  }
  return Response.json(result)
}

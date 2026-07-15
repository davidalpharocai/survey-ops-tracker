import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { mappedCells, fullRow, rowHash, updateData, headerGuardOk, type SurveyProject } from '@/lib/sheets/surveysMap'
import { readHeader, readPrCodeRows, appendRow, updateCells } from '@/lib/sheets/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// SOCC -> Surveys write-back. Mirrors client (PS/B2B) projects down into the
// legacy sheet's Surveys tab: appends projects with no row yet, updates existing
// rows (located by literal PR code) — SOCC is the source of truth. Change detection
// is a content hash of the mapped cells (independent of updated_at).
//
// SHEET_WRITEBACK_ENABLED is 3-state so the scheduled run is SILENT until go-live:
//   unset/off/false -> OFF: return immediately, touch nothing (no sheet reads).
//   dryrun/dry       -> log what it WOULD write, write nothing.
//   live/true/1/yes  -> write.
// Always returns 200 so Vercel Cron never retries (a retry could duplicate).
// A header-guard aborts on column drift; a preflight aborts live if migration 053
// (the sync-state columns) isn't applied.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function mode(): 'off' | 'dryrun' | 'live' {
  const v = (process.env.SHEET_WRITEBACK_ENABLED ?? '').trim().toLowerCase()
  if (v === 'live' || v === 'true' || v === '1' || v === 'yes') return 'live'
  if (v === 'dryrun' || v === 'dry' || v === 'validate') return 'dryrun'
  return 'off'
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const m = mode()
  if (m === 'off') return Response.json({ mode: 'off' })
  const dry = m === 'dryrun'
  const supabase = createAdminClient()

  // Live preflight: if migration 053 isn't applied the sync-state columns are
  // missing — abort rather than write rows we can't stamp (which would re-append).
  if (!dry) {
    const probe = await supabase.from('survey_projects').select('sheet_synced_hash').limit(1)
    if (probe.error) {
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Aborting live run: sync-state columns missing (migration 053 not applied?): ${probe.error.message}` })
      return Response.json({ mode: 'live', aborted: 'migration-053-missing' })
    }
  }

  // Candidates: client projects (PS/B2B), not deleted. Excludes Internal + Rerun.
  const { data: projects, error } = await supabase
    .from('survey_projects')
    .select('*')
    .in('project_type', ['PS', 'B2B'])
    .is('deleted_at', null)
  if (error) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Query failed: ${error.message}` })
    return Response.json({ mode: m, appended: 0, updated: 0, skipped: 0, failed: 0 })
  }

  // team_members -> initials, to resolve captain + co-captains (col S is comma-joined).
  const { data: members } = await supabase.from('team_members').select('id, initials')
  const initialsById = new Map((members ?? []).map((mm) => [mm.id, mm.initials]))
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
    return Response.json({ mode: m, aborted: 'header-read-failed' })
  }
  if (!headerGuardOk(header)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: 'Surveys header drifted from the expected mapping — aborting, wrote nothing.' })
    return Response.json({ mode: m, aborted: 'header-guard' })
  }

  // PR code -> row number, for locating existing rows (append vs update decision).
  let prRows: Map<string, number>
  try {
    prRows = await readPrCodeRows()
  } catch (e) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `PR-code read failed: ${(e as Error).message}`.slice(0, 500) })
    return Response.json({ mode: m, aborted: 'prcode-read-failed' })
  }

  let appended = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let stampErrors = 0

  for (const p of (projects ?? []) as SurveyProject[]) {
    try {
      // No PR code = can't be located in the sheet for update; skip loudly rather
      // than append an unlocatable row that would re-append on every later edit.
      if (!p.project_code) {
        failed++
        await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Skipping ${p.id} (${p.client}/${p.project_name}): no project_code — cannot locate/sync.` })
        continue
      }

      const cells = mappedCells(p, captainCell(p))
      const hash = rowHash(cells)
      if (p.sheet_synced_hash === hash) {
        skipped++
        continue
      }

      // Decide by ROW PRESENCE, not sync-state: migrated projects already have a
      // Surveys row (hash null but PR code present) — those must UPDATE, not append.
      const rowNum = prRows.get(p.project_code)
      const isNew = !p.sheet_synced_hash

      if (dry) {
        const action = rowNum ? `UPDATE row ${rowNum}` : isNew ? 'APPEND' : 'LOST-ROW (would flag)'
        await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `[dry-run] would ${action}: ${p.project_code} ${p.client} / ${p.project_name}` })
        if (rowNum) updated++
        else if (isNew) appended++
        else failed++
        continue
      }

      if (rowNum) {
        await updateCells(updateData(cells, rowNum))
        updated++
      } else if (isNew) {
        await appendRow(fullRow(cells))
        appended++
      } else {
        // Synced before, but its row can no longer be located (PR cell edited/removed
        // in the sheet). Do NOT append a duplicate — flag for a human.
        failed++
        await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Lost Surveys row for ${p.project_code} — was synced but PR code not found; not re-appending.` })
        continue
      }

      // Stamp sync-state. If this fails the SHEET write already happened; the next
      // run will locate the row by PR code and UPDATE (idempotent) — no duplicate —
      // so log it for visibility but don't double-count as a write failure.
      const { error: stampErr } = await supabase
        .from('survey_projects')
        .update({ sheet_synced_hash: hash, sheet_synced_at: new Date().toISOString() })
        .eq('id', p.id)
      if (stampErr) {
        stampErrors++
        await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Wrote sheet for ${p.project_code} but failed to stamp sync-state: ${stampErr.message}`.slice(0, 500) })
      }
    } catch (e) {
      failed++
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Write failed for ${p.project_code ?? p.id}: ${(e as Error).message}`.slice(0, 500) })
    }
  }

  const result = { mode: m, appended, updated, skipped, failed, stampErrors }
  if (!dry && failed === 0 && (appended || updated)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `Appended ${appended}, updated ${updated}${stampErrors ? ` (${stampErrors} stamp errors)` : ''}.` })
  }
  return Response.json(result)
}

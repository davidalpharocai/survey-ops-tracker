import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { safeEqual } from '@/lib/utils/secureCompare'
import { logSystemEvent } from '@/lib/server/observability'
import { mappedCells, rowHash, updateData, headerGuardOk, isWritebackEligible, WRITEBACK_MIN_DATE, type SurveyProject } from '@/lib/sheets/surveysMap'
import { readHeader, readPrCodeRows, updateCells, findScopingRow, insertRowsAbove, getSurveysSheetId, SCOPING_MARKER } from '@/lib/sheets/client'

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
// A manual trigger may add ?dry=1 (or ?preview=1) to FORCE a no-write PREVIEW
// regardless of the flag — this backs the on-demand "refresh when I say so" flow:
// preview the diff, get the OK, then trigger again without ?dry to write.
// NOTE (2026-07-22): there is deliberately NO scheduled cron entry for this route
// in vercel.json — it runs ONLY on a manual authorized GET (on-demand only, per
// David). To resume automatic daily sync, re-add it to vercel.json's crons.
// Always returns 200 so Vercel Cron never retries (a retry could duplicate).
// A header-guard aborts on column drift; a preflight aborts live if migration 053
// (the sync-state columns) isn't applied.
function authorized(req: NextRequest): boolean {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (safeEqual(bearer, process.env.CRON_SECRET)) return true
  return safeEqual(req.headers.get('x-webhook-secret'), process.env.WEBHOOK_SECRET)
}

function envMode(): 'off' | 'dryrun' | 'live' {
  const v = (process.env.SHEET_WRITEBACK_ENABLED ?? '').trim().toLowerCase()
  if (v === 'live' || v === 'true' || v === '1' || v === 'yes') return 'live'
  if (v === 'dryrun' || v === 'dry' || v === 'validate') return 'dryrun'
  return 'off'
}

// Effective mode. A manual ?dry=1 / ?preview=1 forces a read-only preview so an
// on-demand refresh can always be inspected before it writes; a preview can never
// escalate to a write, only the reverse (a plain trigger uses the env flag).
function mode(req: NextRequest): 'off' | 'dryrun' | 'live' {
  const qp = new URL(req.url).searchParams
  const forceDry = ['1', 'true', 'yes'].includes((qp.get('dry') ?? qp.get('preview') ?? '').toLowerCase())
  if (forceDry) return 'dryrun'
  return envMode()
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 })

  const m = mode(req)
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

  // LEGACY GUARD (David's standing rule): never touch pre-WRITEBACK_MIN_DATE rows.
  // Those projects predate David and the sheet is their authoritative history —
  // overwriting them with SOCC's values would degrade the record. Drop them here
  // so the whole sync (append + update) structurally cannot reach a legacy row.
  const all = (projects ?? []) as SurveyProject[]
  const eligible = all.filter((p) => isWritebackEligible(p))
  const skippedLegacy = all.length - eligible.length

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

  // Stamp SOCC sync-state after a successful sheet write. If it fails, the sheet
  // write already happened; the next run locates the row by PR code and UPDATEs
  // (idempotent) — so log for visibility but don't count it as a write failure.
  const stamp = async (p: SurveyProject, hash: string) => {
    const { error: stampErr } = await supabase
      .from('survey_projects')
      .update({ sheet_synced_hash: hash, sheet_synced_at: new Date().toISOString() })
      .eq('id', p.id)
    if (stampErr) {
      stampErrors++
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Wrote sheet for ${p.project_code} but failed to stamp sync-state: ${stampErr.message}`.slice(0, 500) })
    }
  }

  // New rows are deferred and inserted together (above the Scoping divider) AFTER
  // the update pass, so an insert never shifts a row an update still targets.
  const toInsert: { p: SurveyProject; cells: Record<number, string>; hash: string }[] = []

  for (const p of eligible) {
    try {
      // No PR code = can't be located in the sheet for update; skip loudly rather
      // than add an unlocatable row that would re-add on every later edit.
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
      // Surveys row (hash null but PR code present) — those must UPDATE, not add.
      const rowNum = prRows.get(p.project_code)
      const isNew = !p.sheet_synced_hash

      if (dry) {
        const action = rowNum ? `UPDATE row ${rowNum}` : isNew ? 'INSERT above Scoping' : 'LOST-ROW (would flag)'
        await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `[dry-run] would ${action}: ${p.project_code} ${p.client} / ${p.project_name}` })
        if (rowNum) updated++
        else if (isNew) appended++
        else failed++
        continue
      }

      if (rowNum) {
        await updateCells(updateData(cells, rowNum))
        await stamp(p, hash)
        updated++
      } else if (isNew) {
        toInsert.push({ p, cells, hash }) // inserted after the loop, above Scoping
      } else {
        // Synced before, but its row can no longer be located (PR cell edited/removed
        // in the sheet). Do NOT add a duplicate — flag for a human.
        failed++
        await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Lost Surveys row for ${p.project_code} — was synced but PR code not found; not re-adding.` })
        continue
      }
    } catch (e) {
      failed++
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Write failed for ${p.project_code ?? p.id}: ${(e as Error).message}`.slice(0, 500) })
    }
  }

  // Add new rows by INSERTING them directly above the "SCOPING PHASE / ON HOLD"
  // divider — never a bottom append (which dumped rows far below the working area
  // and, when it couldn't match a PR code, created duplicates). If the divider is
  // missing, refuse to add rather than guess a location.
  if (!dry && toInsert.length > 0) {
    const scopingRow = await findScopingRow()
    if (scopingRow == null) {
      failed += toInsert.length
      await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Could not find the "${SCOPING_MARKER}" divider — did NOT add ${toInsert.length} new row(s): ${toInsert.map((t) => t.p.project_code).join(', ')}.` })
    } else {
      try {
        const sheetId = await getSurveysSheetId()
        await insertRowsAbove(sheetId, scopingRow, toInsert.length)
        for (let k = 0; k < toInsert.length; k++) {
          const t = toInsert[k]
          try {
            await updateCells(updateData(t.cells, scopingRow + k)) // freshly-inserted blank rows
            await stamp(t.p, t.hash)
            appended++
          } catch (e) {
            failed++
            await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Inserted a row for ${t.p.project_code} but failed to fill it: ${(e as Error).message}`.slice(0, 500) })
          }
        }
      } catch (e) {
        failed += toInsert.length
        await logSystemEvent({ source: 'sheet-writeback', status: 'error', detail: `Insert-above-Scoping failed for ${toInsert.length} row(s): ${(e as Error).message}`.slice(0, 500) })
      }
    }
  }

  const result = { mode: m, appended, updated, skipped, failed, stampErrors, skippedLegacy, minDate: WRITEBACK_MIN_DATE }
  if (dry) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `[dry-run] would append ${appended}, update ${updated}; ${skipped} unchanged, ${skippedLegacy} legacy (pre-${WRITEBACK_MIN_DATE}) skipped, ${failed} failed.` })
  } else if (failed === 0 && (appended || updated)) {
    await logSystemEvent({ source: 'sheet-writeback', status: 'ok', detail: `Appended ${appended}, updated ${updated} (${skippedLegacy} legacy skipped)${stampErrors ? `; ${stampErrors} stamp errors` : ''}.` })
  }
  return Response.json(result)
}

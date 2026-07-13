import 'server-only'
import { google } from 'googleapis'
import * as XLSX from 'xlsx'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/types'
import { parseRerunRows, headerLooksValid } from './parse'

// Server-side sync: mirror Sree's "Manual Rerun(sree)" tab into public.rerun_snapshot.
// Reuses the deliverables Drive OAuth creds (Drive scope includes files.export) —
// see scripts/export-survey-sheet.mjs. Same workbook as the rest of the app.
const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'

type Admin = SupabaseClient<Database>

/**
 * Replace the rerun_snapshot mirror with a fresh parse of the sheet, atomically.
 *
 * The delete-all + insert runs inside a single Postgres transaction (the
 * replace_rerun_snapshot RPC), serialized by an advisory lock — so readers never
 * observe an empty or duplicated mirror and overlapping syncs can't clobber each
 * other. Aborts (without touching the table) if the tab header looks wrong or the
 * sheet parses to zero rows.
 */
export async function syncReruns(admin: Admin): Promise<{ count: number }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN for rerun sync')
  }

  const oauth = new google.auth.OAuth2(clientId, clientSecret)
  oauth.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth: oauth })
  const res = await drive.files.export(
    { fileId: SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { responseType: 'arraybuffer' },
  )
  const buf = Buffer.from(res.data as ArrayBuffer)
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const tab = wb.SheetNames.find((nm) => /manual rerun/i.test(nm))
  if (!tab) throw new Error('"Manual Rerun" tab not found in the workbook')
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null }) as unknown[][]

  if (!headerLooksValid(rows[0] ?? [])) {
    throw new Error('Rerun tab header does not match expected columns — aborting so the mirror is not corrupted')
  }
  const parsed = parseRerunRows(rows, new Date())
  if (parsed.length === 0) {
    throw new Error('Parsed 0 rerun rows — aborting rather than wiping the existing mirror')
  }

  const { data, error } = await admin.rpc('replace_rerun_snapshot', { rows: parsed as unknown as Json })
  if (error) throw new Error(`rerun_snapshot replace failed: ${error.message}`)
  return { count: typeof data === 'number' ? data : parsed.length }
}

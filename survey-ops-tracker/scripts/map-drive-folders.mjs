// scripts/map-drive-folders.mjs
// One-time: list the Shared Drive's top-level folders, fuzzy-match to clients,
// emit scripts/drive-folder-mapping.csv for David to confirm. Does NOT write
// drive_folder_id automatically — review the CSV, then re-run with --apply.
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { writeFileSync, readFileSync, existsSync } from 'fs'

const SHARED_DRIVE_ID = process.env.DELIVERABLES_SHARED_DRIVE_ID
const apply = process.argv.includes('--apply')

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
function makeAuth() {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (refreshToken) {
    const o = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET)
    o.setCredentials({ refresh_token: refreshToken })
    return o
  }
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
  })
}
const auth = makeAuth()
const drive = google.drive({ version: 'v3', auth })

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

async function main() {
  const { data: clients } = await admin.from('clients').select('id, name, code')
  const res = await drive.files.list({
    q: `'${SHARED_DRIVE_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true,
  })
  const folders = res.data.files ?? []

  if (apply && existsSync('scripts/drive-folder-mapping.csv')) {
    const rows = readFileSync('scripts/drive-folder-mapping.csv', 'utf8').split('\n').slice(1).filter(Boolean)
    let n = 0
    for (const row of rows) {
      // Machine columns (client_id, folder_id) come first and are comma-free,
      // so positional split is safe even when the trailing name columns contain commas.
      const [clientId, folderId] = row.split(',')
      if (clientId && folderId && folderId.trim()) { await admin.from('clients').update({ drive_folder_id: folderId.trim() }).eq('id', clientId.trim()); n++ }
    }
    console.log(`Applied ${n} mappings.`)
    return
  }

  // Column order: machine fields first (comma-free), human-readable names last
  // (JSON-quoted, may contain commas) so --apply can split positionally safely.
  const lines = ['client_id,folder_id,confidence,client_name,folder_name']
  for (const c of clients ?? []) {
    const exact = folders.find((f) => norm(f.name) === norm(c.name))
    const partial = exact ?? folders.find((f) => norm(f.name).includes(norm(c.name)) || norm(c.name).includes(norm(f.name)))
    const conf = exact ? 'exact' : partial ? 'partial' : 'none'
    lines.push(`${c.id},${partial?.id ?? ''},${conf},${JSON.stringify(c.name)},${JSON.stringify(partial?.name ?? '')}`)
  }
  writeFileSync('scripts/drive-folder-mapping.csv', lines.join('\n'))
  console.log(`Wrote scripts/drive-folder-mapping.csv (${(clients ?? []).length} clients). Review it, fill the folder_id for any 'partial'/'none' rows, then run with --apply.`)
}
main().catch((e) => { console.error(e); process.exit(1) })

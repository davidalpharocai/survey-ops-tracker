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
const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'))
const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/drive'] })
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
      const [clientId, , folderId] = row.split(',')
      if (clientId && folderId) { await admin.from('clients').update({ drive_folder_id: folderId.trim() }).eq('id', clientId.trim()); n++ }
    }
    console.log(`Applied ${n} mappings.`)
    return
  }

  const lines = ['client_id,client_name,folder_id,folder_name,confidence']
  for (const c of clients ?? []) {
    const exact = folders.find((f) => norm(f.name) === norm(c.name))
    const partial = exact ?? folders.find((f) => norm(f.name).includes(norm(c.name)) || norm(c.name).includes(norm(f.name)))
    const conf = exact ? 'exact' : partial ? 'partial' : 'none'
    lines.push(`${c.id},${JSON.stringify(c.name)},${partial?.id ?? ''},${JSON.stringify(partial?.name ?? '')},${conf}`)
  }
  writeFileSync('scripts/drive-folder-mapping.csv', lines.join('\n'))
  console.log(`Wrote scripts/drive-folder-mapping.csv (${(clients ?? []).length} clients). Review it, fix any 'partial'/'none' rows, then run with --apply.`)
}
main().catch((e) => { console.error(e); process.exit(1) })

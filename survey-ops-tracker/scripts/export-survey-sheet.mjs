// One-off helper: export the live "Survey Ops" Google Sheet to a local .xlsx
// so the refresh/diff scripts (which read a local SheetJS file) operate on current data.
// Run: node --env-file=.env.local scripts/export-survey-sheet.mjs [outPath]
// Reuses the deliverables Drive OAuth creds (Drive scope includes files.export).
import { google } from 'googleapis'
import { writeFileSync } from 'node:fs'

const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'
const out = process.argv[2] || 'scripts/survey-ops-fresh.xlsx'

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
if (!clientId || !clientSecret || !refreshToken) {
  console.error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN in .env.local')
  process.exit(1)
}

const oauth = new google.auth.OAuth2(clientId, clientSecret)
oauth.setCredentials({ refresh_token: refreshToken })
const drive = google.drive({ version: 'v3', auth: oauth })

// Confirm we can see it + grab its name/modified time, then export the whole workbook as xlsx.
const meta = await drive.files.get({ fileId: SHEET_ID, fields: 'name,modifiedTime,mimeType', supportsAllDrives: true })
console.log('source:', meta.data.name, '| modified:', meta.data.modifiedTime, '| type:', meta.data.mimeType)

const res = await drive.files.export(
  { fileId: SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { responseType: 'arraybuffer' },
)
const buf = Buffer.from(res.data)
writeFileSync(out, buf)
console.log('wrote', out, buf.length, 'bytes')

// Sync Sree's "Manual Rerun(sree)" sheet tab into public.rerun_snapshot (the
// Rerun Radar mirror). Fetches the live sheet fresh via the deliverables Drive
// OAuth creds, parses + classifies, then replaces the mirror (service role).
//
//   node --env-file=.env.local scripts/sync-reruns.mjs           -> DRY RUN (prints the plan, writes nothing)
//   node --env-file=.env.local scripts/sync-reruns.mjs --apply    -> replace the mirror
//
// Parse/classify logic mirrors lib/reruns/parse.ts — keep the two in step.
import { google } from 'googleapis'
import * as XLSX from 'xlsx'

const SHEET_ID = '1ZTTJ0PQZ7vj13tmZmsMvKAcEEf0Nc0s8dVbfaYJju7Q'
const APPLY = process.argv.includes('--apply')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
if (!clientId || !clientSecret || !refreshToken) throw new Error('Missing GOOGLE_OAUTH_* in .env.local')

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}

// ---- parse/classify (mirror of lib/reruns/parse.ts) ----
const MONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim())
const monthIdx = (s) => {
  if (!s) return -1
  const m = s.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/)
  return m ? MONS.indexOf(m[1]) : -1
}
const quarterEndM = (s) => {
  const m = (s ?? '').toLowerCase().match(/\bq([1-4])\b/)
  return m ? [2, 5, 8, 11][Number(m[1]) - 1] : -1
}
function statusClass(status, next) {
  const s = (status ?? '').toLowerCase()
  const n = (next ?? '').toLowerCase()
  if (/closed|cancel/.test(n) || /closed|cancel/.test(s)) return 'closed'
  if (/done/.test(s)) return 'done'
  if (/pending/.test(s)) return 'pending'
  if (!s && !n) return 'unknown'
  return 'active'
}
function deriveNextRunDate(status, next, now) {
  const monthEnd = (mm) => new Date(Date.UTC(now.getUTCFullYear(), mm + 1, 0)).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  // A past "<Month/Qn> Pending" outranks a stale "Today" cell.
  if (/pending/i.test(status ?? '')) {
    let pm = monthIdx(status)
    if (pm < 0) pm = quarterEndM(status)
    if (pm >= 0) {
      const end = monthEnd(pm)
      if (end < today) return end
    }
  }
  if ((next ?? '').trim().toLowerCase() === 'today') return today
  let m = monthIdx(status)
  if (m < 0) m = monthIdx(next)
  if (m < 0) {
    m = quarterEndM(status)
    if (m < 0) m = quarterEndM(next)
  }
  if (m < 0) return null
  return monthEnd(m)
}
const headerLooksValid = (header) => {
  const at = (i) => (header?.[i] == null ? '' : String(header[i]).toLowerCase())
  return /client/.test(at(0)) && /next|collection/.test(at(1)) && /cadence/.test(at(5)) && /status/.test(at(9))
}

// ---- fetch live sheet ----
const oauth = new google.auth.OAuth2(clientId, clientSecret)
oauth.setCredentials({ refresh_token: refreshToken })
const drive = google.drive({ version: 'v3', auth: oauth })
const res = await drive.files.export(
  { fileId: SHEET_ID, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { responseType: 'arraybuffer' },
)
const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: true })
const tab = wb.SheetNames.find((nm) => /manual rerun/i.test(nm))
if (!tab) throw new Error('"Manual Rerun" tab not found')
const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null })
if (!headerLooksValid(rows[0] ?? [])) throw new Error('Rerun tab header does not match expected columns — aborting')

const now = new Date()
const parsed = []
for (let i = 1; i < rows.length; i++) {
  const r = rows[i] ?? []
  const client = str(r[0])
  const cadence = str(r[5])
  if (!client && !cadence) continue
  const status_raw = str(r[9])
  const next_cadence = str(r[1])
  parsed.push({
    sheet_row: i,
    client,
    next_cadence,
    work: str(r[2]),
    freq: str(r[3]),
    platform: str(r[4]),
    cadence,
    n: str(r[6]),
    template: str(r[7]),
    note: str(r[8]),
    status_raw,
    survey_ids: str(r[10]),
    next_run_date: deriveNextRunDate(status_raw, next_cadence, now),
    status_class: statusClass(status_raw, next_cadence),
  })
}
if (parsed.length === 0) throw new Error('Parsed 0 rerun rows — aborting rather than wiping the mirror')

const counts = {}
for (const p of parsed) counts[p.status_class] = (counts[p.status_class] || 0) + 1
console.log('parsed', parsed.length, 'rows | status_class:', JSON.stringify(counts))
console.log('with a next_run_date:', parsed.filter((p) => p.next_run_date).length)

if (!APPLY) {
  console.log('\nDRY RUN — no writes. Re-run with --apply to replace the mirror.')
  console.log('sample:', JSON.stringify(parsed.slice(0, 3), null, 1))
  process.exit(0)
}

// Atomic replace (delete-all + insert in one txn, advisory-locked) — see migration 049.
const applied = await rest('POST', 'rpc/replace_rerun_snapshot', { rows: parsed })
console.log(`\napplied: atomically mirrored ${applied} rerun row(s) into rerun_snapshot.`)

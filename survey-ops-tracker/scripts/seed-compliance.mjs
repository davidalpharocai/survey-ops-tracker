// One-time seed of client compliance flags from the sheet's "Compliance" tab.
// Run AFTER migration 037 is applied.
// Usage: node scripts/seed-compliance.mjs "<path to Survey Ops .xlsx>"
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/seed-compliance.mjs "<path to .xlsx>"')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: KEY, Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
}
async function api(method, p, body) {
  const res = await fetch(`${URL_BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const truthy = v => v === true || String(v).trim().toUpperCase() === 'TRUE'

const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
const ws = wb.Sheets['Compliance']
if (!ws) { console.error('No "Compliance" sheet found'); process.exit(1) }
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
// Header row is the one whose first cell is exactly "Client".
const hi = rows.findIndex(r => String(r[0]).trim() === 'Client')
if (hi < 0) { console.error('Could not find the "Client" header row'); process.exit(1) }

const clients = await api('GET', '/clients?select=id,name')
let seeded = 0
const unmatched = []
for (const r of rows.slice(hi + 1)) {
  const firm = String(r[0]).trim()
  if (!firm) continue
  const match = clients.find(c => c.name.toLowerCase() === firm.toLowerCase())
  if (!match) { unmatched.push(firm); continue }
  await api('PATCH', `/clients?id=eq.${match.id}`, {
    compliance_before_fielding: truthy(r[1]),
    compliance_after_fielding: truthy(r[2]),
    compliance_contact: String(r[4] || '').trim() || null,
    compliance_notes: String(r[5] || '').trim() || null,
  })
  seeded++
  console.log(`Seeded ${firm}: before=${truthy(r[1])} after=${truthy(r[2])}`)
}
console.log(`\nSeeded ${seeded} client(s).`)
if (unmatched.length) console.log('UNMATCHED (no client row — add a project for them or check the name):', unmatched.join(', '))

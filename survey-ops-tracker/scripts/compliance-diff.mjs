// True-up check: compare the sheet's "Compliance" tab to the app's client flags
// and print mismatches for David to resolve. Read-only — never writes.
// Usage: node scripts/compliance-diff.mjs "<path to Survey Ops .xlsx>"
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/compliance-diff.mjs "<path to .xlsx>"')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
async function get(p) {
  const res = await fetch(`${URL_BASE}${p}`, { headers })
  if (!res.ok) throw new Error(`GET ${p} -> ${res.status}: ${await res.text()}`)
  return res.json()
}

const truthy = v => v === true || String(v).trim().toUpperCase() === 'TRUE'
const norm = s => (s || '').toString().trim()

const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Compliance'], { header: 1, blankrows: false, defval: '' })
const hi = rows.findIndex(r => String(r[0]).trim() === 'Client')

const clients = await get('/clients?select=id,name,compliance_before_fielding,compliance_after_fielding,compliance_contact')
const byName = new Map(clients.map(c => [c.name.toLowerCase(), c]))

let diffs = 0
for (const r of rows.slice(hi + 1)) {
  const firm = norm(r[0])
  if (!firm) continue
  const c = byName.get(firm.toLowerCase())
  if (!c) { console.log(`• ${firm}: in sheet, NOT in app`); diffs++; continue }
  const sheetBefore = truthy(r[1]), sheetAfter = truthy(r[2]), sheetContact = norm(r[4])
  if (sheetBefore !== c.compliance_before_fielding)
    console.log(`• ${firm} · before-fielding: sheet=${sheetBefore} app=${c.compliance_before_fielding}`), diffs++
  if (sheetAfter !== c.compliance_after_fielding)
    console.log(`• ${firm} · after-fielding: sheet=${sheetAfter} app=${c.compliance_after_fielding}`), diffs++
  if (sheetContact && sheetContact !== norm(c.compliance_contact))
    console.log(`• ${firm} · contact: sheet="${sheetContact}" app="${norm(c.compliance_contact)}"`), diffs++
}
console.log(diffs ? `\n${diffs} difference(s) — resolve in the app (source of truth) or the sheet.` : '\nNo differences — sheet and app agree.')

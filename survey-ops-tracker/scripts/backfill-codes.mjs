// Run AFTER migration 027. Two jobs:
// 1. Copy Cl##### client ids from the sheet's "Unique Clients" tab into clients.code
//    (exact name match, case-insensitive; unmatched clients are listed, not guessed).
// 2. Export the assigned PR##### project ids to scripts/project-id-mapping.csv so the
//    mapping can be added to the Survey Ops sheet for legacy lookups.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}

// --- 1. Client codes from the sheet ---
const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'))
const tab = wb.SheetNames.find(n => n.startsWith('Unique Clients'))
const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null })
const sheetCodes = new Map() // lowercased client name -> Cl id
for (const r of rows.slice(1)) {
  const name = typeof r[0] === 'string' ? r[0].trim() : null
  const code = typeof r[4] === 'string' ? r[4].trim() : null
  if (name && code && /^Cl\d+$/i.test(code) && !sheetCodes.has(name.toLowerCase())) {
    sheetCodes.set(name.toLowerCase(), code)
  }
}
console.log(`sheet has ${sheetCodes.size} named client ids`)

const clients = await rest('GET', 'clients?select=id,name,code&order=name')
let matched = 0
const unmatched = []
const dupes = []
const used = new Set(clients.map(c => c.code).filter(Boolean))
for (const c of clients) {
  if (c.code) continue
  const code = sheetCodes.get(c.name.trim().toLowerCase())
  if (!code) {
    unmatched.push(c.name)
  } else if (used.has(code)) {
    // two DB clients resolve to the same sheet entry — near-duplicate names,
    // left for David's client cleanup rather than guessed at here
    dupes.push(`"${c.name}" also matches ${code}`)
  } else {
    await rest('PATCH', `clients?id=eq.${c.id}`, { code })
    used.add(code)
    matched++
  }
}
console.log(`client codes set: ${matched}; already had codes: ${clients.filter(c => c.code).length}`)
if (dupes.length) console.log('DUPLICATE NAMES (code left blank, needs cleanup):', dupes.join(' | '))
if (unmatched.length) console.log('NO MATCH in sheet (left blank):', unmatched.join(' | '))

// --- 2. Project id mapping export ---
const projects = await rest(
  'GET',
  'survey_projects?select=project_code,project_name,client,submitted_date,status&order=project_code'
)
const esc = v => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = [
  'Project ID,Project Name,Client,Submitted,Status',
  ...projects.map(p =>
    [p.project_code, p.project_name, p.client, p.submitted_date, p.status].map(esc).join(',')
  ),
].join('\n')
fs.writeFileSync(path.join(dir, 'project-id-mapping.csv'), csv)
console.log(`wrote project-id-mapping.csv with ${projects.length} rows (${projects[0]?.project_code} … ${projects.at(-1)?.project_code})`)

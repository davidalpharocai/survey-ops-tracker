// Refresh-import diff: compares the fresh Survey Ops sheet against the
// database WITHOUT writing anything (run with --fill-blanks to apply the one
// safe category: sheet values where the app field is empty).
// The app is the working source of truth now, so sheet values never
// overwrite non-empty app data — conflicts are reported for David.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

const FILL = process.argv.includes('--fill-blanks')
// One-time "sheet wins" overwrite: push sheet values into matched app projects,
// overwriting conflicts. Only fields where the sheet has a value (blank sheet
// cells never null out app data), and only data fields (not board position /
// stage checkboxes). Every change is captured by the audit trigger.
const OVERWRITE = process.argv.includes('--overwrite')
const OVERWRITE_FIELDS = [
  'project_type', 'status', 'submitted_date', 'launch_date', 'due_date', 'deliver_date',
  'n_target', 'n_collected', 'n_actual', 'audience_size', 'salesperson', 'survey_tool_id',
]
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: key, Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
}
async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}

const COL = {
  nextSteps: 0, client: 1, name: 2, longitudinal: 3, type: 4, status: 5,
  submitted: 6, launch: 7, due: 8, deliver: 9,
  voterQA: 10, citation: 11, rowLevel: 12,
  n: 13, nInternal: 14, nCollected: 15, nActual: 16, audience: 17,
  captain: 18, terminations: 19,
  docProg: 23, surveyProg: 24, edwinQA: 25, fielding: 26, dataQA: 27, delivery: 28,
  comments: 30, questionDoc: 32, edwinLink: 33, googleSheet: 34, surveyIds: 35,
  deliverable: 36, sales: 37, projectId: 38,
}

const toDate = v => (v instanceof Date ? v.toISOString().split('T')[0] : null)
const toBool = v => v === true
const toInt = v => {
  if (typeof v === 'number') return Math.round(v)
  if (typeof v === 'string') { const m = v.replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null }
  return null
}

// client text changes applied in the app (June 12 merges) — sheet still uses old spellings
const CLIENT_CANON = {
  'Black kIte Capital': 'Black Kite Capital (Millenium)',
  Jenna: 'FIRE - Jenna', 'IC MainFrame': 'Iowa - IC MainFrame',
  Berman: 'Berman & Co.', Columbia: 'Columbia University', 'Select equity': 'Select Equity',
  COATUE: 'Coatue', 'Goldentree - Adam Phillips': 'GoldenTree - Adam Phillips',
  'Adam Philips': 'GoldenTree - Adam Phillips', 'Adam Phillips': 'GoldenTree - Adam Phillips',
  SportClips: 'Sportclips', 'OK Chamber': 'Oklahoma Chamber',
  'State Chamber of OK - Luke': 'Oklahoma Chamber - Luke Reynolds', 'State Chamber of OK': 'Oklahoma Chamber',
  'Luke Reynolds': 'Oklahoma Chamber - Luke Reynolds', 'James Kenny Chamber': 'US Chamber - James Kenny',
  'Alaska State Chamber': 'Alaska Chamber', Internal: 'AlphaROC', Frank: 'Foulkes for Gov - Frank',
  'HingeVoter/Cara': 'HingeVoter/Carah', 'HingeVoter/Jenna': 'HingeVoter/Carah',
  'SEMA-Lauren': 'SEMA - Lauren', 'US CoC': 'US Chamber', A4A: 'Airlines 4 America (A4A)',
  'Rerun - and then set up quarterly': 'BAM - Elliot', Goldentree: 'GoldenTree',
}
const SALES_CANON = { Alex: 'Alex Pinsky', Jenna: 'Jenna Shrove', Vineet: 'Vineet Kapur', Steve: 'Steven Stubbs', Shanu: 'Shanu Aggarwal' }

const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'), { cellDates: true })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Surveys'], { header: 1, defval: null })
const sheetRows = rows.slice(1).filter(r => r[COL.client] && r[COL.name])

const db = await rest('GET', 'survey_projects?select=id,project_code,project_name,client,project_type,status,phase,submitted_date,launch_date,due_date,deliver_date,n_target,n_collected,n_actual,audience_size,longitudinal,voter_survey_qa,citation_language_needed,row_level_data,terminations,salesperson,survey_tool_id,stage_doc_programming,stage_survey_programming,stage_edwin_qa,stage_fielding,stage_data_qa,stage_delivery&order=project_code')
const byCode = new Map(db.map(p => [p.project_code, p]))
const byKey = new Map(db.map(p => [`${p.client.toLowerCase()} | ${p.project_name.toLowerCase()}`, p]))
const byNameOnly = new Map()
for (const p of db) {
  const k = p.project_name.toLowerCase()
  byNameOnly.set(k, byNameOnly.has(k) ? 'AMBIGUOUS' : p)
}

function parseRow(r) {
  const statusRaw = (r[COL.status] ?? '').toString().trim()
  const status = statusRaw === 'Done' || statusRaw === 'Canceled' ? 'Closed' : statusRaw === 'Hold' ? 'Hold' : 'Open'
  const clientRaw = String(r[COL.client]).trim()
  const surveyIds = r[COL.surveyIds] ? String(r[COL.surveyIds]).trim() : null
  return {
    code: typeof r[COL.projectId] === 'string' && /^PR\d{5}$/.test(r[COL.projectId].trim()) ? r[COL.projectId].trim() : null,
    project_name: String(r[COL.name]).trim(),
    client: CLIENT_CANON[clientRaw] ?? clientRaw,
    clientRaw,
    project_type: ['PS', 'B2B', 'Rerun'].includes((r[COL.type] ?? '').toString().trim()) ? r[COL.type].toString().trim() : null,
    status, statusRaw,
    submitted_date: toDate(r[COL.submitted]),
    launch_date: toDate(r[COL.launch]),
    due_date: toDate(r[COL.due]),
    deliver_date: toDate(r[COL.deliver]),
    n_target: toInt(r[COL.nInternal]) ?? toInt(r[COL.n]),
    n_collected: toInt(r[COL.nCollected]),
    n_actual: toInt(r[COL.nActual]),
    audience_size: toInt(r[COL.audience]),
    longitudinal: toBool(r[COL.longitudinal]),
    row_level_data: toBool(r[COL.rowLevel]),
    terminations: toBool(r[COL.terminations]),
    salesperson: r[COL.sales] ? (SALES_CANON[String(r[COL.sales]).trim()] ?? String(r[COL.sales]).trim()) : null,
    survey_tool_id: surveyIds,
    captain: (r[COL.captain] ?? '').toString().trim(),
  }
}

// fields compared; blank-fillable = sheet has value, app has null/empty
const COMPARE = ['project_type', 'submitted_date', 'launch_date', 'due_date', 'deliver_date',
  'n_target', 'n_actual', 'audience_size', 'salesperson', 'survey_tool_id']

const newRows = [], conflicts = [], fillables = [], overwrites = [], matchedCodes = new Set()
let matched = 0

for (const r of sheetRows) {
  const s = parseRow(r)
  let p = s.code ? byCode.get(s.code) : null
  if (!p) p = byKey.get(`${s.client.toLowerCase()} | ${s.project_name.toLowerCase()}`)
  if (!p) {
    const n = byNameOnly.get(s.project_name.toLowerCase())
    if (n && n !== 'AMBIGUOUS') p = n
  }
  if (!p) { newRows.push(s); continue }
  matched++
  matchedCodes.add(p.project_code)

  if (OVERWRITE) {
    const diff = {}
    for (const f of OVERWRITE_FIELDS) {
      const sv = s[f]
      if (sv == null || sv === '') continue
      if (String(sv) !== String(p[f] ?? '')) diff[f] = sv
    }
    if (Object.keys(diff).length) overwrites.push({ code: p.project_code, name: p.project_name, updates: diff })
  }

  for (const f of COMPARE) {
    const sv = s[f], dv = p[f]
    if (sv == null || sv === '') continue
    if (dv == null || dv === '') {
      fillables.push({ code: p.project_code, name: p.project_name, field: f, value: sv })
    } else if (String(sv) !== String(dv)) {
      conflicts.push({ code: p.project_code, name: p.project_name, field: f, sheet: sv, app: dv })
    }
  }
  // status compared report-only (app statuses move daily)
  if (s.status !== p.status) {
    conflicts.push({ code: p.project_code, name: p.project_name, field: 'status', sheet: `${s.status} ("${s.statusRaw}")`, app: p.status })
  }
  // n_collected: report only when sheet is AHEAD (app syncs from Edwin nightly)
  if (s.n_collected != null && p.n_collected != null && s.n_collected > p.n_collected) {
    conflicts.push({ code: p.project_code, name: p.project_name, field: 'n_collected', sheet: s.n_collected, app: p.n_collected })
  }
}

const appOnly = db.filter(p => !matchedCodes.has(p.project_code))

console.log(`sheet rows: ${sheetRows.length} | matched: ${matched} | new in sheet: ${newRows.length} | app-only: ${appOnly.length}`)
console.log(`\n=== NEW IN SHEET (would import) ===`)
for (const s of newRows) console.log(`  ${s.clientRaw} | ${s.project_name} (${s.statusRaw || 'Open'})`)
console.log(`\n=== APP-ONLY (created in app or deleted from sheet — left alone) ===`)
for (const p of appOnly) console.log(`  ${p.project_code} ${p.client} | ${p.project_name} (${p.status})`)
console.log(`\n=== BLANK-FILLS (sheet has data, app field empty${FILL ? ' — APPLYING' : ''}) ===`)
for (const f of fillables) console.log(`  ${f.code} ${f.name}: ${f.field} <- ${JSON.stringify(f.value)}`)
console.log(`\n=== CONFLICTS (both have values — app kept, listed for David) ===`)
for (const c of conflicts) console.log(`  ${c.code} ${c.name}: ${c.field} sheet=${JSON.stringify(c.sheet)} app=${JSON.stringify(c.app)}`)

if (OVERWRITE) {
  console.log(`\n=== OVERWRITE (sheet → app, matched projects, differing fields only) ===`)
  for (const o of overwrites) console.log(`  ${o.code} ${o.name}: ${JSON.stringify(o.updates)}`)
  for (const o of overwrites) {
    await rest('PATCH', `survey_projects?project_code=eq.${o.code}`, o.updates)
  }
  console.log(`\nOVERWROTE ${overwrites.length} projects with sheet values`)
}

if (FILL && fillables.length) {
  const byProject = new Map()
  for (const f of fillables) {
    const cur = byProject.get(f.code) ?? {}
    cur[f.field] = f.value
    byProject.set(f.code, cur)
  }
  for (const [code, updates] of byProject) {
    await rest('PATCH', `survey_projects?project_code=eq.${code}`, updates)
  }
  console.log(`\napplied blank-fills to ${byProject.size} projects`)
}

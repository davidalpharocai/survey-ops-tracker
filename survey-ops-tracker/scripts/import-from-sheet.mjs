// Import projects from the master Survey Ops sheet (Surveys tab).
// Usage:
//   node scripts/import-from-sheet.mjs            -> dry run (prints summary)
//   node scripts/import-from-sheet.mjs --execute  -> wipes existing projects and imports
import * as fs from 'node:fs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)

const EXECUTE = process.argv.includes('--execute')
// Safe incremental mode: insert ONLY sheet rows whose project name isn't already
// in the app — never deletes anything. (The default --execute path wipes and
// re-imports everything; --new-only is for adding new projects to live data.)
const NEW_ONLY = process.argv.includes('--new-only')

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
async function api(method, path, body) {
  const res = await fetch(`${URL_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

// --- column indexes in the Surveys tab ---
const COL = {
  nextSteps: 0, client: 1, name: 2, longitudinal: 3, type: 4, status: 5,
  submitted: 6, launch: 7, due: 8, deliver: 9,
  voterQA: 10, citation: 11, rowLevel: 12,
  n: 13, nInternal: 14, nCollected: 15, nActual: 16, audience: 17,
  captain: 18, terminations: 19,
  docProg: 23, surveyProg: 24, edwinQA: 25, fielding: 26, dataQA: 27, delivery: 28,
  comments: 30, questionDoc: 32, edwinLink: 33, googleSheet: 34, surveyIds: 35,
  deliverable: 36, sales: 37, meetingNotes: 38,
}

const toDate = v => (v instanceof Date ? v.toISOString().split('T')[0] : null)
const toBool = v => v === true
const toInt = v => {
  if (typeof v === 'number') return Math.round(v)
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/\d+/)
    return m ? parseInt(m[0], 10) : null
  }
  return null
}
const toUrl = v => (typeof v === 'string' && /^https?:\/\//.test(v.trim()) ? v.trim() : null)
const TYPES = new Set(['PS', 'B2B', 'Rerun'])

function deriveColumn(flags) {
  if (!flags.stage_doc_programming) return 'Submitted'
  if (!flags.stage_survey_programming) return 'Doc Programming'
  if (!flags.stage_edwin_qa) return 'Survey Programming'
  if (!flags.stage_fielding) return 'EdWin QA'
  if (!flags.stage_data_qa) return 'Fielding'
  if (!flags.stage_delivery) return 'Data QA'
  return 'Delivery'
}

// --- load roster for captain mapping ---
const members = await api('GET', '/team_members?select=id,initials,email')
const byInitials = ini => members.find(m => m.initials.toUpperCase() === ini.toUpperCase())?.id
const tbdId = byInitials('TBD')

// --- parse sheet ---
const wb = XLSX.readFile(fileURLToPath(new URL('./survey-ops.xlsx', import.meta.url)), { cellDates: true })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Surveys'], { header: 1, defval: null })
const data = rows.slice(1).filter(r => r[COL.client] && r[COL.name])

const projects = []
const warnings = []
for (const r of data) {
  const statusRaw = (r[COL.status] ?? '').toString().trim()
  const status = statusRaw === 'Done' ? 'Closed' : 'Open'
  const captainRaw = (r[COL.captain] ?? '').toString().trim()
  const captainList = captainRaw.split(',').map(s => s.trim()).filter(Boolean)
  let captain_id = captainList.length ? byInitials(captainList[0]) : tbdId
  if (!captain_id) {
    warnings.push(`Unknown captain "${captainList[0]}" on "${r[COL.name]}" -> TBD`)
    captain_id = tbdId
  }

  const flags = {
    stage_doc_programming: toBool(r[COL.docProg]),
    stage_survey_programming: toBool(r[COL.surveyProg]),
    stage_edwin_qa: toBool(r[COL.edwinQA]),
    stage_fielding: toBool(r[COL.fielding]),
    stage_data_qa: toBool(r[COL.dataQA]),
    stage_delivery: toBool(r[COL.delivery]),
  }

  const noteParts = []
  if (r[COL.nextSteps]) noteParts.push(String(r[COL.nextSteps]).trim())
  if (r[COL.comments]) noteParts.push('Comments: ' + String(r[COL.comments]).trim())
  if (captainList.length > 1) noteParts.push('Co-captains: ' + captainList.join(', '))
  if (statusRaw === 'Hold') noteParts.push('[Imported with status: Hold]')

  const docs = [COL.questionDoc, COL.edwinLink, COL.googleSheet, COL.deliverable, COL.meetingNotes]
    .map(i => toUrl(r[i])).filter(Boolean)

  const typeRaw = (r[COL.type] ?? '').toString().trim()
  const surveyIds = r[COL.surveyIds] ? String(r[COL.surveyIds]).trim() : null

  projects.push({
    project_name: String(r[COL.name]).trim(),
    client: String(r[COL.client]).trim(),
    project_type: TYPES.has(typeRaw) ? typeRaw : null,
    captain_id,
    phase: 'Active',
    status,
    board_column: deriveColumn(flags),
    ...flags,
    submitted_date: toDate(r[COL.submitted]),
    launch_date: toDate(r[COL.launch]),
    due_date: toDate(r[COL.due]),
    deliver_date: toDate(r[COL.deliver]),
    n_target: toInt(r[COL.nInternal]) ?? toInt(r[COL.n]),
    n_collected: toInt(r[COL.nCollected]) ?? 0,
    n_actual: toInt(r[COL.nActual]),
    audience_size: toInt(r[COL.audience]),
    longitudinal: toBool(r[COL.longitudinal]),
    voter_survey_qa: r[COL.voterQA] == null ? null : toBool(r[COL.voterQA]),
    citation_language_needed: r[COL.citation] == null ? null : toBool(r[COL.citation]),
    row_level_data: toBool(r[COL.rowLevel]),
    terminations: toBool(r[COL.terminations]),
    salesperson: r[COL.sales] ? String(r[COL.sales]).trim() : null,
    survey_tool_id: surveyIds,
    survey_ids_from_sheet: surveyIds,
    survey_ids_synced_at: surveyIds ? new Date().toISOString() : null,
    latest_next_steps: noteParts.length ? noteParts.join('\n') : null,
    linked_documents: docs,
  })
}

// --- summary ---
const open = projects.filter(p => p.status === 'Open')
console.log(`Parsed ${projects.length} projects (${open.length} Open, ${projects.length - open.length} Closed)`)
console.log('Open projects by column:')
const byCol = {}
for (const p of open) byCol[p.board_column] = (byCol[p.board_column] || 0) + 1
console.log(' ', JSON.stringify(byCol))
console.log(`With survey IDs: ${projects.filter(p => p.survey_tool_id).length}, with linked docs: ${projects.filter(p => p.linked_documents.length).length}`)
if (warnings.length) console.log('Warnings:\n  ' + warnings.slice(0, 10).join('\n  ') + (warnings.length > 10 ? `\n  ...and ${warnings.length - 10} more` : ''))

if (NEW_ONLY) {
  const existing = await api('GET', '/survey_projects?select=project_name&deleted_at=is.null')
  const have = new Set((existing ?? []).map(p => p.project_name.trim().toLowerCase()))
  const newOnes = projects.filter(p => !have.has(p.project_name.trim().toLowerCase()))
  console.log(`\n=== NEW-ONLY: ${newOnes.length} sheet projects not already in the app ===`)
  for (const p of newOnes) console.log(`  + ${p.client} | ${p.project_name}  (${p.status}, ${p.board_column})`)
  if (!EXECUTE) {
    console.log('\nDRY RUN — run with `--new-only --execute` to insert these (no deletes, no existing data touched).')
    process.exit(0)
  }
  for (let i = 0; i < newOnes.length; i += 50) {
    await api('POST', '/survey_projects', newOnes.slice(i, i + 50))
    console.log(`Inserted ${Math.min(i + 50, newOnes.length)}/${newOnes.length}`)
  }
  console.log(`\nInserted ${newOnes.length} new projects. Existing projects untouched.`)
  process.exit(0)
}

if (!EXECUTE) {
  console.log('\nDRY RUN — nothing written. Sample Open project:')
  console.log(JSON.stringify(open[0], null, 2))
  console.log('\nRun with --execute to wipe current projects and import.')
  process.exit(0)
}

// --- execute ---
await api('DELETE', '/survey_projects?id=not.is.null')
console.log('\nDeleted existing projects.')
for (let i = 0; i < projects.length; i += 50) {
  const batch = projects.slice(i, i + 50)
  await api('POST', '/survey_projects', batch)
  console.log(`Inserted ${Math.min(i + 50, projects.length)}/${projects.length}`)
}
console.log('Import complete.')

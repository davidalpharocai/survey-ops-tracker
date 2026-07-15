// Comprehensive Survey Ops sheet -> Command Center sync (sheet-wins, full mirror).
// Pre-migration: the team's sheet is the live source of truth, so this brings the
// app fully into line with the "Surveys" tab — scalar data, pipeline stages/board,
// Y/N flags, Latest/Next-Steps + Comments, and document links — for matched projects,
// and inserts genuinely-new ones. Smart exceptions: Edwin-owned survey IDs and
// n_collected are only taken when the sheet is clearly ahead / the app is blank, and
// known genuine person/type disagreements are flagged (not overwritten).
//
//   node scripts/sheet-sync.mjs            -> DRY RUN (writes nothing; prints + logs the full plan)
//   node scripts/sheet-sync.mjs --apply    -> apply (PATCH matched, POST new)
//
// Reads scripts/survey-ops.xlsx (export the live sheet there first).
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
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
const triBool = v => (v === true ? true : v === false ? false : null) // explicit-only (blank => no info)
const toInt = v => {
  if (typeof v === 'number') return Math.round(v)
  if (typeof v === 'string') { const m = v.replace(/,/g, '').match(/\d+/); return m ? parseInt(m[0], 10) : null }
  return null
}
const toUrl = v => (typeof v === 'string' && /^https?:\/\//.test(v.trim()) ? v.trim() : null)
const TYPES = new Set(['PS', 'B2B', 'Rerun'])

const CLIENT_CANON = {
  'Black kIte Capital': 'Black Kite Capital (Millenium)', Jenna: 'FIRE - Jenna', 'IC MainFrame': 'Iowa - IC MainFrame',
  Berman: 'Berman & Co.', Columbia: 'Columbia University', 'Select equity': 'Select Equity', COATUE: 'Coatue',
  'Goldentree - Adam Phillips': 'GoldenTree - Adam Phillips', 'Adam Philips': 'GoldenTree - Adam Phillips', 'Adam Phillips': 'GoldenTree - Adam Phillips',
  SportClips: 'Sportclips', 'OK Chamber': 'Oklahoma Chamber', 'State Chamber of OK - Luke': 'Oklahoma Chamber - Luke Reynolds',
  'State Chamber of OK': 'Oklahoma Chamber', 'Luke Reynolds': 'Oklahoma Chamber - Luke Reynolds', 'James Kenny Chamber': 'US Chamber - James Kenny',
  'Alaska State Chamber': 'Alaska Chamber', Internal: 'AlphaROC', Frank: 'Foulkes for Gov - Frank',
  'HingeVoter/Cara': 'HingeVoter/Carah', 'HingeVoter/Jenna': 'HingeVoter/Carah', 'SEMA-Lauren': 'SEMA - Lauren',
  'US CoC': 'US Chamber', A4A: 'Airlines 4 America (A4A)', 'Rerun - and then set up quarterly': 'BAM - Elliot', Goldentree: 'GoldenTree',
  'Vance Junction AI': 'Junction AI', 'Main Fraim/Junction.AI - Vance': 'Junction AI', 'Junction.AI - Vance Reavie': 'Junction AI', 'Junction.AI': 'Junction AI', // Vance Reavie is the contact, not the client
}
const SALES_CANON = { Alex: 'Alex Pinsky', Jenna: 'Jenna Shrove', Vineet: 'Vineet Kapur', Steve: 'Steven Stubbs', Shanu: 'Shanu Aggarwal' }

// Genuine disagreements surfaced to David — never auto-overwrite these (project_code -> [fields])
const SKIP = { PR00119: ['salesperson'], PR00122: ['salesperson'], PR00001: ['project_type', 'status'] }
// New-in-sheet rows to NOT auto-insert (handled separately / flagged)
const HOLD_NEW = new Set([
  'bam - jeff cumming|bam - jeff cumming', // malformed: project name == client (blank project row)
])

const norm = s => String(s).toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim()
const STAMP = '⚠ Compliance approved via email — sheet refresh 2026.06.30'

function deriveColumn(f) {
  if (!f.stage_doc_programming) return 'Submitted'
  if (!f.stage_survey_programming) return 'Doc Programming'
  if (!f.stage_edwin_qa) return 'Survey Programming'
  if (!f.stage_fielding) return 'EdWin QA'
  if (!f.stage_data_qa) return 'Fielding'
  if (!f.stage_delivery) return 'Data QA'
  return 'Delivery'
}

function parseRow(r) {
  const statusRaw = (r[COL.status] ?? '').toString().trim()
  const status = statusRaw === 'Done' || statusRaw === 'Canceled' ? 'Closed' : statusRaw === 'Hold' ? 'Hold' : 'Open'
  const clientRaw = String(r[COL.client]).trim()
  const surveyIds = r[COL.surveyIds] ? String(r[COL.surveyIds]).trim() : null
  const noteParts = []
  if (r[COL.nextSteps]) noteParts.push(String(r[COL.nextSteps]).trim())
  if (r[COL.comments]) noteParts.push('Comments: ' + String(r[COL.comments]).trim())
  const docs = [COL.questionDoc, COL.edwinLink, COL.googleSheet, COL.deliverable].map(i => toUrl(r[i])).filter(Boolean)
  return {
    code: typeof r[COL.projectId] === 'string' && /^PR\d{5}$/.test(r[COL.projectId].trim()) ? r[COL.projectId].trim() : null,
    project_name: String(r[COL.name]).trim(),
    client: CLIENT_CANON[clientRaw] ?? clientRaw, clientRaw,
    project_type: TYPES.has((r[COL.type] ?? '').toString().trim()) ? r[COL.type].toString().trim() : null,
    status, statusRaw,
    submitted_date: toDate(r[COL.submitted]), launch_date: toDate(r[COL.launch]), due_date: toDate(r[COL.due]), deliver_date: toDate(r[COL.deliver]),
    n_target: toInt(r[COL.nInternal]) ?? toInt(r[COL.n]), n_collected: toInt(r[COL.nCollected]), n_actual: toInt(r[COL.nActual]), audience_size: toInt(r[COL.audience]),
    longitudinal: triBool(r[COL.longitudinal]), voter_survey_qa: triBool(r[COL.voterQA]), citation_language_needed: triBool(r[COL.citation]),
    row_level_data: triBool(r[COL.rowLevel]), terminations: triBool(r[COL.terminations]),
    stages: {
      stage_doc_programming: toBool(r[COL.docProg]), stage_survey_programming: toBool(r[COL.surveyProg]), stage_edwin_qa: toBool(r[COL.edwinQA]),
      stage_fielding: toBool(r[COL.fielding]), stage_data_qa: toBool(r[COL.dataQA]), stage_delivery: toBool(r[COL.delivery]),
    },
    salesperson: r[COL.sales] ? (SALES_CANON[String(r[COL.sales]).trim()] ?? String(r[COL.sales]).trim()) : null,
    survey_tool_id: surveyIds, captain: (r[COL.captain] ?? '').toString().trim(),
    notes: noteParts.length ? noteParts.join('\n') : null, docs,
  }
}

// ---- load sheet + DB ----
const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'), { cellDates: true })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Surveys'], { header: 1, defval: null })
const sheetRows = rows.slice(1).filter(r => r[COL.client] && r[COL.name]).map(parseRow)

const PFIELDS = 'id,project_code,project_name,client,client_id,project_type,status,submitted_date,launch_date,due_date,deliver_date,n_target,n_collected,n_actual,audience_size,salesperson,survey_tool_id,longitudinal,voter_survey_qa,citation_language_needed,row_level_data,terminations,stage_doc_programming,stage_survey_programming,stage_edwin_qa,stage_fielding,stage_data_qa,stage_delivery,board_column,latest_next_steps,linked_documents'
const db = await rest('GET', `survey_projects?select=${PFIELDS}&deleted_at=is.null&order=project_code`)
const clients = await rest('GET', 'clients?select=id,name,compliance_before_fielding,compliance_after_fielding')
const members = await rest('GET', 'team_members?select=id,initials')
const compById = new Map(clients.map(c => [c.id, c]))
const compByName = new Map(clients.map(c => [c.name.toLowerCase(), c]))
const byInitials = ini => members.find(m => m.initials?.toUpperCase() === ini.toUpperCase())?.id
const tbdId = byInitials('TBD')

const byCode = new Map(db.map(p => [p.project_code, p]))
const byKey = new Map(db.map(p => [`${p.client.toLowerCase()} | ${p.project_name.toLowerCase()}`, p]))
const byNameOnly = new Map(); const byNorm = new Map()
for (const p of db) {
  const k = p.project_name.toLowerCase(); byNameOnly.set(k, byNameOnly.has(k) ? 'AMB' : p)
  const nk = norm(p.project_name); byNorm.set(nk, byNorm.has(nk) ? 'AMB' : p)
}
function matchApp(s) {
  let p = s.code ? byCode.get(s.code) : null
  if (!p) p = byKey.get(`${s.client.toLowerCase()} | ${s.project_name.toLowerCase()}`)
  if (!p) { const n = byNameOnly.get(s.project_name.toLowerCase()); if (n && n !== 'AMB') p = n }
  if (!p) { const n = byNorm.get(norm(s.project_name)); if (n && n !== 'AMB') p = n }
  return p
}

const ensureStamp = t => (t && t.includes('Compliance approved via email') ? t : (t ? `${t}\n${STAMP}` : STAMP))
const docUrl = d => {
  if (d && typeof d === 'object') return d.url ?? null
  if (typeof d === 'string') {
    const t = d.trim()
    if (t.startsWith('{')) { try { return JSON.parse(t).url ?? t } catch { return t } } // some entries are JSON-stringified {name,url}
    return t
  }
  return null
}
// Same Edwin survey appears with different transaction_id test tokens — dedup on identity (source), not the token.
const normDoc = u => { try { const x = new URL(u); x.searchParams.delete('transaction_id'); return x.toString().replace(/\/$/, '') } catch { return String(u).trim() } }
function unionDocs(appDocs, sheetDocs) {
  const out = Array.isArray(appDocs) ? [...appDocs] : []
  const have = new Set(out.map(docUrl).filter(Boolean).map(normDoc))
  let added = 0
  for (const u of sheetDocs) { const k = normDoc(u); if (!have.has(k)) { out.push(u); have.add(k); added++ } }
  return { docs: out, added }
}

// ---- build matched patches ----
const updates = []        // { code, name, patch, flags, boardMove, stamp }
const flagsReport = []    // genuine disagreements
let matched = 0
const matchedCodes = new Set()
const newRows = []

for (const s of sheetRows) {
  const p = matchApp(s)
  if (!p) { newRows.push(s); continue }
  if (matchedCodes.has(p.project_code)) continue // a later sheet row already claimed this app project (dup row)
  matched++; matchedCodes.add(p.project_code)
  const skip = SKIP[p.project_code] || []
  const patch = {}; const localFlags = []
  const setIf = (f, v) => {
    if (v == null || v === '') return
    if (String(v) === String(p[f] ?? '')) return
    if (skip.includes(f)) { localFlags.push(`${f}: sheet=${JSON.stringify(v)} app=${JSON.stringify(p[f])}`); return }
    patch[f] = v
  }
  setIf('project_type', s.project_type); setIf('status', s.status)
  setIf('submitted_date', s.submitted_date); setIf('launch_date', s.launch_date); setIf('due_date', s.due_date); setIf('deliver_date', s.deliver_date)
  setIf('n_target', s.n_target); setIf('n_actual', s.n_actual); setIf('audience_size', s.audience_size)
  setIf('salesperson', s.salesperson)
  // survey_tool_id: blank-fill only; flag real conflicts
  if (s.survey_tool_id) { if (!p.survey_tool_id) patch.survey_tool_id = s.survey_tool_id; else if (s.survey_tool_id !== p.survey_tool_id) localFlags.push(`survey_tool_id: sheet=${JSON.stringify(s.survey_tool_id)} app=${JSON.stringify(p.survey_tool_id)}`) }
  // n_collected: only when sheet is ahead (Edwin owns it)
  if (s.n_collected != null && (p.n_collected == null || s.n_collected > p.n_collected)) patch.n_collected = s.n_collected
  // Y/N flags: explicit-only
  for (const f of ['longitudinal', 'voter_survey_qa', 'citation_language_needed', 'row_level_data', 'terminations']) if (s[f] != null && s[f] !== p[f]) patch[f] = s[f]
  // stages + board (full mirror) — but NOT for Closed projects: once a project is marked
  // Done the team stops ticking the per-stage boxes, so the sheet's stage flags are
  // incomplete and mirroring them would drag finished work backward on the board.
  let boardMove = null
  if (s.status !== 'Closed') {
    for (const [f, v] of Object.entries(s.stages)) if (v !== p[f]) patch[f] = v
    const newBoard = deriveColumn(s.stages)
    boardMove = newBoard !== p.board_column ? `${p.board_column} -> ${newBoard}` : null
    if (boardMove) patch.board_column = newBoard
  }
  // notes: sheet-wins when sheet has content; + compliance stamp
  const comp = compById.get(p.client_id)
  const needStamp = (s.stages.stage_fielding && comp?.compliance_before_fielding) || (s.stages.stage_delivery && comp?.compliance_after_fielding)
  let notes = s.notes && s.notes !== p.latest_next_steps ? s.notes : p.latest_next_steps
  if (needStamp) notes = ensureStamp(notes)
  if (notes && notes !== p.latest_next_steps) patch.latest_next_steps = notes
  // docs union
  const { docs, added } = unionDocs(p.linked_documents, s.docs)
  if (added) patch.linked_documents = docs
  if (localFlags.length) flagsReport.push({ code: p.project_code, name: p.project_name, flags: localFlags })
  if (Object.keys(patch).length) updates.push({ code: p.project_code, name: p.project_name, patch, boardMove, stamped: needStamp && (!p.latest_next_steps || !p.latest_next_steps.includes('Compliance approved via email')) })
}

// ---- build new inserts ----
const toInsert = []; const held = []
for (const s of newRows) {
  const keyN = `${s.clientRaw.toLowerCase()}|${s.project_name.toLowerCase()}`
  if (HOLD_NEW.has(keyN)) { held.push(s); continue }
  const captainList = s.captain.split(',').map(x => x.trim()).filter(Boolean)
  let captain_id = captainList.length ? byInitials(captainList[0]) : tbdId
  if (!captain_id) captain_id = tbdId
  const comp = compByName.get(String(s.client).split(' - ')[0].toLowerCase())
  const needStamp = (s.stages.stage_fielding && comp?.compliance_before_fielding) || (s.stages.stage_delivery && comp?.compliance_after_fielding)
  let notes = s.notes
  if (captainList.length > 1) notes = (notes ? notes + '\n' : '') + 'Co-captains: ' + captainList.join(', ')
  if (needStamp) notes = ensureStamp(notes)
  toInsert.push({
    project_name: s.project_name, client: s.client, project_type: s.project_type, captain_id, phase: 'Active', status: s.status,
    board_column: deriveColumn(s.stages), ...s.stages,
    submitted_date: s.submitted_date, launch_date: s.launch_date, due_date: s.due_date, deliver_date: s.deliver_date,
    n_target: s.n_target, n_collected: s.n_collected ?? 0, n_actual: s.n_actual, audience_size: s.audience_size,
    longitudinal: s.longitudinal ?? false, voter_survey_qa: s.voter_survey_qa, citation_language_needed: s.citation_language_needed,
    row_level_data: s.row_level_data ?? false, terminations: s.terminations ?? false,
    salesperson: s.salesperson, survey_tool_id: s.survey_tool_id, survey_ids_from_sheet: s.survey_tool_id,
    survey_ids_synced_at: s.survey_tool_id ? new Date().toISOString() : null,
    latest_next_steps: notes, linked_documents: s.docs,
  })
}

// ---- report ----
const log = []
const tally = {}
for (const u of updates) for (const f of Object.keys(u.patch)) tally[f] = (tally[f] || 0) + 1
log.push(`MATCHED: ${matched} | with changes: ${updates.length} | NEW to insert: ${toInsert.length} | held/flagged-new: ${held.length} | genuine-disagreement flags: ${flagsReport.length}`)
log.push(`board cards moving: ${updates.filter(u => u.boardMove).length} | status->Closed: ${updates.filter(u => u.patch.status === 'Closed').length} | compliance stamps: ${updates.filter(u => u.stamped).length + toInsert.filter(i => i.latest_next_steps?.includes('Compliance approved')).length}`)
log.push(`\n=== FIELD CHANGE TALLY (matched) ===`); for (const [f, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) log.push(`  ${f}: ${n}`)
log.push(`\n=== NEW PROJECTS TO INSERT (${toInsert.length}) ===`); for (const i of toInsert) log.push(`  + ${i.client} | ${i.project_name} (${i.status}, ${i.board_column})`)
log.push(`\n=== HELD NEW ROWS (not inserted — your call) ===`); for (const h of held) log.push(`  ? ${h.clientRaw} | ${h.project_name} (${h.statusRaw || 'Open'})`)
log.push(`\n=== GENUINE DISAGREEMENTS (kept app value — flagged) ===`); for (const f of flagsReport) for (const fl of f.flags) log.push(`  ${f.code} ${f.name}: ${fl}`)
log.push(`\n=== PER-PROJECT CHANGES (matched) ===`); for (const u of updates) log.push(`  ${u.code} ${u.name}${u.boardMove ? ` [board ${u.boardMove}]` : ''}${u.stamped ? ' [compliance-stamp]' : ''}: ${JSON.stringify(u.patch)}`)
const out = log.join('\n')
fs.writeFileSync(path.join(dir, '_sheet-sync-plan.log'), out)
console.log(out.split('\n').slice(0, 200).join('\n'))
console.log(`\n(full plan written to scripts/_sheet-sync-plan.log)`)

if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to write.'); process.exit(0) }

// ---- apply ----
let patched = 0
for (const u of updates) { await rest('PATCH', `survey_projects?project_code=eq.${u.code}`, u.patch); patched++; if (patched % 25 === 0) console.log(`patched ${patched}/${updates.length}`) }
console.log(`PATCHED ${patched} projects`)
// PostgREST bulk insert requires every row to have an identical key set — normalize (undefined/missing -> null).
const allKeys = [...new Set(toInsert.flatMap(o => Object.keys(o)))]
const normInsert = toInsert.map(o => Object.fromEntries(allKeys.map(k => [k, o[k] ?? null])))
for (let i = 0; i < normInsert.length; i += 50) { await rest('POST', 'survey_projects', normInsert.slice(i, i + 50)); console.log(`inserted ${Math.min(i + 50, normInsert.length)}/${normInsert.length}`) }
console.log(`INSERTED ${normInsert.length} new projects. Done.`)

// Find doc/sheet links in the Survey Ops sheet that are NOT already on the matching
// SOCC project's linked_documents. IMPORTANT: the Doc/Sheet cells show a text LABEL
// but carry the real URL as a cell hyperlink (.l.Target) — so we read the hyperlink,
// not the display value. Matches by Project ID (col 38) then unique project name.
//   node --env-file=.env.local scripts/link-diff.mjs                    -> dry report (all 4 cols)
//   node --env-file=.env.local scripts/link-diff.mjs --cols=32,34       -> restrict columns
//   node --env-file=.env.local scripts/link-diff.mjs --cols=32,34 --apply  -> attach missing
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'
XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))

const LABELS = { 32: 'Survey Question(s) Document', 33: 'Edwin Link', 34: 'GoogleSheet', 36: 'Deliverable' }
const argCols = (process.argv.find(a => a.startsWith('--cols=')) || '').replace('--cols=', '')
const COLS = argCols ? argCols.split(',').map(Number) : [32, 33, 34, 36]
const APPLY = process.argv.includes('--apply')
const CODE_COL = 38, CLIENT_COL = 1, NAME_COL = 2

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); if (!res.ok) throw new Error(`${method} ${p}: ${text}`); return text ? JSON.parse(text) : []
}

const docUrl = d => { if (d && typeof d === 'object') return d.url ?? null; if (typeof d === 'string') { const t = d.trim(); if (t.startsWith('{')) { try { return JSON.parse(t).url ?? t } catch { return t } } return t } return null }
const normDoc = u => { try { const x = new URL(u); x.searchParams.delete('transaction_id'); return x.toString().replace(/\/$/, '') } catch { return String(u).trim() } }

const wb = XLSX.readFile(path.join(dir, 'survey-ops-fresh.xlsx'), { cellDates: true, cellFormula: true })
const ws = wb.Sheets['Surveys']
const range = XLSX.utils.decode_range(ws['!ref'])
const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })]
const cellStr = (r, c) => { const x = cell(r, c); return x && x.v != null ? String(x.v).trim() : '' }
// Real URL behind a cell: prefer the attached hyperlink, then a HYPERLINK() formula, then a literal URL value.
function cellUrl(r, c) {
  const x = cell(r, c); if (!x) return null
  if (x.l?.Target && /^https?:\/\//.test(x.l.Target)) return x.l.Target.trim()
  if (typeof x.f === 'string') { const m = x.f.match(/HYPERLINK\(\s*"([^"]+)"/i); if (m && /^https?:\/\//.test(m[1])) return m[1].trim() }
  if (typeof x.v === 'string' && /^https?:\/\//.test(x.v.trim())) return x.v.trim()
  return null
}

const db = await rest('GET', 'survey_projects?select=id,project_code,project_name,client,linked_documents&deleted_at=is.null')
const byCode = new Map(db.map(p => [p.project_code, p]))
const nameCount = new Map(); db.forEach(p => nameCount.set(p.project_name.toLowerCase().trim(), (nameCount.get(p.project_name.toLowerCase().trim()) || 0) + 1))
const byUniqueName = new Map(); db.forEach(p => { const k = p.project_name.toLowerCase().trim(); if (nameCount.get(k) === 1) byUniqueName.set(k, p) })

const perCol = {}; COLS.forEach(c => (perCol[c] = 0))
const missingByProject = new Map()
const unmatched = []
let rowsScanned = 0, rowsWithLinks = 0

for (let r = 1; r <= range.e.r; r++) {
  const client = cellStr(r, CLIENT_COL), name = cellStr(r, NAME_COL)
  if (!client || !name) continue
  rowsScanned++
  const links = COLS.map(c => ({ col: c, label: LABELS[c], text: cellStr(r, c), url: cellUrl(r, c) })).filter(x => x.url)
  if (!links.length) continue
  rowsWithLinks++
  const codeRaw = cellStr(r, CODE_COL)
  const code = /^PR\d{5}$/.test(codeRaw) ? codeRaw : null
  let p = code ? byCode.get(code) : null
  if (!p) p = byUniqueName.get(name.toLowerCase().trim()) || null
  if (!p) { unmatched.push({ client, name, code: codeRaw || '(blank)', links: links.map(l => ({ label: l.label, url: l.url })) }); continue }
  const have = new Set((Array.isArray(p.linked_documents) ? p.linked_documents : []).map(docUrl).filter(Boolean).map(normDoc))
  const queued = new Set()
  for (const l of links) {
    const k = normDoc(l.url)
    if (have.has(k) || queued.has(k)) continue
    queued.add(k); perCol[l.col]++
    const entryName = l.text && !/^https?:\/\//.test(l.text) ? l.text : l.label
    if (!missingByProject.has(p.project_code)) missingByProject.set(p.project_code, { id: p.id, name: p.project_name, add: [] })
    missingByProject.get(p.project_code).add.push({ label: l.label, name: entryName, url: l.url })
  }
}

const totalMissing = [...missingByProject.values()].reduce((n, p) => n + p.add.length, 0)
console.log('=== DOC/SHEET LINK DIFF (sheet -> SOCC), hyperlinks resolved ===')
console.log('cols:', COLS.map(c => `${c}:${LABELS[c]}`).join(' | '), APPLY ? '  [APPLY]' : '  [dry run]')
console.log('rows scanned:', rowsScanned, '| rows with >=1 link:', rowsWithLinks, '| DB projects:', db.length)
console.log('projects with missing links:', missingByProject.size, '| total missing links:', totalMissing)
console.log('missing per column:', Object.entries(perCol).map(([c, n]) => `${LABELS[c]}=${n}`).join(' | '))
console.log('link rows that matched NO live project:', unmatched.length)

const out = { generatedFor: COLS, projects: [...missingByProject.entries()].map(([code, v]) => ({ code, id: v.id, name: v.name, add: v.add })), unmatched }
fs.writeFileSync(path.join(dir, '_link-diff.json'), JSON.stringify(out, null, 2))
console.log('wrote scripts/_link-diff.json')
console.log('\n=== sample (first 12 projects) ===')
for (const p of out.projects.slice(0, 12)) { console.log(`${p.code}  ${p.name}  (+${p.add.length})`); for (const a of p.add) console.log(`    [${a.label}] "${a.name}" -> ${a.url.slice(0, 75)}`) }
if (unmatched.length) { console.log('\n=== unmatched link rows (no live project) ==='); unmatched.forEach(u => console.log(`- ${u.client} | ${u.name} | code ${u.code} (${u.links.length} link(s))`)) }

if (APPLY) {
  console.log('\n=== APPLYING ===')
  let patched = 0, added = 0
  for (const [, v] of missingByProject) {
    const p = db.find(x => x.id === v.id)
    const cur = Array.isArray(p.linked_documents) ? [...p.linked_documents] : []
    for (const a of v.add) { cur.push({ name: a.name, url: a.url }); added++ }
    await rest('PATCH', `survey_projects?id=eq.${v.id}`, { linked_documents: cur })
    patched++
  }
  console.log(`applied: ${patched} projects patched, ${added} links attached`)
}

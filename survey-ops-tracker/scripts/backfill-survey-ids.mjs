/**
 * Backfill survey_tool_id from David's assignment workbook, so the Campaign
 * Manager import can find the remaining 36 surveys.
 *
 *   node scripts/backfill-survey-ids.mjs <workbook.xlsx>
 *   node scripts/backfill-survey-ids.mjs <workbook.xlsx> --apply
 *
 * DRY RUN BY DEFAULT.
 *
 * APPENDS, NEVER OVERWRITES. Seven of the target projects already carry a survey
 * id, and a project legitimately has several — PR00202 takes eight, because the
 * Coatue AI runs field a buyer survey and a seller survey across US, UK, AU and
 * India. Replacing the column would delete an id that is already matching blasts.
 *
 * REFUSES an id that is already on a DIFFERENT project. That is exactly the
 * ambiguity that put PR00003 and PR00202 in the report last time, and it should
 * fail loudly rather than create a second one.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const file = process.argv[2]
const APPLY = process.argv.includes('--apply')
if (!file) { console.error('usage: node scripts/backfill-survey-ids.mjs <workbook.xlsx> [--apply]'); process.exit(1) }

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })

/* PR00034's own evidence, added here rather than left to a second pass.
   Its recorded id is PII_BFCOPRIMARY202606 — a COLORADO id on a MAINE project,
   and one that appears nowhere in the Campaign Manager export. The Maine poll's
   real B2B id is B2B_BFMEPRIMARY202060608: audience "Maine Voters", campaign
   "Maine Primary Poll", two blasts on 2026-06-08 totalling 303 completes,
   against PR00034's window of 06-06 to 06-09 and its 325 collected. The wrong
   id is left in place rather than deleted — it may be a real PureSpectrum arm
   with CO typed for ME, which is David's call, not this script's. */
const EXTRA = [{ 'survey id': 'B2B_BFMEPRIMARY202060608', study: 'Maine Primary DO', 'Project Id': 'PR00034' }]

const assignments = [...rows, ...EXTRA]
  .map(r => ({ id: String(r['survey id']).trim(), study: String(r.study ?? '').trim(), code: String(r['Project Id']).trim() }))
  .filter(a => a.id && /^PR\d+$/.test(a.code))

const unassigned = [...rows]
  .map(r => ({ id: String(r['survey id']).trim(), study: String(r.study ?? '').trim(), code: String(r['Project Id']).trim() }))
  .filter(a => a.id && !/^PR\d+$/.test(a.code))

const { data: all } = await db.from('survey_projects')
  .select('id, project_code, project_name, client, survey_tool_id, survey_ids_from_sheet')
  .is('deleted_at', null)
const byCode = Object.fromEntries(all.map(p => [p.project_code, p]))

/** Where does this survey id already live? */
const owner = new Map()
for (const p of all) {
  for (const raw of [p.survey_tool_id, p.survey_ids_from_sheet]) {
    if (!raw) continue
    for (const x of String(raw).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)) {
      if (!owner.has(x)) owner.set(x, new Set())
      owner.get(x).add(p.project_code)
    }
  }
}

// Group by project so each one is written once, with all its ids.
const plan = new Map()
const problems = [], already = []
for (const a of assignments) {
  const p = byCode[a.code]
  if (!p) { problems.push(`${a.id}: ${a.code} does not exist (or is deleted)`); continue }
  const holders = owner.get(a.id)
  if (holders?.size && !holders.has(a.code)) {
    problems.push(`${a.id} is already on ${[...holders].join(', ')} — refusing to add it to ${a.code} as well`)
    continue
  }
  if (holders?.has(a.code)) { already.push(`${a.code} already has ${a.id}`); continue }
  if (!plan.has(a.code)) {
    const current = String(p.survey_tool_id ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    plan.set(a.code, { p, current, add: [] })
  }
  plan.get(a.code).add.push(a.id)
}

console.log(`${assignments.length} assignments (${rows.length} from the workbook + ${EXTRA.length} inferred)`)
console.log(`  ${plan.size} projects to update, ${already.length} already correct, ${problems.length} problems\n`)

for (const [code, e] of [...plan].sort()) {
  const next = [...e.current, ...e.add]
  console.log(`  ${code}  ${String(e.p.client).slice(0, 18).padEnd(19)} ${String(e.p.project_name).slice(0, 34)}`)
  if (e.current.length) console.log(`      keeps : ${e.current.join(', ')}`)
  console.log(`      adds  : ${e.add.join(', ')}`)
  console.log(`      result: ${next.join(', ')}`)
}

if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}) — these are skipped:`)
  for (const p of problems) console.log('  ! ' + p)
}
if (unassigned.length) {
  console.log(`\nNOT ASSIGNED in the workbook (${unassigned.length}) — no project created, nothing written:`)
  for (const u of unassigned) console.log(`  ${u.id.padEnd(30)} ${u.study}  → "${u.code}"`)
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0) }

console.log('\napplying…')
let n = 0
for (const [code, e] of plan) {
  const next = [...e.current, ...e.add].join(', ')
  const { error } = await db.from('survey_projects').update({ survey_tool_id: next }).eq('id', e.p.id)
  if (error) console.error(`  FAILED ${code}: ${error.message}`)
  else { n++; console.log(`  ${code} -> ${next}`) }
}
console.log(`\nupdated ${n} of ${plan.size} projects. Re-run the blast import to pick them up.`)

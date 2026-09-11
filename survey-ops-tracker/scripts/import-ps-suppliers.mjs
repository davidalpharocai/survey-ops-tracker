/**
 * Bulk-import PureSpectrum supplier rows (panel cost) from a PS export into SOCC.
 *
 *   node scripts/import-ps-suppliers.mjs <file.csv>            # dry run + report
 *   node scripts/import-ps-suppliers.mjs <file.csv> --apply    # writes
 *   node scripts/import-ps-suppliers.mjs <file.csv> --report out.md
 *
 * DRY RUN BY DEFAULT.
 *
 * WHY THIS EXISTS. Panel spend was almost entirely unrecorded: 143 fielded PS
 * projects had delivered 116,240 cleaned N with ZERO cost attached, so SOCC's
 * spend total was 91% blast purely because blast was the only route anyone
 * logged. Every route comparison, margin figure and cost-per-complete built on
 * that was wrong in the same direction — panel looked nearly free.
 *
 * THE GRAIN. A PureSpectrum survey instance (`ps_survey_id`) is a SOCC LAUNCH;
 * each of its supplier rows is a `project_suppliers` row under that launch. The
 * export's (ps_survey_id, supplier_id) pairs are unique — measured, 0 duplicates
 * across 1,958 rows — which lines up exactly with 061's
 * `unique (launch_id, supplier_id)`. One project legitimately has 15 launches.
 *
 * WHAT IT WILL NOT DO
 *   * Guess a project. `ar_survey_id` must resolve to exactly one project via
 *     survey_tool_id / survey_ids_from_sheet. No match or several: reported and
 *     skipped, nothing created.
 *   * Touch a project that ALREADY has supplier rows. Eight do, and all eight are
 *     the same PureSpectrum data entered by hand — five match the export to the
 *     dollar, three are stale because someone entered them mid-field. Appending
 *     would double-count every one of them, and silently adopting them needs a
 *     launch-to-launch mapping the export does not carry. They are listed for
 *     review instead. That is the whole reason this import is safe to run.
 *   * Invent a supplier silently. Names not already in `suppliers` are created,
 *     and each creation is named in the report.
 *
 * IDEMPOTENT. A launch is found by its ps_survey_id, which this writes into the
 * launch label as `PS <id>`; a supplier row is found by (launch_id, supplier_id).
 * A second run updates in place and inserts nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const file = process.argv[2]
const APPLY = process.argv.includes('--apply')
const reportIdx = process.argv.indexOf('--report')
const reportPath = reportIdx > -1 ? process.argv[reportIdx + 1] : null
if (!file) {
  console.error('usage: node scripts/import-ps-suppliers.mjs <file.csv> [--apply] [--report out.md]')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/* ---------------------------------------------------------------- csv */
function splitLine(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur); return out
}
const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim())
const head = splitLine(lines[0])
const rows = lines.slice(1).map(l => Object.fromEntries(splitLine(l).map((v, i) => [head[i], v])))

const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0 }
/** US m/d/yyyy -> ISO, because that is what the export emits. */
const isoDate = v => {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`
}
const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ------------------------------------------------------------ resolve */
const { data: projects, error: pErr } = await db.from('survey_projects')
  .select('id, project_code, project_name, client, project_type, survey_tool_id, survey_ids_from_sheet, actual_spend, n_actual, n_collected')
  .is('deleted_at', null)
if (pErr) { console.error('projects:', pErr.message); process.exit(1) }

const idIndex = new Map()
for (const p of projects) {
  const ids = new Set([p.survey_tool_id, p.survey_ids_from_sheet].filter(Boolean)
    .flatMap(x => String(x).split(/[,;\s]+/)).map(x => x.trim()).filter(Boolean))
  for (const id of ids) {
    if (!idIndex.has(id)) idIndex.set(id, new Map())
    idIndex.get(id).set(p.id, p)
  }
}

const pageAll = async (table) => {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data); if (data.length < 1000) return out
  }
}
const existingSuppliers = await pageAll('project_suppliers')
const existingLaunches = await pageAll('project_launches')
const { data: supplierRows } = await db.from('suppliers').select('*')

const supByProject = {}
for (const s of existingSuppliers) (supByProject[s.project_id] ??= []).push(s)
const launchByProject = {}
for (const l of existingLaunches) (launchByProject[l.project_id] ??= []).push(l)
const supplierByName = new Map(supplierRows.map(s => [s.name.trim().toLowerCase(), s]))

/* --------------------------------------------------------------- plan */
const plan = {
  create: [],          // { project, psId, rows }  — launches + supplier rows to write
  newSuppliers: [],    // supplier names absent from `suppliers`
  skipUnmatched: [],   // ar_survey_id resolves to no project
  skipAmbiguous: [],   // ...or to several
  skipHasRows: [],     // project already carries hand-entered supplier rows
}

const byProjectPs = new Map()   // project_id -> Map(ps_survey_id -> rows[])
for (const r of rows) {
  const key = String(r.ar_survey_id ?? '').trim()
  const hit = key ? idIndex.get(key) : null
  if (!hit || hit.size === 0) { plan.skipUnmatched.push(r); continue }
  if (hit.size > 1) { plan.skipAmbiguous.push({ r, hits: [...hit.values()] }); continue }
  const p = [...hit.values()][0]
  if ((supByProject[p.id] ?? []).length) { plan.skipHasRows.push({ r, p }); continue }
  if (!byProjectPs.has(p.id)) byProjectPs.set(p.id, { p, launches: new Map() })
  const e = byProjectPs.get(p.id)
  if (!e.launches.has(r.ps_survey_id)) e.launches.set(r.ps_survey_id, [])
  e.launches.get(r.ps_survey_id).push(r)
}

const wantedSupplierNames = new Set()
for (const { launches } of byProjectPs.values())
  for (const rs of launches.values())
    for (const r of rs) { const n = String(r.supplier_name ?? '').trim(); if (n) wantedSupplierNames.add(n) }
for (const n of [...wantedSupplierNames].sort())
  if (!supplierByName.has(n.toLowerCase())) plan.newSuppliers.push(n)

let addSpend = 0, addRows = 0, addLaunches = 0
for (const { p, launches } of byProjectPs.values()) {
  const entry = { p, launches: [] }
  for (const [psId, rs] of launches) {
    const spend = rs.reduce((t, r) => t + num(r.supplier_cpi) * num(r.n_collected), 0)
    const n = rs.reduce((t, r) => t + num(r.n_collected), 0)
    entry.launches.push({ psId, rs, spend, n, date: isoDate(rs[0].launch_date), goal: num(rs[0].completes_goal) })
    addSpend += spend; addRows += rs.length; addLaunches++
  }
  entry.spend = entry.launches.reduce((t, l) => t + l.spend, 0)
  entry.n = entry.launches.reduce((t, l) => t + l.n, 0)
  plan.create.push(entry)
}
plan.create.sort((a, b) => b.spend - a.spend)

/* ------------------------------------------------------------- report */
const out = []
const say = s => { out.push(s); console.log(s) }
say(`# PureSpectrum supplier import — ${APPLY ? 'APPLYING' : 'DRY RUN'}`)
say(`source: ${file.split(/[\\/]/).pop()}`)
say('')
say('## Rows')
say(`- ${rows.length} rows read across ${new Set(rows.map(r => r.ps_survey_id)).size} PureSpectrum surveys`)
say(`- resolved to one project, importable: **${addRows}** rows in **${addLaunches}** launches across **${plan.create.length}** projects`)
say(`- **already has hand-entered rows** — left alone: ${plan.skipHasRows.length} rows across ${new Set(plan.skipHasRows.map(x => x.p.project_code)).size} projects`)
say(`- **unmatched** (no project carries the ar_survey_id): ${plan.skipUnmatched.length} rows across ${new Set(plan.skipUnmatched.map(r => r.ar_survey_id)).size} surveys`)
say(`- **ambiguous** (id maps to >1 project): ${plan.skipAmbiguous.length} rows`)
say('')
say('## Spend this adds')
say(`- Σ(cpi × n_collected) over the importable rows: **${money(addSpend)}**`)
say('')

if (plan.newSuppliers.length) {
  say(`## Suppliers to create (${plan.newSuppliers.length})`)
  say('Present in the export, absent from `suppliers`. Created rather than dropped, so their cost is not silently lost.')
  for (const n of plan.newSuppliers) say(`- \`${n}\``)
  say('')
}

if (plan.skipHasRows.length) {
  say('## Left alone — already carries hand-entered supplier rows')
  say('These are the SAME PureSpectrum data someone already typed in. Five match the export to the dollar; three are stale because they were entered mid-field. Appending would double-count, and adopting needs a launch-to-launch mapping the export does not carry. Review by hand.')
  say('')
  say('| project | client | in SOCC | in export |')
  say('|---|---|---:|---:|')
  const grouped = {}
  for (const { r, p } of plan.skipHasRows) {
    ;(grouped[p.project_code] ??= { p, spend: 0 }).spend += num(r.supplier_cpi) * num(r.n_collected)
  }
  for (const [code, g] of Object.entries(grouped).sort((a, b) => b[1].spend - a[1].spend)) {
    const soc = (supByProject[g.p.id] ?? []).reduce((t, s) => t + Number(s.cpi ?? 0) * Number(s.n_collected ?? 0), 0)
    say(`| ${code} | ${g.p.client} | ${money(soc)} | ${money(g.spend)} |`)
  }
  say('')
}

if (plan.skipUnmatched.length) {
  say('## Unmatched — set the survey id on the right project and re-run')
  const g = {}
  for (const r of plan.skipUnmatched) {
    ;(g[r.ar_survey_id] ??= { title: r.survey_title, clients: r.clients, n: 0, spend: 0 })
    g[r.ar_survey_id].n += num(r.n_collected)
    g[r.ar_survey_id].spend += num(r.supplier_cpi) * num(r.n_collected)
  }
  say('')
  say('| ar_survey_id | title | client | N | spend |')
  say('|---|---|---|---:|---:|')
  for (const [id, x] of Object.entries(g).sort((a, b) => b[1].spend - a[1].spend).slice(0, 25))
    say(`| \`${id}\` | ${String(x.title).slice(0, 34)} | ${String(x.clients).slice(0, 22)} | ${x.n} | ${money(x.spend)} |`)
  const total = Object.values(g).reduce((t, x) => t + x.spend, 0)
  say('')
  say(`Total unmatched spend: **${money(total)}** across ${Object.keys(g).length} surveys.`)
  say('')
}

say('## What this run writes')
say('')
say('| project | client | launches | rows | N | spend | spend now |')
say('|---|---|---:|---:|---:|---:|---:|')
for (const e of plan.create.slice(0, 60))
  say(`| ${e.p.project_code} | ${String(e.p.client).slice(0, 20)} | ${e.launches.length} | ${e.launches.reduce((t, l) => t + l.rs.length, 0)} | ${e.n} | ${money(e.spend)} | ${e.p.actual_spend == null ? '(none)' : money(e.p.actual_spend)} |`)
if (plan.create.length > 60) say(`| …and ${plan.create.length - 60} more | | | | | | |`)

if (reportPath) { writeFileSync(reportPath, out.join('\n')); console.log(`\nreport -> ${reportPath}`) }
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0) }

/* -------------------------------------------------------------- apply */
console.log('\napplying…')
for (const name of plan.newSuppliers) {
  const { data, error } = await db.from('suppliers').insert({ name, active: true }).select('*').single()
  if (error) { console.error(`  supplier "${name}" FAILED: ${error.message}`); continue }
  supplierByName.set(name.toLowerCase(), data)
  console.log(`  + supplier ${name}`)
}

let nL = 0, nS = 0, nU = 0, err = 0
for (const e of plan.create) {
  const mine = launchByProject[e.p.id] ?? []
  for (const l of e.launches) {
    const label = `PS ${l.psId}`
    let launch = mine.find(x => String(x.label ?? '').includes(l.psId))
    if (!launch) {
      const { data, error } = await db.from('project_launches')
        .insert({ project_id: e.p.id, label, launch_date: l.date, target: l.goal || null })
        .select('*').single()
      if (error) { console.error(`  launch ${e.p.project_code}/${label} FAILED: ${error.message}`); err++; continue }
      launch = data; mine.push(data); nL++
    }
    for (const r of l.rs) {
      const sup = supplierByName.get(String(r.supplier_name ?? '').trim().toLowerCase())
      if (!sup) { console.error(`  ${e.p.project_code}: unknown supplier "${r.supplier_name}"`); err++; continue }
      const fields = {
        project_id: e.p.id,
        launch_id: launch.id,
        supplier_id: sup.id,
        cpi: num(r.supplier_cpi),
        completes_cap: num(r.supplier_completes_goal),
        n_collected: num(r.n_collected),
      }
      const prior = existingSuppliers.find(x => x.launch_id === launch.id && x.supplier_id === sup.id)
      if (prior) {
        const { error } = await db.from('project_suppliers').update(fields).eq('id', prior.id)
        if (error) { console.error(`  update FAILED: ${error.message}`); err++ } else nU++
      } else {
        const { error } = await db.from('project_suppliers').insert(fields)
        if (error) { console.error(`  insert ${e.p.project_code}/${r.supplier_name} FAILED: ${error.message}`); err++ } else nS++
      }
    }
  }
}
console.log(`\ncreated ${nL} launches, inserted ${nS} supplier rows, updated ${nU}${err ? `, ${err} FAILED` : ''}`)

/* Verify against the database rather than trusting the plan. */
const after = await pageAll('project_suppliers')
console.log(`project_suppliers now: ${after.length} rows (was ${existingSuppliers.length})`)
const { data: tot } = await db.from('survey_projects').select('actual_spend').is('deleted_at', null)
console.log(`portfolio actual_spend: ${money(tot.reduce((t, p) => t + Number(p.actual_spend ?? 0), 0))}`)

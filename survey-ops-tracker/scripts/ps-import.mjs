#!/usr/bin/env node
/**
 * ps-import.mjs — load a PureSpectrum "Buyer Surveys" export into SOCC.
 *
 *   node scripts/ps-import.mjs <file|dir> [more…] [--apply] [--json] [--yes]
 *
 * Accepts .zip or .csv, any number of them, in any order, including ones that
 * overlap each other or a previous run. Reports everything it would do and
 * writes NOTHING unless --apply is passed.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * PureSpectrum bills per respondent. The export has one row per respondent, so
 * N collected is a COUNT and spend is a SUM of the actual per-respondent prices
 * — not a reported figure and not `CPI × count`. That makes it strictly better
 * than the supplier PDF, and it is the intended input here.
 *
 * ── THE SIX RULES THIS ENCODES ──────────────────────────────────────────────
 * Each was learned by nearly getting it wrong on real data. Do not remove one
 * without reading why it is there.
 *
 * 1. DEDUPE ON `Transaction ID`, NEWER FILE WINS.
 *    It is globally unique (60,678 rows -> 60,678 distinct). Overlapping pulls
 *    are therefore safe. "Newer wins" is not just tidiness: two respondents were
 *    non-complete in one export and Complete in a later one, because the status
 *    settled after the first export ran.
 *
 * 2. ONLY `Complete` COUNTS.
 *    A typical pull is 54% Buyer_Termination and 10% drops. Anything else in the
 *    status column is ignored, and any status this script has never seen before
 *    is REPORTED rather than silently bucketed.
 *
 * 3. A LAUNCH CAN COVER MANY SURVEY#s.
 *    PureSpectrum spawns a new Survey# for every relaunch and top-up. The PDF
 *    importer rolls them into one launch and names only the first few in the
 *    note ("29 PureSpectrum surveys rolled up … and 23 more"). So a project
 *    whose notes admit UNNAMED roll-ups cannot be matched by Survey# at all, and
 *    is refused. On PR00426 that refusal is the difference between leaving a
 *    reconciled project alone and inventing 62 duplicate launches.
 *
 * 4. AN EXPORT IS A WINDOW, SO REVISE UPWARD ONLY.
 *    A launch that began before the export's start date is under-counted by it —
 *    PR00435's 52314233 holds 299 in SOCC and a 09-14 export sees 120 of them.
 *    The export is evidence of a floor, never of a ceiling.
 *
 * 5. `survey_tool_id` IS A COMMA-SEPARATED LIST.
 *    Never equality-match the column; split it. Matching it whole hid 22 studies
 *    once.
 *
 * 6. A SEGMENTED PROJECT'S n_collected IS OWNED BY A TRIGGER.
 *    sync_segment_totals() recomputes it as the sum of the segments on every
 *    segment write, so a figure written to the parent reverts the next time
 *    anyone edits a segment. Those projects get the write AND a note saying the
 *    segments were not raised with it, so the number moving back is explainable.
 *
 * ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
 * A launch is labelled with its PS Survey#. Re-running over the same or an
 * overlapping export therefore matches the existing launch and revises it
 * upward, rather than creating a second one. Running twice is safe.
 *
 * Exit code 0 = clean, 1 = something needs a human (see the FOLLOW-UP section).
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

/* ── arguments ─────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const JSON_OUT = argv.includes('--json')
const flagVal = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null }
// State lets a scheduled run report only what CHANGED. It is a convenience, not
// a safety mechanism: correctness comes from diffing against SOCC itself, so
// deleting this file costs a noisier summary and nothing else.
// fileURLToPath, not URL.pathname: on Windows the latter yields
// /C:/Users/david/Claude%20Code%20Projects/... and the %20 makes the write fail.
const STATE = flagVal('--state') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.ps-import-state.json')
const inputs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--state')
if (!inputs.length) {
  console.error('usage: node scripts/ps-import.mjs <file|dir> [more…] [--apply] [--json] [--state <path>]')
  process.exit(2)
}

const log = (...a) => { if (!JSON_OUT) console.log(...a) }
const warn = (...a) => { if (!JSON_OUT) console.log(...a) }
const report = { files: [], rows: 0, completes: 0, surveys: 0, created: 0, raised: 0, nRaised: 0, followUp: [], delta: null }

let prevState = null
try { prevState = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { /* first run */ }

/* ── 1. read every input, tolerating zip or csv ────────────────────────── */

/** Minimal ZIP reader: central directory -> stored/deflated entries. Avoids a
 *  dependency, and the export is a plain zip with no encryption. */
function unzip(buf) {
  const out = []
  let eocd = buf.length - 22
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory)')
  let n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  while (n-- > 0) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const cmtLen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const lNameLen = buf.readUInt16LE(lho + 26)
    const lExtraLen = buf.readUInt16LE(lho + 28)
    const start = lho + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + csize)
    out.push({ name, data: method === 0 ? raw : zlib.inflateRawSync(raw) })
    p += 46 + nameLen + extraLen + cmtLen
  }
  return out
}

/** RFC4180 CSV. The export quotes fields containing commas (project names,
 *  user agents), so splitting on ',' silently corrupts the row. */
function parseCsv(text) {
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  if (!rows.length) return []
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim())
  return rows.filter(r => r.length >= head.length - 1)
             .map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])))
}

/** Resolve a column by any of several spellings, ignoring case, spaces and
 *  punctuation — so "Respondent Buyer CPI", "respondent_buyer_cpi" and
 *  "RespondentBuyerCPI" all land. PureSpectrum has renamed columns before. */
const key = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')
function resolver(sample) {
  const map = new Map(Object.keys(sample).map(k => [key(k), k]))
  return (...names) => {
    for (const n of names) { const hit = map.get(key(n)); if (hit) return hit }
    return null
  }
}

function expand(p) {
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    return fs.readdirSync(p).filter(f => /\.(zip|csv)$/i.test(f)).map(f => path.join(p, f))
  }
  return [p]
}

const files = inputs.flatMap(expand)
  // oldest first by mtime, so a later file's row wins on conflict (rule 1)
  .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
if (!files.length) { console.error('no .zip or .csv found in the given paths'); process.exit(2) }

const byTx = new Map()
let COL = null
for (const f of files) {
  const buf = fs.readFileSync(f)
  const parts = /\.zip$/i.test(f) ? unzip(buf) : [{ name: path.basename(f), data: buf }]
  let n = 0
  for (const part of parts) {
    if (!/\.csv$/i.test(part.name)) continue
    const rows = parseCsv(part.data.toString('utf8'))
    if (!rows.length) continue
    if (!COL) {
      const r = resolver(rows[0])
      COL = {
        tx: r('Transaction ID', 'TransactionID', 'transaction_id'),
        survey: r('Survey ID', 'SurveyID', 'survey_id', 'Survey #', 'Survey Number'),
        project: r('Project Name', 'ProjectName', 'project_name', 'Survey Name'),
        status: r('Respondent Status Description', 'Status Description', 'Respondent Status', 'status'),
        cpi: r('Respondent Buyer CPI', 'Buyer CPI', 'Respondent CPI', 'CPI'),
        expCpi: r('Expected Buyer CPI', 'Expected CPI'),
        supplier: r('Supplier Name', 'SupplierName', 'supplier_name', 'Supplier'),
        country: r('Survey Country', 'Country'),
        entry: r('PS Entry DateTime (Pacific Time Zone)', 'PS Entry DateTime', 'Entry DateTime', 'PS Entry Date'),
      }
      const missing = ['tx', 'survey', 'status', 'supplier'].filter(k => !COL[k])
      if (missing.length) {
        console.error(`FATAL: the export is missing required column(s): ${missing.join(', ')}`)
        console.error(`columns present: ${Object.keys(rows[0]).join(' | ')}`)
        process.exit(2)
      }
      if (!COL.cpi) warn('WARNING: no per-respondent CPI column found — spend cannot be computed from this file.')
    }
    for (const row of rows) { if (row[COL.tx]) byTx.set(row[COL.tx], row) }
    n += rows.length
  }
  report.files.push({ file: path.basename(f), rows: n })
  log(`read ${path.basename(f)}: ${n.toLocaleString('en-US')} rows`)
}
report.rows = byTx.size
log(`\nunion after dedupe on ${COL.tx}: ${byTx.size.toLocaleString('en-US')} distinct transactions`)

/* ── 2. filter to completes, aggregate per Survey# ─────────────────────── */
const STATUS_COMPLETE = 'complete'
const seenStatus = new Map()
for (const r of byTx.values()) {
  const s = String(r[COL.status] ?? '').trim()
  seenStatus.set(s, (seenStatus.get(s) ?? 0) + 1)
}
const completes = [...byTx.values()].filter(r => String(r[COL.status] ?? '').trim().toLowerCase() === STATUS_COMPLETE)
report.completes = completes.length
log(`completes: ${completes.length.toLocaleString('en-US')}`)
// Rule 2: an unrecognised status is surfaced, never silently dropped.
const KNOWN = /^(complete|buyer_termination|buyer_drop|ps_drop|ps_.*_fail|buyer_side_in_progress|ps_side_in_progress|buyer_hash_security|ps_blacklist.*)$/i
const odd = [...seenStatus].filter(([s]) => s && !KNOWN.test(s))
if (odd.length) {
  warn(`\nNOTE: status value(s) this script has not seen before — none are being counted as completes:`)
  for (const [s, n] of odd) warn(`   ${n.toLocaleString('en-US')}  "${s}"`)
  report.followUp.push(`unrecognised respondent status: ${odd.map(([s]) => s).join(', ')}`)
}

const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0 }
const agg = new Map()
for (const r of completes) {
  const sid = String(r[COL.survey]).trim()
  if (!sid) continue
  let g = agg.get(sid)
  if (!g) agg.set(sid, g = {
    survey_id: sid, project_name: String(r[COL.project] ?? '').trim(),
    country: String(r[COL.country] ?? '').trim(), completes: 0, usd: 0,
    sup: new Map(), dates: [],
  })
  g.completes++
  const cpi = COL.cpi ? num(r[COL.cpi]) : 0
  g.usd += cpi
  const sn = String(r[COL.supplier] ?? '').trim() || '(unnamed supplier)'
  let s = g.sup.get(sn)
  if (!s) g.sup.set(sn, s = { name: sn, n: 0, usd: 0, cpis: new Set() })
  s.n++; s.usd += cpi; s.cpis.add(Math.round(cpi * 10000))
  const d = String(r[COL.entry] ?? '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) g.dates.push(d)
}
for (const g of agg.values()) {
  g.usd = Math.round(g.usd * 100) / 100
  g.first = g.dates.length ? g.dates.reduce((a, b) => a < b ? a : b) : null
  g.suppliers = [...g.sup.values()].map(s => ({
    name: s.name, n: s.n, usd: Math.round(s.usd * 100) / 100,
    // SOCC stores ONE cpi per supplier row. A supplier's per-respondent price
    // can genuinely vary inside one survey, so store the effective rate and say
    // so in the note rather than pretending there was a single price.
    cpi: s.n ? Math.round((s.usd / s.n) * 10000) / 10000 : 0,
    mixed: s.cpis.size > 1,
  })).sort((a, b) => b.n - a.n)
  delete g.sup; delete g.dates
}
report.surveys = agg.size
log(`${agg.size} distinct Survey#s, $${[...agg.values()].reduce((t, g) => t + g.usd, 0).toFixed(2)}`)

/* ── 2b. what moved since the last run ─────────────────────────────────── */
// A 7-day window re-exports most of what the previous run already saw, so the
// useful summary is the DELTA, not the total. Compared per Survey#, because a
// survey that gains completes between runs is the normal case.
const nowState = {}
for (const g of agg.values()) nowState[g.survey_id] = { n: g.completes, usd: g.usd }
if (prevState?.surveys) {
  const p = prevState.surveys
  const brandNew = [], grew = [], same = []
  for (const [sid, cur] of Object.entries(nowState)) {
    const old = p[sid]
    if (!old) brandNew.push(sid)
    else if (cur.n !== old.n || Math.abs(cur.usd - old.usd) > 0.005) grew.push({ sid, from: old.n, to: cur.n })
    else same.push(sid)
  }
  const gone = Object.keys(p).filter(s => !nowState[s])
  report.delta = {
    since: prevState.ranAt ?? null,
    newSurveys: brandNew.length, changedSurveys: grew.length, unchanged: same.length,
    droppedFromWindow: gone.length,
    newCompletes: brandNew.reduce((t, s) => t + nowState[s].n, 0),
    addedToExisting: grew.reduce((t, x) => t + (x.to - x.from), 0),
  }
  log(`\nSINCE LAST RUN (${prevState.ranAt ?? 'unknown'}):`)
  log(`  ${brandNew.length} new Survey#s (${report.delta.newCompletes} completes), ` +
      `${grew.length} changed (${report.delta.addedToExisting >= 0 ? '+' : ''}${report.delta.addedToExisting} completes), ` +
      `${same.length} unchanged, ${gone.length} no longer in the window`)
  for (const x of grew.slice(0, 10)) log(`    ${x.sid}: ${x.from} -> ${x.to}`)
} else {
  log(`\n(no previous run recorded at ${STATE} — reporting everything as new)`)
}

/* ── 3. SOCC state ─────────────────────────────────────────────────────── */
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ACTOR = 'purespectrum import (scheduled)'
const page = async (t, s) => {
  let o = [], f = 0
  for (;;) {
    const { data, error } = await sb.from(t).select(s).order('id').range(f, f + 999)
    if (error) throw new Error(`${t}: ${error.message}`)
    o = o.concat(data); if (data.length < 1000) break; f += 1000
  }
  return o
}
const projects = (await page('survey_projects',
  'id,project_code,project_name,survey_tool_id,n_collected,segment_count,deleted_at')).filter(p => !p.deleted_at)
const launches = await page('project_launches', 'id,project_id,label,note')
const suppliers = await page('project_suppliers', 'id,project_id,launch_id,supplier_id,cpi,n_collected')
const supTable = await page('suppliers', 'id,name')
const segments = await page('project_segments', 'project_id,label,n_collected')
const projById = Object.fromEntries(projects.map(p => [p.id, p]))

// Rule 3: a project whose launch notes admit UNNAMED roll-ups cannot be matched
// by Survey#, because the Survey#s it already covers are not all written down.
const unsafe = new Set()
for (const l of launches) {
  const note = String(l.note ?? '')
  const claim = /(\d+)\s+PureSpectrum surveys rolled up/i.exec(note)
  if (!claim) continue
  const named = [...note.matchAll(/\b\d{6,}\b/g)].length
  if (Number(claim[1]) > named) unsafe.add(l.project_id)
}

const normLabel = s => String(s ?? '').trim().replace(/^PS\s+/i, '')
const coveredBy = new Map()           // Survey# -> launch
for (const l of launches) {
  const ids = new Set()
  const lab = normLabel(l.label)
  if (/^\d{6,}$/.test(lab)) ids.add(lab)
  for (const m of String(l.note ?? '').matchAll(/\b(\d{6,})\b/g)) ids.add(m[1])
  for (const id of ids) if (!coveredBy.has(id)) coveredBy.set(id, l)
}
// Rule 5: split the list, never match the column whole.
const byToolId = new Map()
for (const p of projects) {
  for (const raw of String(p.survey_tool_id ?? '').split(',')) {
    const k = raw.trim().toLowerCase()
    if (!k) continue
    const m = byToolId.get(k) ?? byToolId.set(k, new Map()).get(k)
    m.set(p.id, p)
  }
}
const rowsByLaunch = {}
for (const s of suppliers) if (s.launch_id) (rowsByLaunch[s.launch_id] ??= []).push(s)

/* ── 4. plan ───────────────────────────────────────────────────────────── */
const plan = { raise: [], create: [], blocked: [], orphan: [] }
for (const g of agg.values()) {
  const l = coveredBy.get(g.survey_id)
  if (l) {
    const rows = rowsByLaunch[l.id] ?? []
    const soccN = rows.reduce((t, x) => t + num(x.n_collected), 0)
    // Rule 4: upward only.
    if (g.completes > soccN) plan.raise.push({ g, launch: l, project: projById[l.project_id], soccN })
    continue
  }
  const hit = byToolId.get(String(g.project_name).trim().toLowerCase())
  if (hit && hit.size === 1) {
    const p = [...hit.values()][0]
    if (unsafe.has(p.id)) plan.blocked.push({ g, project: p })   // rule 3
    else plan.create.push({ g, project: p })
    continue
  }
  plan.orphan.push(g)
}

const money = xs => xs.reduce((t, x) => t + x.g.usd, 0)
log(`\nPLAN`)
log(`  ${plan.raise.length} existing launch(es) to revise upward`)
log(`  ${plan.create.length} launch(es) to create   (+${plan.create.reduce((t, x) => t + x.g.completes, 0)} N, +$${money(plan.create).toFixed(2)})`)
log(`  ${plan.blocked.length} refused on roll-up projects  (${plan.blocked.reduce((t, x) => t + x.g.completes, 0)} N, $${money(plan.blocked).toFixed(2)})`)
log(`  ${plan.orphan.length} Survey#(s) with no project`)

if (plan.create.length) {
  const per = {}
  for (const c of plan.create) { const v = (per[c.project.project_code] ??= { n: 0, usd: 0, k: 0 }); v.n += c.g.completes; v.usd += c.g.usd; v.k++ }
  log(`\n  new launches by project:`)
  for (const [code, v] of Object.entries(per).sort((a, b) => b[1].usd - a[1].usd))
    log(`    ${code}  ${String(v.k).padStart(3)} launches  +${String(v.n).padStart(6)} N  +$${v.usd.toFixed(2).padStart(10)}`)
}
if (plan.blocked.length) {
  const codes = [...new Set(plan.blocked.map(b => b.project.project_code))]
  warn(`\n  REFUSED — these projects roll several PS Survey#s into one launch and do not name them all,`)
  warn(`  so a Survey# that looks absent is probably already counted: ${codes.join(', ')}`)
  report.followUp.push(`roll-up projects skipped: ${codes.join(', ')}`)
}
if (plan.orphan.length) {
  const byName = {}
  for (const g of plan.orphan) { const v = (byName[g.project_name] ??= { k: 0, n: 0, usd: 0 }); v.k++; v.n += g.completes; v.usd += g.usd }
  warn(`\n  NO PROJECT — add the name to a project's Survey/Template ID to resolve these:`)
  for (const [n, v] of Object.entries(byName).sort((a, b) => b[1].n - a[1].n).slice(0, 25))
    warn(`    ${String(n || '(blank)').slice(0, 54).padEnd(56)} ${String(v.k).padStart(3)} ids  ${String(v.n).padStart(6)} N  $${v.usd.toFixed(2)}`)
  report.followUp.push(`${plan.orphan.length} Survey#s map to no project (${Object.keys(byName).length} names)`)
}

if (!APPLY) {
  log(`\nDRY RUN — nothing written. Re-run with --apply.`)
  if (JSON_OUT) console.log(JSON.stringify({ ...report, applied: false }, null, 1))
  process.exit(report.followUp.length ? 1 : 0)
}

/* ── 5. write ──────────────────────────────────────────────────────────── */
const supIdByName = new Map(supTable.map(s => [String(s.name).trim().toLowerCase(), s.id]))
async function supplierId(name) {
  const k = String(name).trim().toLowerCase()
  if (supIdByName.has(k)) return supIdByName.get(k)
  const { data, error } = await sb.from('suppliers').insert({ name: String(name).trim(), created_by: 'ps-import' }).select('id').single()
  if (error) throw new Error(`supplier "${name}": ${error.message}`)
  supIdByName.set(k, data.id)
  return data.id
}
const noteFor = g =>
  `${g.project_name}${g.country ? ' · ' + g.country : ''} · PureSpectrum Survey# ${g.survey_id} · ` +
  `${g.completes} completes, $${g.usd.toFixed(2)}. Imported from the PureSpectrum Buyer Surveys export` +
  (g.suppliers.some(s => s.mixed)
    ? '; a supplier’s per-respondent CPI varied within this survey, so its stored rate is the effective spend ÷ N.'
    : '.')

for (const r of plan.raise) {
  const rows = rowsByLaunch[r.launch.id] ?? []
  const have = new Map(rows.map(x => [x.supplier_id, x]))
  for (const s of r.g.suppliers) {
    const sid = await supplierId(s.name)
    const cur = have.get(sid)
    if (cur) {
      if (s.n > num(cur.n_collected)) {
        const { error } = await sb.from('project_suppliers').update({ n_collected: s.n, cpi: s.cpi }).eq('id', cur.id)
        if (error) throw new Error(`raise ${r.launch.label}: ${error.message}`)
      }
    } else {
      const { error } = await sb.from('project_suppliers').insert({
        project_id: r.launch.project_id, launch_id: r.launch.id, supplier_id: sid,
        cpi: s.cpi, completes_cap: 0, n_collected: s.n, created_by: 'ps-import',
      })
      if (error) throw new Error(`raise ${r.launch.label}: ${error.message}`)
    }
  }
  report.raised++
  log(`  raised ${r.project.project_code} ${r.launch.label}: ${r.soccN} -> ${r.g.completes}`)
}

for (const c of plan.create) {
  const g = c.g
  const ids = []
  for (const s of g.suppliers) ids.push(await supplierId(s.name))
  const { data: launch, error } = await sb.from('project_launches').insert({
    project_id: c.project.id, label: g.survey_id, launch_date: g.first, target: null,
    note: noteFor(g), created_by: 'ps-import',
  }).select('id').single()
  if (error) { warn(`  FAILED create ${g.survey_id}: ${error.message}`); report.followUp.push(`create ${g.survey_id} failed`); continue }
  const rows = g.suppliers.map((s, i) => ({
    project_id: c.project.id, launch_id: launch.id, supplier_id: ids[i],
    cpi: s.cpi, completes_cap: 0, n_collected: s.n, created_by: 'ps-import',
  }))
  const { error: se } = await sb.from('project_suppliers').insert(rows)
  if (se) {
    await sb.from('project_launches').delete().eq('id', launch.id)   // no orphan launch
    warn(`  FAILED suppliers ${g.survey_id}: ${se.message}`); report.followUp.push(`suppliers ${g.survey_id} failed`); continue
  }
  report.created++
}
log(`\nwrote ${report.created} launch(es), revised ${report.raised}`)

/* ── 6. reconcile n_collected to the fielding record ───────────────────── */
const fresh = {
  projects: (await page('survey_projects', 'id,project_code,project_name,n_collected,segment_count,deleted_at')).filter(p => !p.deleted_at),
  blasts: await page('project_blasts', 'project_id,completes'),
  suppliers: await page('project_suppliers', 'project_id,n_collected,cpi'),
}
const sourced = {}
for (const b of fresh.blasts) sourced[b.project_id] = (sourced[b.project_id] ?? 0) + num(b.completes)
for (const s of fresh.suppliers) sourced[s.project_id] = (sourced[s.project_id] ?? 0) + num(s.n_collected)
const segOf = {}
for (const s of segments) (segOf[s.project_id] ??= []).push(s)

let nUp = 0
for (const p of fresh.projects) {
  const src = sourced[p.id] ?? 0
  if (src <= 0 || num(p.n_collected) >= src) continue      // upward only
  const { data, error } = await sb.rpc('mcp_write_project', {
    p_id: p.id, p_patch: { n_collected: src }, p_actor: ACTOR, p_expected_updated_at: null,
  })
  if (error) { warn(`  n_collected ${p.project_code}: ${error.message}`); continue }
  if (num(data.n_collected) !== src) { warn(`  n_collected ${p.project_code} did not take`); continue }
  nUp++
  // Rule 6: a segmented project's figure is trigger-owned, so say so on the project.
  if ((p.segment_count ?? 0) > 0 && segOf[p.id]) {
    const segs = segOf[p.id]
    const segSum = segs.reduce((t, x) => t + num(x.n_collected), 0)
    await sb.from('project_data_changes').insert({
      project_id: p.id, created_by: 'ps-import',
      text: `N COLLECTED RECONCILED TO THE FIELDING RECORD: raised to ${src.toLocaleString('en-US')} from the blasts and PureSpectrum launches on record.\n\n` +
        `THE SEGMENTS WERE NOT UPDATED — they sum to ${segSum.toLocaleString('en-US')} ` +
        `(${segs.map(s => `${s.label} ${num(s.n_collected).toLocaleString('en-US')}`).join('; ')}), and nothing in the fielding ` +
        `record says how the difference divides between them.\n\n` +
        `A trigger keeps a segmented project's n_collected equal to the sum of its segments and re-runs whenever a segment is edited, ` +
        `so ${src.toLocaleString('en-US')} will revert to ${segSum.toLocaleString('en-US')} the next time one is touched. ` +
        `If that happens, ${src.toLocaleString('en-US')} is the figure the fielding record supports — put the difference on the right segment.`,
    })
  }
}
report.nRaised = nUp
log(`reconciled n_collected on ${nUp} project(s)`)

/* ── 7. verify ─────────────────────────────────────────────────────────── */
const touched = [...new Set([...plan.create.map(c => c.project.id), ...plan.raise.map(r => r.launch.project_id)])]
let mismatch = 0
for (const id of touched) {
  const { data: p } = await sb.from('survey_projects').select('project_code,actual_spend').eq('id', id).single()
  const { data: rows } = await sb.from('project_suppliers').select('cpi,n_collected').eq('project_id', id)
  const calc = (rows ?? []).reduce((t, x) => t + num(x.cpi) * num(x.n_collected), 0)
  // Only comparable when suppliers are the project's only cost source; a blast
  // or cost line legitimately makes actual_spend larger, never smaller.
  if (calc - num(p.actual_spend) > 0.02) {
    warn(`  ${p.project_code}: supplier spend $${calc.toFixed(2)} EXCEEDS actual_spend $${num(p.actual_spend).toFixed(2)} — the recompute trigger may not have fired`)
    report.followUp.push(`${p.project_code} spend did not recompute`)
    mismatch++
  }
}
log(mismatch ? `\n${mismatch} project(s) whose spend did not recompute` : `\nspend recomputed correctly on all ${touched.length} project(s) touched`)

/* ── 8. remember this run, so the next one can report only the delta ───── */
// Written only after a successful --apply: if the run failed, the next one
// should still see the previous baseline and re-report the same work.
try {
  fs.writeFileSync(STATE, JSON.stringify({
    ranAt: new Date().toISOString(),
    files: report.files.map(f => f.file),
    created: report.created, raised: report.raised, nRaised: report.nRaised,
    surveys: nowState,
  }, null, 1))
  log(`state written to ${STATE}`)
} catch (e) {
  warn(`could not write state (${e.message}) — the next run will report everything as new`)
}

/* ── the one-line summary a scheduler can forward ──────────────────────── */
const d = report.delta
report.summary =
  `PureSpectrum import: ${report.completes.toLocaleString('en-US')} completes across ${report.surveys} surveys` +
  (d ? `; ${d.newSurveys} new surveys and ${d.addedToExisting >= 0 ? '+' : ''}${d.addedToExisting} completes on existing ones since the last run` : '') +
  `. Wrote ${report.created} launch(es), revised ${report.raised}, reconciled N on ${report.nRaised} project(s)` +
  (report.followUp.length ? `. NEEDS ATTENTION: ${report.followUp.length} item(s).` : '. Nothing needs attention.')
log(`\n${report.summary}`)

if (report.followUp.length) {
  warn(`\nFOLLOW-UP NEEDED:`)
  for (const f of report.followUp) warn(`  · ${f}`)
}
if (JSON_OUT) console.log(JSON.stringify({ ...report, applied: true }, null, 1))
process.exit(report.followUp.length ? 1 : 0)

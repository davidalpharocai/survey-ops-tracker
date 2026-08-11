/*
 * One-time Rerun_DS → rerun_series seed + dedup cross-check.
 * (docs/superpowers/plans/2026-08-10-rerun-update.md Task 9)
 *
 * DRY RUN by default: reads the Rerun_DS tab of the Survey Ops workbook, maps
 * each row to a rerun_series candidate, cross-checks it against existing
 * rerun_series (so re-running is safe) AND against live survey_projects (to
 * find the wave-1 origin to link), and prints a per-candidate report. Writes
 * NOTHING without --apply.
 *
 *   node scripts/seed-rerun-series.mjs --xlsx "<path to Survey Ops (N).xlsx>"
 *   node scripts/seed-rerun-series.mjs --xlsx "..." --apply     # creates confirmed rows
 *
 * Design (per the plan's v2 addendum):
 *  - unique key (client_id, lower(survey_name)) → re-runnable upsert-safe.
 *  - base_type must be 'PS' or 'B2B' (check constraint); anything else
 *    ('Rerun Service', blank, ...) → NEEDS-DECISION, never guessed.
 *  - seeded series: service_mode='auto' but auto_armed=FALSE, so the first
 *    wave after this load is a MANUAL push (David reviews) before auto kicks in.
 *  - linking an origin project sets series_id + origin_project_id AND clears
 *    longitudinal on the whole legacy lineage so the legacy spawn path can't
 *    also fire; next_wave_no = max(existing rerun_number)+1.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
XLSX.set_fs(fs)

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const xlsxPath = (() => {
  const i = args.indexOf('--xlsx')
  return i >= 0 ? args[i + 1] : null
})()
if (!xlsxPath) {
  console.error('Usage: node scripts/seed-rerun-series.mjs --xlsx "<path to Survey Ops (N).xlsx>" [--apply]')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---- helpers -------------------------------------------------------------
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s*-\s*\d+(st|nd|rd|th)\s+rerun\s*$/i, '')
    .replace(/\s*-\s*wave\s*\d+\s*$/i, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

function cadenceMonths(raw) {
  const s = String(raw || '').toLowerCase().trim()
  if (!s || /ad.?hoc|one.?off|as needed/.test(s)) return { months: null, ok: true, adhoc: true }
  if (/month/.test(s)) return { months: 1, ok: true }
  if (/quarter/.test(s)) return { months: 3, ok: true }
  if (/semi|every\s*6|6\s*mo|bi.?annual/.test(s)) return { months: 6, ok: true }
  if (/year|annual/.test(s)) return { months: 12, ok: true }
  return { months: null, ok: false, raw: s } // unknown (e.g. weekly) → decision
}

function baseTypeOf(raw) {
  const s = String(raw || '').trim().toUpperCase()
  if (s === 'PS') return { base_type: 'PS', rerun_service: false, decision: false }
  if (s === 'B2B') return { base_type: 'B2B', rerun_service: false, decision: false }
  // "Rerun Service" → blank base type + rerun_service tag (classify PS/B2B later, per David).
  if (s === 'RERUN SERVICE' || s === 'RERUN') return { base_type: null, rerun_service: true, decision: false }
  return { base_type: null, rerun_service: false, decision: true } // blank / unknown → decision
}

function excelDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// ---- load Rerun_DS -------------------------------------------------------
const wb = XLSX.readFile(xlsxPath, { cellDates: true })
const tabName = wb.SheetNames.find((n) => /rerun/i.test(n) && /ds/i.test(n)) || wb.SheetNames.find((n) => /rerun/i.test(n))
if (!tabName) {
  console.error('No Rerun_DS tab found. Tabs:', wb.SheetNames.join(', '))
  process.exit(1)
}
const rows = XLSX.utils.sheet_to_json(wb.Sheets[tabName], { header: 1, defval: '' }).slice(1) // drop header
// Column indices (from the Rerun_DS header):
// 0 Client | 1 Survey Name | 2 Wave#(next) | 3 base type | 4 Rerun Cadence |
// 5 Fielding Start | 6 Last Delivery | 7 Delivery Cadence | 8 In Rerun/Manual |
// 9 Template Id | 10 Notes | 11 NOTE TO SELF | 12 IGNORE | 13 DATA QA Note
const candidates = rows
  .filter((r) => String(r[0] || '').trim() || String(r[1] || '').trim())
  .map((r, i) => ({
    rowNo: i + 2,
    client: String(r[0] || '').trim(),
    survey_name: String(r[1] || '').trim(),
    base_type_raw: String(r[3] || '').trim(),
    cadence_raw: String(r[4] || '').trim(),
    anchor_date: excelDate(r[5]),
    last_delivery: excelDate(r[6]),
    delivery_cadence: String(r[7] || '').trim() || null,
    service_hint: String(r[8] || '').trim(),
    template_id: String(r[9] || '').trim() || null,
    notes: String(r[10] || '').trim() || null,
    data_qa_note: String(r[13] || '').trim() || null,
  }))

// ---- load existing state -------------------------------------------------
const [{ data: clients }, { data: existingSeries }, { data: projects }] = await Promise.all([
  db.from('clients').select('id, name').is('deleted_at', null),
  db.from('rerun_series').select('id, client, client_id, survey_name'),
  db
    .from('survey_projects')
    .select('id, project_code, project_name, client, client_id, project_type, rerun_number, series_id, rerun_series_id, longitudinal, launch_date, deliver_date, created_at')
    .is('deleted_at', null),
])

function resolveClient(name) {
  const n = norm(name)
  if (!n) return null
  // exact-ish first, then contains either way (short codes like "BAM" vs "BAM Capital")
  let hit = (clients || []).find((c) => norm(c.name) === n)
  if (hit) return hit
  const partial = (clients || []).filter((c) => norm(c.name).includes(n) || n.includes(norm(c.name)))
  if (partial.length === 1) return partial[0]
  if (partial.length > 1) return { ambiguous: partial.map((c) => ({ id: c.id, name: c.name })) }
  return null
}

// ---- classify each candidate --------------------------------------------
const report = []
for (const c of candidates) {
  const client = resolveClient(c.client)
  const bt = baseTypeOf(c.base_type_raw)
  const cad = cadenceMonths(c.cadence_raw)
  const decisions = []
  if (!client) decisions.push(`CLIENT-UNMATCHED ("${c.client}")`)
  else if (client.ambiguous) decisions.push(`CLIENT-AMBIGUOUS (${client.ambiguous.map((x) => x.name).join(' | ')})`)
  if (bt.decision) decisions.push(`BASE-TYPE ("${c.base_type_raw || 'blank'}" → pick PS or B2B)`)
  if (!cad.ok) decisions.push(`CADENCE ("${c.cadence_raw}" → months?)`)

  const clientId = client && !client.ambiguous ? client.id : null

  // Already seeded? (client_id + normalized survey_name)
  const already = (existingSeries || []).find(
    (s) => (clientId ? s.client_id === clientId : norm(s.client) === norm(c.client)) && norm(s.survey_name) === norm(c.survey_name)
  )

  // Candidate origin projects: same client + survey-name signal.
  const surveyN = norm(c.survey_name)
  const origins = (projects || []).filter((p) => {
    const clientMatch = clientId ? p.client_id === clientId : norm(p.client) === norm(c.client)
    if (!clientMatch) return false
    const pn = norm(p.project_name)
    return pn === surveyN || pn.includes(surveyN) || surveyN.includes(pn) || pn.includes(`${norm(c.client)} ${surveyN}`.trim())
  })
  // Prefer the earliest wave (wave 1 / lowest rerun_number / oldest) as origin.
  origins.sort((a, b) => (a.rerun_number ?? 1) - (b.rerun_number ?? 1) || String(a.created_at).localeCompare(String(b.created_at)))

  let action
  if (already) action = 'ALREADY-SEEDED (skip)'
  else if (decisions.length) action = 'NEEDS-DECISION'
  else if (origins.length === 0) action = 'CREATE (no origin project found — series will have no wave 1 to link)'
  else if (origins.length === 1) action = 'CREATE + link origin'
  else action = `CREATE + link origin (MULTIPLE candidates — confirm which: ${origins.map((o) => o.project_code).join(', ')})`

  report.push({ c, client, clientId, bt, cad, already, origins, decisions, action })
}

// ---- print report --------------------------------------------------------
console.log(`\n=== Rerun_DS seed dry-run — ${candidates.length} rows from "${tabName}" ===`)
console.log(`(clients in DB: ${clients?.length ?? 0}, existing rerun_series: ${existingSeries?.length ?? 0}, live projects: ${projects?.length ?? 0})\n`)
const tally = {}
for (const r of report) {
  const key = r.action.split(' ')[0]
  tally[key] = (tally[key] || 0) + 1
}
for (let i = 0; i < report.length; i++) {
  const r = report[i]
  const c = r.c
  console.log(`${String(i + 1).padStart(2)}. [${r.action}]`)
  console.log(`     ${c.client} — ${c.survey_name}`)
  const baseLabel = r.bt.decision ? `(${c.base_type_raw || 'blank'}?)` : r.bt.rerun_service ? 'Rerun Service (tag, base blank)' : r.bt.base_type
  console.log(
    `     base=${baseLabel}  cadence=${r.cad.ok ? (r.cad.adhoc ? 'ad-hoc' : r.cad.months + 'mo') : `(${c.cadence_raw}?)`}  delivery="${c.delivery_cadence ?? '—'}"  sheet-mode=${c.service_hint || '—'}  anchor=${c.anchor_date ?? '—'}`
  )
  if (c.template_id) console.log(`     template=${c.template_id.replace(/\s+/g, ' ').slice(0, 80)}`)
  console.log(`     client_id=${r.clientId ?? (r.client?.ambiguous ? 'AMBIGUOUS' : 'UNMATCHED')}`)
  if (r.origins.length) console.log(`     origin candidates: ${r.origins.map((o) => `${o.project_code}${o.series_id ? '(already in a series!)' : ''} "${o.project_name}"`).join(' | ')}`)
  if (r.decisions.length) console.log(`     ⚠ DECISIONS: ${r.decisions.join('; ')}`)
  console.log('')
}
console.log('=== TALLY ===')
for (const [k, v] of Object.entries(tally)) console.log(`  ${k}: ${v}`)
console.log('')

if (!APPLY) {
  console.log('DRY RUN — nothing written. Review above, then re-run with --apply (after resolving DECISIONS).')
  process.exit(0)
}

// ---- APPLY (only unambiguous CREATE rows) --------------------------------
console.log('APPLY MODE — creating unambiguous CREATE rows (skipping ALREADY-SEEDED and NEEDS-DECISION)...\n')
let created = 0
for (const r of report) {
  if (r.already || r.decisions.length || !r.clientId) continue
  const c = r.c
  const origin = r.origins[0] ?? null
  const maxWave = r.origins.reduce((m, o) => Math.max(m, o.rerun_number ?? 1), 0)
  const insert = {
    client: c.client,
    client_id: r.clientId,
    survey_name: c.survey_name,
    base_type: r.bt.base_type,
    rerun_service: r.bt.rerun_service,
    origin_project_id: origin?.id ?? null,
    cadence_months: r.cad.months,
    delivery_cadence: c.delivery_cadence,
    in_service: true,
    service_mode: 'auto',
    auto_armed: false, // manual first wave post-load (David reviews), then arms
    paused: false,
    template_id: c.template_id,
    owner_email: 'sreerag@alpharoc.ai',
    next_wave_no: (maxWave || 1) + 1,
    anchor_date: c.anchor_date,
    notes: c.notes,
    data_qa_note: c.data_qa_note,
  }
  const { data: series, error } = await db.from('rerun_series').insert(insert).select('id').single()
  if (error) {
    console.error(`  ✗ ${c.client} — ${c.survey_name}: ${error.message}`)
    continue
  }
  // Link + reconcile the whole legacy lineage of the origin.
  if (origin) {
    const root = origin.rerun_series_id ?? origin.id
    await db
      .from('survey_projects')
      .update({ series_id: series.id, longitudinal: false })
      .or(`id.eq.${root},rerun_series_id.eq.${root}`)
      .is('deleted_at', null)
  }
  created++
  console.log(`  ✓ ${c.client} — ${c.survey_name} (series ${series.id}${origin ? `, linked ${origin.project_code}` : ''})`)
}
console.log(`\nCreated ${created} series.`)

/*
 * Rerun_DS seed — APPLY with David's per-row decisions (Task 9).
 * Reads David's reviewed workbook (Rerun_DS_review_DS.xlsx) for the base fields
 * and applies the DECISIONS map below (his written calls). DRY RUN by default.
 *
 *   node scripts/apply-rerun-seed.mjs --xlsx "<path to Rerun_DS_review_DS.xlsx>"
 *   node scripts/apply-rerun-seed.mjs --xlsx "..." --apply     # writes to prod (needs migration 074)
 *
 * Seed rules: service_mode 'auto' + auto_armed=FALSE (first post-load wave is a
 * manual push David reviews, then it arms); linked lineages get series_id +
 * longitudinal=false so the legacy spawn path can't also fire; "Rerun Service"
 * rows → base_type null + rerun_service=true; "first known wave" rows get a
 * series note that the tracked history isn't the true original.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const xlsxPath = (() => { const i = args.indexOf('--xlsx'); return i >= 0 ? args[i + 1] : null })()
if (!xlsxPath) { console.error('Usage: node scripts/apply-rerun-seed.mjs --xlsx "<Rerun_DS_review_DS.xlsx>" [--apply]'); process.exit(1) }

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const FIRST_KNOWN = 'First tracked wave is the first KNOWN wave, not the original — earlier waves predate the tracker.'
// Keyed by a distinctive lowercase substring of the Survey Name in David's file.
// action: create | skip. origin: explicit PR to link as Wave 1 (else auto-dedup for non-firstKnown).
// rs: base_type blank + Rerun Service tag. mode: 'manual' (default auto). client: override client name.
// firstKnown: no origin link, add the "not original" note. survey: rename the created series.
const DECISIONS = [
  { m: 'nova', firstKnown: true },
  { m: 'bain ai tracker', firstKnown: true },
  { m: 'chatgpt new question', firstKnown: true },
  { m: '242 questions', skip: true },                                   // JPM — skip
  { m: 'smart glasses', rs: true, firstKnown: true },
  { m: 'monthly study february', rs: true, firstKnown: true },          // APCIA
  { m: 'rerun tracker', rs: true, firstKnown: true },                   // SEMA
  { m: 'candidate to push', origin: 'PR00306', mode: 'manual', survey: 'National Independent Awareness Barometer', note: 'Rerun only when the client asks — manual mode (no auto-spawn).' }, // Junction.AI
  { m: 'pos study', firstKnown: true },                                 // BAM POS Study B2B
  { m: 'hinge voter study', client: 'HingeVoter/Carah' },
  { m: 'attitudes to employ', skip: true },                             // Chamber — skip
  { m: 'newark satisfaction', origin: 'PR00097' },
  { m: 'tiktok trend', skip: true },
  { m: 'mattress firm' },                                               // dedup lineage
  { m: 'delivery and mobility', client: 'BNP', origin: 'PR00093' },
  { m: 'national hingevoter', client: 'HingeVoter/Carah' },
  { m: 'stanley black' },
  { m: 'online travel', client: 'BNP', origin: 'PR00274' },
  { m: 'ai infrastructure' },                                           // Coatue
  { m: 'freight trucking' },
  { m: 'bioprocessing' },
  { m: 'large research institution' },
  { m: 'foodservice' },
  { m: 'gas station', rs: true, firstKnown: true },                     // Aventail
  { m: 'consumer study' },                                              // BAM (green)
  { m: 'prediction market' },
  { m: 'chatgpt follow' },
  { m: 'wealth manager' },
  { m: 'used electronics' },
]

const norm = (s) => String(s || '').toLowerCase().replace(/\s*-\s*\d+(st|nd|rd|th)\s+rerun\s*$/i, '').replace(/\s*-\s*wave\s*\d+\s*$/i, '').replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
// Series name = base survey name without a trailing wave/rerun suffix.
const baseRerun = (s) => String(s || '').replace(/\s*-\s*\d+(st|nd|rd|th)\s+rerun\s*$/i, '').replace(/\s*-\s*wave\s*\d+\s*$/i, '').trim()
const cadMonths = (raw) => { const s = String(raw || '').toLowerCase(); if (/month/.test(s)) return 1; if (/quarter/.test(s)) return 3; if (/semi|every\s*6/.test(s)) return 6; if (/year|annual/.test(s)) return 12; return null }
const baseTypeOf = (raw) => { const s = String(raw || '').trim().toUpperCase(); if (s === 'PS') return { bt: 'PS', rs: false }; if (s === 'B2B') return { bt: 'B2B', rs: false }; if (s.includes('RERUN')) return { bt: null, rs: true }; return { bt: null, rs: false } }
const excelDate = (v) => { if (v == null || v === '') return null; if (v instanceof Date) return v.toISOString().slice(0, 10); const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10) }

const wb = XLSX.read(readFileSync(xlsxPath), { cellDates: true, type: 'buffer' })
const sn = wb.SheetNames.find((n) => /review/i.test(n)) || wb.SheetNames[0]
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '' }).slice(1).filter((r) => String(r[0] || '').trim() || String(r[1] || '').trim())

const [{ data: clients }, { data: projects }] = await Promise.all([
  db.from('clients').select('id, name').is('deleted_at', null),
  db.from('survey_projects').select('id, project_code, project_name, client, client_id, rerun_number, series_id, rerun_series_id, created_at').is('deleted_at', null),
])
const clientByName = (name) => {
  const n = norm(name); if (!n) return null
  return (clients || []).find((c) => norm(c.name) === n) || (clients || []).find((c) => norm(c.name).includes(n) || n.includes(norm(c.name))) || null
}
const prByCode = (code) => (projects || []).find((p) => p.project_code === code)

const plan = []
for (const r of rows) {
  const sheetClient = String(r[0] || '').trim(), survey = String(r[1] || '').trim()
  const d = DECISIONS.find((x) => norm(survey).includes(norm(x.m)) || norm(x.m).includes(norm(survey).slice(0, 20)))
  if (!d) { plan.push({ survey, sheetClient, err: 'NO DECISION MATCH' }); continue }
  if (d.skip) { plan.push({ survey, sheetClient, skip: true }); continue }
  const clientName = d.client || sheetClient
  const client = clientByName(clientName)
  const { bt, rs } = d.rs ? { bt: null, rs: true } : baseTypeOf(r[3])
  const cadence = cadMonths(r[4])
  // origin resolution
  let origin = null, lineage = []
  if (d.origin) {
    origin = prByCode(d.origin) || null
    if (origin) { const root = origin.rerun_series_id ?? origin.id; lineage = (projects || []).filter((p) => p.id === root || p.rerun_series_id === root) }
  } else if (!d.firstKnown && client) {
    const sN = norm(survey)
    lineage = (projects || []).filter((p) => p.client_id === client.id && (norm(p.project_name) === sN || norm(p.project_name).includes(sN) || sN.includes(norm(p.project_name))))
    lineage.sort((a, b) => (a.rerun_number ?? 1) - (b.rerun_number ?? 1) || String(a.created_at).localeCompare(String(b.created_at)))
    origin = lineage[0] ?? null
  }
  const notes = [d.note, d.firstKnown ? FIRST_KNOWN : null].filter(Boolean).join(' ') || null
  plan.push({
    survey: baseRerun(d.survey || survey), sheetClient, clientName: client?.name ?? clientName, client_id: client?.id ?? null, clientMissing: !client,
    base_type: bt, rerun_service: rs, cadence_months: cadence, mode: d.mode || 'auto',
    delivery_cadence: String(r[7] || '').trim() || null, template_id: String(r[9] || '').trim() || null,
    anchor_date: excelDate(r[5]), data_qa_note: String(r[13] || '').trim() || null, notes,
    origin, lineageCount: lineage.length, maxWave: lineage.reduce((m, o) => Math.max(m, o.rerun_number ?? 1), 0),
  })
}

// ---- report ----
console.log(`\n=== APPLY PLAN (${APPLY ? 'LIVE' : 'DRY RUN'}) — ${plan.length} rows ===\n`)
let n = 0
for (const p of plan) {
  n++
  if (p.err) { console.log(`${n}. ⚠ ${p.sheetClient} — ${p.survey}: ${p.err}`); continue }
  if (p.skip) { console.log(`${n}. ⏭  SKIP  ${p.sheetClient} — ${p.survey}`); continue }
  const base = p.rerun_service ? 'Rerun Service (blank base)' : p.base_type ?? '(no base)'
  const org = p.origin ? `link ${p.origin.project_code}${p.lineageCount > 1 ? ` (+${p.lineageCount - 1} more waves)` : ''}` : (p.notes && p.notes.includes('KNOWN')) ? 'bare — first known wave (not original)' : 'bare (no origin)'
  console.log(`${n}. CREATE  ${p.clientName} — ${p.survey}`)
  console.log(`     ${base} · ${p.cadence_months ? p.cadence_months + 'mo' : 'ad-hoc'} · mode=${p.mode} · ${org}${p.clientMissing ? '  ⚠ CLIENT NOT FOUND' : ''}`)
  if (p.notes) console.log(`     note: ${p.notes}`)
}
const creates = plan.filter((p) => !p.skip && !p.err)
const skips = plan.filter((p) => p.skip)
const missing = creates.filter((p) => p.clientMissing)
console.log(`\n=== ${creates.length} create · ${skips.length} skip · ${missing.length} client-missing ===`)
if (missing.length) console.log('  ⚠ missing clients: ' + missing.map((p) => p.clientName).join(', '))

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply after migration 074.'); process.exit(0) }

// ---- APPLY ----
if (missing.length) { console.error('\nABORT: some clients not found — resolve first.'); process.exit(1) }
console.log('\nAPPLYING...\n')
let created = 0
for (const p of creates) {
  const insert = {
    client: p.clientName, client_id: p.client_id, survey_name: p.survey, base_type: p.base_type, rerun_service: p.rerun_service,
    origin_project_id: p.origin?.id ?? null, cadence_months: p.cadence_months, delivery_cadence: p.delivery_cadence,
    in_service: true, service_mode: p.mode, auto_armed: false, paused: false, template_id: p.template_id,
    owner_email: 'sreerag@alpharoc.ai', next_wave_no: (p.maxWave || 1) + 1, anchor_date: p.anchor_date,
    notes: p.notes, data_qa_note: p.data_qa_note,
  }
  const { data: series, error } = await db.from('rerun_series').insert(insert).select('id').single()
  if (error) { console.error(`  ✗ ${p.clientName} — ${p.survey}: ${error.message}`); continue }
  if (p.origin) {
    const root = p.origin.rerun_series_id ?? p.origin.id
    await db.from('survey_projects').update({ series_id: series.id, longitudinal: false }).or(`id.eq.${root},rerun_series_id.eq.${root}`).is('deleted_at', null)
  }
  created++
  console.log(`  ✓ ${p.clientName} — ${p.survey}${p.origin ? ` (linked ${p.origin.project_code})` : ''}`)
}
console.log(`\nCreated ${created} series.`)

/*
 * Placeholder-wave backfill (migration 075).
 *
 *   node scripts/backfill-placeholders.mjs            # DRY RUN (default)
 *   node scripts/backfill-placeholders.mjs --apply    # writes to prod (needs migration 075)
 *
 * A rerun_series seeded from an OLD fielding-start with no intervening waves
 * computes next-due (cadence_anchor + cadence_months) into the PAST, so it reads
 * as "overdue" for a survey that actually already ran. For each such series this
 * fabricates the missed waves as DELIVERED PLACEHOLDER survey_projects on the
 * cadence — the newest placeholder becomes last_on, so the view's effective_next
 * rolls into the future. Placeholders carry no real N/data yet (is_placeholder =
 * true so Sree can find + backfill them). Env-loading + admin client mirror
 * scripts/apply-rerun-seed.mjs.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APPLY = process.argv.slice(2).includes('--apply')

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// Inlined copy of placeholderWaveDates from lib/reruns/placeholders.ts — a plain
// .mjs can't import a .ts, so this is duplicated. SOURCE OF TRUTH is that file;
// keep this identical to it if the stepping logic ever changes.
function placeholderWaveDates(baseISO, cadenceMonths, todayISO) {
  if (!baseISO || !cadenceMonths) return []
  const cursor = new Date(baseISO + 'T00:00:00Z')
  if (isNaN(cursor.getTime())) return []
  const out = []
  for (let i = 0; i < 600; i++) {
    cursor.setUTCMonth(cursor.getUTCMonth() + cadenceMonths)
    const iso = cursor.toISOString().slice(0, 10)
    if (iso <= todayISO) out.push(iso)
    else break
  }
  return out
}

// Anchor "today" to Eastern time so the cadence stepping matches how the app /
// the rerun_series_status view reason about due dates for the team.
const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

// 1. Overdue series (with a cadence) from the computed status view.
const { data: seriesRows, error: sErr } = await db
  .from('rerun_series_status')
  .select('id, client, survey_name, base_type, cadence_months, cadence_anchor, effective_next, is_overdue')
if (sErr) { console.error('Failed to read rerun_series_status:', sErr.message); process.exit(1) }
const overdue = (seriesRows || []).filter((s) => s.is_overdue === true && s.cadence_months != null)

// 2. client_id per series (from the base rerun_series table — the view is scalar
//    status fields; join on id to carry client_id onto each placeholder wave).
const { data: baseRows, error: bErr } = await db.from('rerun_series').select('id, client_id, survey_name')
if (bErr) { console.error('Failed to read rerun_series:', bErr.message); process.exit(1) }
const clientIdById = new Map((baseRows || []).map((r) => [r.id, r.client_id]))

// 3. Current max rerun_number per series (existing, non-deleted waves) so new
//    placeholders number sequentially AFTER them.
const overdueIds = overdue.map((s) => s.id)
const maxWaveById = new Map()
if (overdueIds.length) {
  const { data: waveRows, error: wErr } = await db
    .from('survey_projects')
    .select('series_id, rerun_number')
    .in('series_id', overdueIds)
    .is('deleted_at', null)
  if (wErr) { console.error('Failed to read existing waves:', wErr.message); process.exit(1) }
  for (const w of waveRows || []) {
    if (!w.series_id) continue
    maxWaveById.set(w.series_id, Math.max(maxWaveById.get(w.series_id) ?? 0, w.rerun_number ?? 0))
  }
}

// 4. Plan per series.
const plan = []
for (const s of overdue) {
  const dates = placeholderWaveDates(s.cadence_anchor, s.cadence_months, todayET)
  if (dates.length === 0) continue
  const curMax = maxWaveById.get(s.id) ?? 0
  const startNo = curMax + 1
  const newMax = curMax + dates.length
  const nd = new Date(dates[dates.length - 1] + 'T00:00:00Z')
  nd.setUTCMonth(nd.getUTCMonth() + s.cadence_months)
  const newNextDue = nd.toISOString().slice(0, 10)
  plan.push({ series: s, client_id: clientIdById.get(s.id) ?? null, dates, startNo, newMax, newNextDue })
}

// ---- report ----
console.log(`\n=== PLACEHOLDER BACKFILL (${APPLY ? 'LIVE' : 'DRY RUN'}) — today ${todayET} (America/New_York) ===\n`)
console.log(`${overdue.length} overdue series with a cadence · ${plan.length} need placeholder waves\n`)
let idx = 0
for (const p of plan) {
  idx++
  const s = p.series
  console.log(`${idx}. ${s.client} — ${s.survey_name}`)
  console.log(`     overdue: effective_next ${s.effective_next ?? '—'} · anchor ${s.cadence_anchor ?? '—'} · ${s.cadence_months}mo cadence${p.client_id ? '' : '  ⚠ NO client_id'}`)
  console.log(`     + ${p.dates.length} placeholder wave(s) #${p.startNo}..#${p.newMax}: ${p.dates.join(', ')}`)
  console.log(`     → new next-due ${p.newNextDue} (last placeholder + cadence) · next_wave_no → ${p.newMax + 1}`)
}

const totalPlaceholders = plan.reduce((n, p) => n + p.dates.length, 0)

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Would touch ${plan.length} series and create ${totalPlaceholders} placeholder(s).`)
  console.log('Re-run with --apply after migration 075 is applied.')
  process.exit(0)
}

// ---- APPLY ----
console.log('\nAPPLYING...\n')
let seriesTouched = 0
let placeholdersCreated = 0
for (const p of plan) {
  const s = p.series
  const inserts = p.dates.map((date, k) => ({
    project_name: `${s.survey_name} - Wave ${p.startNo + k}`,
    client: s.client,
    client_id: p.client_id,
    project_type: s.base_type, // may be null (Rerun-Service series carry no base type)
    series_id: s.id,
    rerun_number: p.startNo + k,
    is_placeholder: true,
    board_column: 'Delivery',
    status: 'Closed',
    phase: 'Active',
    stage_doc_programming: true,
    stage_survey_programming: true,
    stage_edwin_qa: true,
    stage_fielding: true,
    stage_data_qa: true,
    stage_delivery: true,
    launch_date: date,
    deliver_date: date,
    delivered_at: date + 'T12:00:00Z',
    rerun_date: date,
    rerun_spawned_at: date + 'T12:00:00Z',
    n_target: null,
    n_collected: null,
    n_actual: null,
    longitudinal: false,
  }))
  const { error: insErr } = await db.from('survey_projects').insert(inserts)
  if (insErr) { console.error(`  ✗ ${s.client} — ${s.survey_name}: ${insErr.message}`); continue }
  const { error: updErr } = await db.from('rerun_series').update({ next_wave_no: p.newMax + 1 }).eq('id', s.id)
  if (updErr) console.error(`  ⚠ ${s.client} — ${s.survey_name}: inserted ${inserts.length}, but next_wave_no update failed: ${updErr.message}`)
  seriesTouched++
  placeholdersCreated += inserts.length
  console.log(`  ✓ ${s.client} — ${s.survey_name}: +${inserts.length} placeholder(s), next_wave_no → ${p.newMax + 1}`)
}
console.log(`\nDone — ${seriesTouched} series touched, ${placeholdersCreated} placeholders created.`)

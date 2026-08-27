/*
 * Remediate rerun series that were seeded with ZERO waves (so they show empty
 * in SOCC and can never spawn via cron — the daily job spawns each wave FROM the
 * previous one, so a series needs at least a Wave 1).
 *
 *   node scripts/fix-zerowave-series.mjs           # DRY RUN (default)
 *   node scripts/fix-zerowave-series.mjs --apply   # writes to prod
 *
 * Plan (per David, 2026-08-12):
 *   - APCIA "…February 2026" (monthly): re-anchor to 2026-02-01 and backfill
 *     monthly placeholder waves Feb 1 … Aug 1 (Waves 1–7).
 *   - Every other zero-wave series: ONE Wave-1 placeholder at its current anchor
 *     (the "first known wave, not necessarily the original" rule from the seed).
 *
 * Safety mirrors scripts/backfill-placeholders.mjs:
 *   - client-name GATE: the survey_projects_sync_client BEFORE-INSERT trigger
 *     upserts clients on client_firm_name(client) with a case-sensitive
 *     `on conflict (name)`. If a series' client text has no exact firm-name match
 *     in `clients`, the insert would SILENTLY CREATE A DUPLICATE client. We
 *     predict that and ABORT before writing anything.
 *   - the newest wave per series is left UNSTAMPED (rerun_spawned_at=null) so
 *     canSpawnNextWave can still produce the next real wave.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const APPLY = process.argv.slice(2).includes('--apply')

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// APCIA's known monthly history (first-of-month, Feb→Aug 2026).
const APCIA_DATES = ['2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']
const APCIA_ANCHOR = '2026-02-01'

// 1. All series + their live wave counts → the zero-wave set.
const { data: series, error: sErr } = await db
  .from('rerun_series')
  .select('id, client, survey_name, base_type, cadence_months, anchor_date, next_wave_no')
if (sErr) { console.error('series err', sErr.message); process.exit(1) }

const { data: waves, error: wErr } = await db
  .from('survey_projects').select('series_id').not('series_id', 'is', null).is('deleted_at', null)
if (wErr) { console.error('waves err', wErr.message); process.exit(1) }
const haveWave = new Set((waves || []).map((w) => w.series_id))
const zero = (series || []).filter((s) => !haveWave.has(s.id))

// 2. Client-name gate (mirror public.client_firm_name + case-sensitive match).
const { data: clientRows, error: cErr } = await db.from('clients').select('name')
if (cErr) { console.error('clients err', cErr.message); process.exit(1) }
const clientNames = new Set((clientRows || []).map((c) => String(c.name || '').trim()))
const firmName = (raw) => String(raw || '').split(' - ')[0].trim()
const clientOk = (raw) => clientNames.has(firmName(raw))

// 3. Build per-series plan.
const isApcia = (s) => firmName(s.client) === 'APCIA'
const plan = zero.map((s) => {
  const dates = isApcia(s) ? APCIA_DATES : [s.anchor_date]
  return { s, dates, reanchor: isApcia(s) ? APCIA_ANCHOR : null, clientOk: clientOk(s.client) }
})

// ---- report ----
console.log(`\n=== ZERO-WAVE SERIES FIX (${APPLY ? 'LIVE' : 'DRY RUN'}) ===\n`)
console.log(`${zero.length} zero-wave series found:\n`)
for (const p of plan) {
  const flag = p.clientOk ? 'client OK' : `⚠ client "${p.s.client}" has NO firm match — insert trigger would CREATE a dup client`
  console.log(`• ${p.s.client} — ${p.s.survey_name}`)
  console.log(`    cadence=${p.s.cadence_months ?? '—'}mo  anchor=${p.s.anchor_date ?? '—'}${p.reanchor ? ` → re-anchor ${p.reanchor}` : ''}`)
  console.log(`    +${p.dates.length} placeholder wave(s): ${p.dates.join(', ')}  ·  next_wave_no → ${p.dates.length + 1}`)
  console.log(`    ${flag}`)
}

const bad = plan.filter((p) => !p.clientOk)
if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Would touch ${plan.length} series, create ${plan.reduce((n, p) => n + p.dates.length, 0)} placeholders.`)
  if (bad.length) console.log(`⚠ ${bad.length} FAIL the client gate — --apply would ABORT.`)
  console.log('Re-run with --apply to write.')
  process.exit(0)
}

// ---- APPLY ----
if (bad.length) {
  console.error(`\nABORT — ${bad.length} series' client has no firm match (would create dup clients):`)
  for (const p of bad) console.error(`  • ${p.s.client}`)
  process.exit(1)
}

console.log('\nAPPLYING…\n')
let touched = 0, created = 0
for (const p of plan) {
  const s = p.s
  const inserts = p.dates.map((date, k) => {
    const isNewest = k === p.dates.length - 1
    return {
      project_name: `${s.survey_name} - Wave ${k + 1}`,
      client: s.client,
      project_type: s.base_type, // may be null (Rerun-Service)
      series_id: s.id,
      rerun_number: k + 1,
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
      rerun_spawned_at: isNewest ? null : date + 'T12:00:00Z',
      n_target: null, n_collected: null, n_actual: null,
      longitudinal: false,
    }
  })
  const { error: insErr } = await db.from('survey_projects').insert(inserts)
  if (insErr) { console.error(`  ✗ ${s.client} — ${s.survey_name}: ${insErr.message}`); continue }
  const patch = { next_wave_no: p.dates.length + 1 }
  if (p.reanchor) patch.anchor_date = p.reanchor
  const { error: updErr } = await db.from('rerun_series').update(patch).eq('id', s.id)
  if (updErr) console.error(`  ⚠ ${s.client} — ${s.survey_name}: inserted ${inserts.length}, but series update failed: ${updErr.message}`)
  touched++; created += inserts.length
  console.log(`  ✓ ${s.client} — ${s.survey_name}: +${inserts.length} placeholder(s)${p.reanchor ? `, anchor → ${p.reanchor}` : ''}, next_wave_no → ${p.dates.length + 1}`)
}
console.log(`\nDone — ${touched} series touched, ${created} placeholders created.`)

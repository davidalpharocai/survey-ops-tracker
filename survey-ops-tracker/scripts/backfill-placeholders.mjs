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

// Inlined copy of lib/reruns/placeholders.ts — a plain .mjs can't import a .ts,
// so addMonthsClampedUTC + placeholderWaveDates are duplicated here. SOURCE OF
// TRUTH is that file; keep this BYTE-IDENTICAL in behavior. Day-of-month is
// clamped to the target month's last day (Jan 31 + 1mo → Feb 28, not Mar 3) to
// match Postgres make_interval, which the rerun_series_status view uses — so a
// 29–31-anchored series can't drift out of step with the view. Each wave is
// computed from the ORIGINAL base (base + i·n) so the 31st is restored wherever
// the month allows (Feb 28, Mar 31, Apr 30, …), exactly like anchor + interval.
function addMonthsClampedUTC(d, n) {
  const day = d.getUTCDate()
  const t = new Date(d)
  t.setUTCDate(1)
  t.setUTCMonth(t.getUTCMonth() + n)
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  t.setUTCDate(Math.min(day, lastDay))
  return t
}
function placeholderWaveDates(baseISO, cadenceMonths, todayISO) {
  if (!baseISO || !cadenceMonths) return []
  const base = new Date(baseISO + 'T00:00:00Z')
  if (isNaN(base.getTime())) return []
  const out = []
  for (let i = 1; i <= 600; i++) {
    const iso = addMonthsClampedUTC(base, cadenceMonths * i).toISOString().slice(0, 10)
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

// 2. Existing client names — a GATE against the survey_projects_sync_client
//    BEFORE-INSERT trigger (migration 035): it ignores any client_id we pass and
//    instead upserts clients on client_firm_name(new.client) = trim(split_part(
//    client,' - ',1)) with a case-sensitive `on conflict (name)`. So if a
//    series' denormalized `client` text has no exact firm-name match here, the
//    trigger SILENTLY CREATES A NEW (duplicate) client as a side effect of the
//    insert. We predict that exactly (same firm-name split, same case-sensitive
//    match) and refuse to write anything if it would happen. (client_id is
//    therefore intentionally NOT set on the inserts — the trigger sets it.)
const { data: clientRows, error: cErr } = await db.from('clients').select('id, name')
if (cErr) { console.error('Failed to read clients:', cErr.message); process.exit(1) }
const clientFirmName = (raw) => String(raw || '').split(' - ')[0].trim() // mirrors public.client_firm_name
const clientNames = new Set((clientRows || []).map((c) => String(c.name || '').trim())) // case-sensitive, as stored
const clientMatches = (raw) => clientNames.has(clientFirmName(raw))

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
  const curMax = maxWaveById.get(s.id) ?? 0
  let dates = placeholderWaveDates(s.cadence_anchor, s.cadence_months, todayET)
  // Bare series (no real Wave 1): treat the anchor / fielding-start date as the
  // first assumed-delivered wave (#1) per David, so prepend it. Series that
  // already have a real Wave 1 (a linked origin) keep only the post-anchor gap.
  if (curMax === 0 && s.cadence_anchor && s.cadence_anchor <= todayET) {
    dates = [s.cadence_anchor, ...dates]
  }
  if (dates.length === 0) continue
  const startNo = curMax + 1
  const newMax = curMax + dates.length
  // Informational new next-due = last placeholder + cadence (clamped, so it
  // matches what the rerun_series_status view will recompute post-backfill).
  const newNextDue = addMonthsClampedUTC(new Date(dates[dates.length - 1] + 'T00:00:00Z'), s.cadence_months)
    .toISOString()
    .slice(0, 10)
  plan.push({ series: s, clientOk: clientMatches(s.client), dates, startNo, newMax, newNextDue })
}

// ---- report ----
console.log(`\n=== PLACEHOLDER BACKFILL (${APPLY ? 'LIVE' : 'DRY RUN'}) — today ${todayET} (America/New_York) ===\n`)
console.log(`${overdue.length} overdue series with a cadence · ${plan.length} need placeholder waves\n`)
let idx = 0
for (const p of plan) {
  idx++
  const s = p.series
  const clientFlag = p.clientOk
    ? 'client check: OK'
    : `⚠ client "${s.client}" has no exact match in clients — insert trigger would CREATE a new client`
  console.log(`${idx}. ${s.client} — ${s.survey_name}`)
  console.log(`     overdue: effective_next ${s.effective_next ?? '—'} · anchor ${s.cadence_anchor ?? '—'} · ${s.cadence_months}mo cadence`)
  console.log(`     ${clientFlag}`)
  console.log(`     + ${p.dates.length} placeholder wave(s) #${p.startNo}..#${p.newMax}: ${p.dates.join(', ')}`)
  console.log(`     → new next-due ${p.newNextDue} (last placeholder + cadence) · next_wave_no → ${p.newMax + 1}`)
}

const totalPlaceholders = plan.reduce((n, p) => n + p.dates.length, 0)
const badClients = plan.filter((p) => !p.clientOk)

if (!APPLY) {
  console.log(`\nDRY RUN — nothing written. Would touch ${plan.length} series and create ${totalPlaceholders} placeholder(s).`)
  if (badClients.length) console.log(`⚠ ${badClients.length} series FAIL the client-name check — --apply would ABORT until resolved.`)
  console.log('Re-run with --apply after migration 075 is applied.')
  process.exit(0)
}

// ---- APPLY ----
// Safety gate: never write rows that would make the sync-client trigger spawn a
// duplicate client. Abort wholesale (before ANY insert) if any series fails.
if (badClients.length) {
  console.error(`\nABORT — ${badClients.length} series' client text has no firm-name match in clients (the insert trigger would create duplicate clients):`)
  for (const p of badClients) console.error(`  • ${p.series.client} — ${p.series.survey_name}`)
  console.error('Resolve the client names (or create the clients) first, then re-run. Nothing was written.')
  process.exit(1)
}

console.log('\nAPPLYING...\n')
let seriesTouched = 0
let placeholdersCreated = 0
for (const p of plan) {
  const s = p.series
  const inserts = p.dates.map((date, k) => {
    // The LAST date is the NEWEST placeholder (highest rerun_number) — the
    // series' current latest wave. It has NOT yet produced a successor, so it
    // must be left UNSTAMPED (rerun_spawned_at: null); otherwise
    // canSpawnNextWave sees a non-null prevWaveSpawnedAt and the series never
    // spawns its next real wave. Only the intermediate placeholders (#1..#k-1),
    // which each already have the next placeholder as their successor, get
    // stamped. (rerun_date / delivered_at / deliver_date / launch_date are the
    // same on every placeholder.)
    const isNewest = k === p.dates.length - 1
    return {
      project_name: `${s.survey_name} - Wave ${p.startNo + k}`,
      client: s.client,
      // client_id intentionally omitted — the survey_projects_sync_client trigger
      // stamps it from client_firm_name(client); the pre-apply gate above proves
      // that resolves to an existing client, so no duplicate is created.
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
      rerun_spawned_at: isNewest ? null : date + 'T12:00:00Z',
      n_target: null,
      n_collected: null,
      n_actual: null,
      longitudinal: false,
    }
  })
  const { error: insErr } = await db.from('survey_projects').insert(inserts)
  if (insErr) { console.error(`  ✗ ${s.client} — ${s.survey_name}: ${insErr.message}`); continue }
  const { error: updErr } = await db.from('rerun_series').update({ next_wave_no: p.newMax + 1 }).eq('id', s.id)
  if (updErr) console.error(`  ⚠ ${s.client} — ${s.survey_name}: inserted ${inserts.length}, but next_wave_no update failed: ${updErr.message}`)
  seriesTouched++
  placeholdersCreated += inserts.length
  console.log(`  ✓ ${s.client} — ${s.survey_name}: +${inserts.length} placeholder(s), next_wave_no → ${p.newMax + 1}`)
}
console.log(`\nDone — ${seriesTouched} series touched, ${placeholdersCreated} placeholders created.`)

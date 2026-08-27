import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. All APCIA projects (waves), including placeholders + soft-deleted.
const { data: projs, error: pErr } = await db
  .from('survey_projects')
  .select('id, project_name, client, project_type, series_id, rerun_number, is_placeholder, board_column, status, launch_date, deliver_date, rerun_date, deleted_at')
  .ilike('client', '%APCIA%')
  .order('launch_date', { ascending: true })
if (pErr) { console.error('projs err', pErr.message); process.exit(1) }

console.log(`\n=== APCIA survey_projects (${projs.length}) ===`)
for (const p of projs) {
  console.log(
    [
      p.project_name,
      `type=${p.project_type}`,
      p.is_placeholder ? 'PLACEHOLDER' : 'real',
      p.deleted_at ? 'DELETED' : 'live',
      `series=${p.series_id ? p.series_id.slice(0, 8) : '—'}`,
      `wave#${p.rerun_number ?? '—'}`,
      `col=${p.board_column}`,
      `launch=${p.launch_date ?? '—'}`,
      `rerun=${p.rerun_date ?? '—'}`,
    ].join('  ')
  )
}

// 2. APCIA rerun_series.
const { data: series, error: sErr } = await db
  .from('rerun_series')
  .select('id, client, survey_name, base_type, cadence_months, anchor_date, in_service, paused, next_wave_no')
  .ilike('client', '%APCIA%')
if (sErr) { console.error('series err', sErr.message); process.exit(1) }
console.log(`\n=== APCIA rerun_series (${series.length}) ===`)
for (const s of series) {
  console.log(`${s.survey_name}  id=${s.id.slice(0,8)}  base=${s.base_type ?? '(service)'}  cadence=${s.cadence_months ?? '—'}mo  anchor=${s.anchor_date ?? '—'}  in_service=${s.in_service}  paused=${s.paused}  next_wave_no=${s.next_wave_no}`)
}

// 3. rerun_series_status view for APCIA (computed next-due).
const { data: status, error: stErr } = await db
  .from('rerun_series_status')
  .select('id, survey_name, cadence_anchor, last_on, effective_next, is_overdue, cadence_months')
  .ilike('client', '%APCIA%')
if (stErr) { console.error('status err', stErr.message) }
else {
  console.log(`\n=== APCIA rerun_series_status (${status.length}) ===`)
  for (const s of status) {
    console.log(`${s.survey_name}  anchor=${s.cadence_anchor ?? '—'}  last_on=${s.last_on ?? '—'}  next=${s.effective_next ?? '—'}  overdue=${s.is_overdue}`)
  }
}

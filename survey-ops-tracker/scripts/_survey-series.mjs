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

// All series (status view has computed fields).
const { data: series } = await db
  .from('rerun_series_status')
  .select('id, client, survey_name, base_type, cadence_months, cadence_anchor, last_on, effective_next, is_overdue, in_service, paused')
  .order('client', { ascending: true })

// Wave counts per series (live, non-deleted), split real vs placeholder.
const { data: waves } = await db
  .from('survey_projects')
  .select('series_id, is_placeholder')
  .not('series_id', 'is', null)
  .is('deleted_at', null)

const cnt = new Map()
for (const w of waves || []) {
  const c = cnt.get(w.series_id) || { real: 0, ph: 0 }
  if (w.is_placeholder) c.ph++; else c.real++
  cnt.set(w.series_id, c)
}

console.log(`\n=== ${series.length} rerun_series — wave counts + backfill status ===\n`)
let zeroWave = 0, zeroWaveWithCadence = 0
for (const s of series) {
  const c = cnt.get(s.id) || { real: 0, ph: 0 }
  const total = c.real + c.ph
  const flag = total === 0 ? '  ⚠ ZERO WAVES' : ''
  if (total === 0) { zeroWave++; if (s.cadence_months != null) zeroWaveWithCadence++ }
  console.log(
    `${(s.client + ' — ' + s.survey_name).padEnd(52).slice(0,52)}  ` +
    `waves=${total}(r${c.real}/p${c.ph})  ` +
    `cad=${s.cadence_months ?? '—'}mo  anchor=${s.cadence_anchor ?? '—'}  last=${s.last_on ?? '—'}  next=${s.effective_next ?? '—'}  overdue=${s.is_overdue ? 'Y' : 'n'}${flag}`
  )
}
console.log(`\nSUMMARY: ${zeroWave}/${series.length} series have ZERO waves (${zeroWaveWithCadence} of those have a cadence set).`)

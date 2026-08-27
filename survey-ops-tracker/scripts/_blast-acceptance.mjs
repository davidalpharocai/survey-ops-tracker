/* Non-destructive acceptance test for the blast-edit RPCs (migration 076),
 * run against a THROWAWAY blast on PR00260 — the 3 real blasts are untouched,
 * and the temp blast is removed at the end (spend returns to baseline). */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const IDEM = 'B2B_BFBAMCRUISE202608#ClaudeUpsertTest'
const ACTOR = 'claude-acceptance-test'
const results = []
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? '✓' : '✗ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

const { data: p } = await db.from('survey_projects').select('id, actual_spend').eq('project_code', 'PR00260').single()
const pid = p.id
const spend = async () => (await db.from('survey_projects').select('actual_spend').eq('id', pid).single()).data.actual_spend
const count = async () => (await db.from('project_blasts').select('id', { count: 'exact', head: true }).eq('project_id', pid)).count
const blastSpend = async () => {
  const { data } = await db.from('project_blasts').select('bid, completes').eq('project_id', pid)
  return data.reduce((s, b) => s + Number(b.bid) * b.completes, 0)
}

const baseCount = await count()
const baseSpend = await spend()
console.log(`\nBaseline: ${baseCount} blasts · actual_spend $${baseSpend} · blast_spend_total $${await blastSpend()}\n`)

// 1) NEW idem_key CREATES (regression #5).
let { data: r1 } = await db.rpc('mcp_log_blast', { p_project: pid, p_bid: 10, p_people: 100, p_completes: 5, p_blast_at: null, p_note: 'CLAUDE TEST — safe to ignore', p_created_by: ACTOR, p_idem: IDEM, p_actor: ACTOR })
const testId = r1.id
check('new idem_key creates a blast', (await count()) === baseCount + 1 && r1.completes === 5, `count ${await count()}, completes ${r1.completes}`)
check('  blast_spend_total rose by 5×$10=$50', (await blastSpend()) === baseSpend + 50, `$${await blastSpend()} (want $${baseSpend + 50})`)

// 2) SAME idem_key UPSERTS (the core fix — was a no-op) (acceptance #1).
let { data: r2 } = await db.rpc('mcp_log_blast', { p_project: pid, p_bid: 10, p_people: 100, p_completes: 9, p_blast_at: null, p_note: 'CLAUDE TEST — safe to ignore', p_created_by: ACTOR, p_idem: IDEM, p_actor: ACTOR })
check('re-log same idem_key UPDATES the same row (no duplicate)', r2.id === testId && (await count()) === baseCount + 1 && r2.completes === 9, `same id ${r2.id === testId}, completes ${r2.completes}, count ${await count()}`)
check('  blast_spend_total recalculated (baseline + 9×$10)', (await blastSpend()) === baseSpend + 90, `$${await blastSpend()} (want $${baseSpend + 90})`)

// 3) update_blast patches ONLY the fields passed (acceptance #3).
const before = (await db.from('project_blasts').select('bid, people, blast_at').eq('id', testId).single()).data
let { data: r3 } = await db.rpc('mcp_update_blast', { p_blast: testId, p_patch: { completes: 3 }, p_actor: ACTOR })
const after = (await db.from('project_blasts').select('bid, people, blast_at').eq('id', testId).single()).data
check('update_blast changes only completes', r3.completes === 3 && Number(after.bid) === Number(before.bid) && after.people === before.people, `completes ${r3.completes}, bid/people unchanged ${Number(after.bid) === Number(before.bid) && after.people === before.people}`)
check('  blast_spend_total recalculated (baseline + 3×$10)', (await blastSpend()) === baseSpend + 30, `$${await blastSpend()} (want $${baseSpend + 30})`)

// 4) remove_blast deletes + recomputes (acceptance #4).
await db.rpc('mcp_remove_blast', { p_blast: testId, p_actor: ACTOR })
check('remove_blast deletes the blast', (await count()) === baseCount, `count ${await count()} (want ${baseCount})`)
check('  spend restored to baseline', (await spend()) === baseSpend && (await blastSpend()) === baseSpend, `actual_spend $${await spend()}, blast_spend_total $${await blastSpend()} (want $${baseSpend})`)

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} checks passed. PR00260's 3 real blasts untouched (final: ${await count()} blasts, $${await spend()}).`)
process.exit(passed === results.length ? 0 : 1)

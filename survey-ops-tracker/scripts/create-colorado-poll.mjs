/**
 * Create the Colorado Primaries POC, the one CSV survey with no SOCC project.
 *
 *   node scripts/create-colorado-poll.mjs            # dry run
 *   node scripts/create-colorado-poll.mjs --apply
 *
 * WHY THIS ONE CAN BE INFERRED AND THE REST COULD NOT. Three siblings already
 * exist and agree on every field that matters — PR00279 Michigan, PR00292
 * Minnesota, PR00293 Wisconsin are each "<State> Primaries POC", client
 * AlphaROC, salesperson Internal, project_type PS, delivered, and each carries a
 * B2B_BF<ST>PRIMARY<YYYYMM> survey id exactly like B2B_BFCOPRIMARY202606. The
 * Colorado run sits earliest in that sequence (26-29 June, before Michigan's
 * July). Everything below is copied from that pattern or read from the CSV; no
 * field is invented.
 *
 * The project_code is NOT set here — migration 027's trigger assigns the next
 * PR##### from a sequence, and hand-picking one is how a code gets reused.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const APPLY = process.argv.includes('--apply')
const env = Object.fromEntries(
  readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
    .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })

const SURVEY_ID = 'B2B_BFCOPRIMARY202606'
const { data: dupe } = await db.from('survey_projects')
  .select('project_code').ilike('survey_tool_id', `%${SURVEY_ID}%`).is('deleted_at', null)
if (dupe?.length) { console.log(`Already exists on ${dupe.map(d=>d.project_code).join(', ')} — nothing to do.`); process.exit(0) }

// Mirror the sibling exactly where the sibling is authoritative.
const { data: sib } = await db.from('survey_projects')
  .select('client, client_id, captain_id, project_type, phase, status, board_column, salesperson, priority, blocked_by')
  .eq('project_code', 'PR00293').maybeSingle()

const row = {
  project_name: 'Colorado Primaries POC',
  client: sib.client,
  client_id: sib.client_id,
  captain_id: sib.captain_id,
  project_type: sib.project_type,      // PS, like all three siblings
  phase: sib.phase,
  status: sib.status,                  // Closed — it delivered in June
  board_column: sib.board_column,
  salesperson: sib.salesperson,        // Internal
  priority: sib.priority,
  blocked_by: sib.blocked_by,
  // Every stage true, matching a delivered sibling.
  stage_doc_programming: true, stage_survey_programming: true, stage_edwin_qa: true,
  stage_fielding: true, stage_data_qa: true, stage_delivery: true,
  // From the CSV: first and last blast.
  launch_date: '2026-06-26',
  deliver_date: '2026-06-29',
  // 469 completes across the 12 blasts. Recorded as collected; n_actual is left
  // NULL because a cleaned final figure is a different fact from the raw count
  // and nobody has produced one.
  n_collected: 469,
  survey_tool_id: SURVEY_ID,
  objective: 'Colorado primary voter poll. Reconstructed 2026-09-09 from the Campaign Manager export: 12 blasts 26-29 June 2026 to the "Colorado Primary Voters" audience at a $3 reward, 469 completes. The project was never recorded in SOCC at the time.',
}

console.log('WOULD CREATE:')
for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(24)} ${JSON.stringify(v)?.slice(0,90)}`)
if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0) }

const { data: made, error } = await db.from('survey_projects').insert(row).select('id, project_code, project_name').single()
if (error) { console.error('FAILED:', error.message); process.exit(1) }
console.log(`\ncreated ${made.project_code} "${made.project_name}"`)
console.log('Now re-run the blast import to attach its 12 blasts.')

/**
 * Import CCM's "Relationship Manager" onto clients.salesperson.
 *
 * WHY THIS IS THE FIRST IMPORT: it is the only CCM dataset that is complete. All
 * 75 accounts carry a Relationship Manager, and it is what migration 100's sales
 * policies scope on — so until it lands, a salesperson signing in sees nothing.
 * It also fixes a gap that predates CCM entirely: 118 of 375 SOCC projects have
 * no salesperson, so the project-level policy in 093 hides 31% of the pipeline
 * while looking perfectly correct.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. Every run prints what it would do,
 * per client, before doing anything.
 *
 *   node scripts/import-ccm-account-owners.mjs            # report only
 *   node scripts/import-ccm-account-owners.mjs --apply    # write
 *
 * MATCHING, in two passes and no further:
 *   1. exact name  — 70 of 75 CCM accounts match a SOCC client outright
 *   2. firm prefix — SOCC splits accounts by contact ("BAM - Grey Jones") where
 *      CCM has the firm ("BAM"). firmNameFrom is the app's own helper for that
 *      split, so this uses the same rule rather than inventing a second one.
 * Anything still unmatched is REPORTED AND SKIPPED, never guessed. A wrong
 * account owner is worse than a missing one: it decides who can see the account.
 *
 * IDEMPOTENT. A client whose salesperson already matches is left alone, so
 * re-running is a no-op. A client whose salesperson DISAGREES with CCM is
 * reported and skipped unless --overwrite is passed — somebody may have
 * corrected it in SOCC deliberately, and this script should not silently undo
 * that.
 *
 * "Internal" is NOT imported as an owner. It is CCM's marker for AlphaROC's own
 * work, not a person, and salespeople.canonical_name has no such row — writing
 * it would produce an account owned by a name my_salesperson_name() can never
 * return, i.e. an account no salesperson can see and no report can attribute.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const APPLY = process.argv.includes('--apply')
const OVERWRITE = process.argv.includes('--overwrite')
const WORKBOOK =
  process.argv.find(a => a.endsWith('.xlsx')) ??
  'C:/Users/david/Downloads/Copy of ccm-data-2026-07-20.xlsx'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Read the Clients tab via python+openpyxl — no JS xlsx dependency is installed,
 *  and adding one to the app's package.json for a one-off import would be worse
 *  than shelling out to a script that is already available. */
function readClientsTab(file) {
  const py = `
import json, openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb['Clients']
it = ws.iter_rows(values_only=True)
hdr = [str(h).strip() if h is not None else '' for h in next(it)]
out = []
for r in it:
    if all(c is None or str(c).strip()=='' for c in r): continue
    d = {hdr[i]: r[i] for i in range(min(len(hdr), len(r)))}
    out.append({'name': d.get('Client Name'), 'rm': d.get('Relationship Manager'),
                'code': d.get('Client Code')})
print(json.dumps(out))
`
  return JSON.parse(execFileSync('python', ['-c', py, file], { encoding: 'utf8', maxBuffer: 1 << 24 }))
}

/** The firm half of a SOCC client name. Mirrors lib/utils/clientName.ts's
 *  firmNameFrom: SOCC writes "Firm - Contact", CCM writes "Firm". */
const firmOf = s => String(s ?? '').split(' - ')[0].trim()
const norm = s => String(s ?? '').trim().toLowerCase()

const ccm = readClientsTab(WORKBOOK)
console.log(`CCM workbook: ${path.basename(WORKBOOK)} — ${ccm.length} accounts`)

const { data: clients, error } = await db
  .from('clients').select('id, name, salesperson').is('deleted_at', null)
if (error) { console.error('could not read clients:', error.message); process.exit(1) }
console.log(`SOCC live clients: ${clients.length}`)

// Known canonical salesperson names, so a typo in the workbook cannot invent a
// person. 093 built this table as the single source of who-is-who.
const { data: people } = await db.from('salespeople').select('canonical_name')
const canonical = new Map((people ?? []).map(p => [norm(p.canonical_name), p.canonical_name]))
console.log(`known salespeople: ${[...canonical.values()].join(', ')}`)

const byExact = new Map(clients.map(c => [norm(c.name), c]))
const byFirm = new Map()
for (const c of clients) {
  const k = norm(firmOf(c.name))
  if (!byFirm.has(k)) byFirm.set(k, [])
  byFirm.get(k).push(c)
}

const plan = []      // { client, to, via }
const skipped = []   // { why, detail }

for (const row of ccm) {
  const rm = String(row.rm ?? '').trim()
  if (!rm) { skipped.push({ why: 'no Relationship Manager in CCM', detail: row.name }); continue }
  if (norm(rm) === 'internal') { skipped.push({ why: 'owner is "Internal", not a person', detail: row.name }); continue }
  const owner = canonical.get(norm(rm))
  if (!owner) { skipped.push({ why: `"${rm}" is not a known salesperson`, detail: row.name }); continue }

  const exact = byExact.get(norm(row.name))
  const targets = exact ? [exact] : (byFirm.get(norm(row.name)) ?? [])
  if (targets.length === 0) { skipped.push({ why: 'no SOCC client matches this name', detail: row.name }); continue }

  for (const t of targets) {
    if (t.salesperson && norm(t.salesperson) === norm(owner)) continue          // already right
    if (t.salesperson && !OVERWRITE) {
      skipped.push({ why: `SOCC says "${t.salesperson}", CCM says "${owner}" — pass --overwrite to change`, detail: t.name })
      continue
    }
    plan.push({ client: t, to: owner, via: exact ? 'exact name' : `firm prefix of "${row.name}"` })
  }
}

console.log(`\n=== ${plan.length} account(s) would be assigned an owner ===`)
const byOwner = {}
for (const p of plan) byOwner[p.to] = (byOwner[p.to] ?? 0) + 1
for (const [k, v] of Object.entries(byOwner).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
console.log()
for (const p of plan.slice(0, 40)) {
  console.log(`  ${String(p.client.name).slice(0, 34).padEnd(34)} -> ${p.to.padEnd(18)} (${p.via})`)
}
if (plan.length > 40) console.log(`  ... and ${plan.length - 40} more`)

if (skipped.length) {
  console.log(`\n=== ${skipped.length} skipped, NEVER guessed ===`)
  const grouped = {}
  for (const s of skipped) { grouped[s.why] ??= []; grouped[s.why].push(s.detail) }
  for (const [why, items] of Object.entries(grouped)) {
    console.log(`  ${why}  (${items.length})`)
    for (const i of items.slice(0, 8)) console.log(`      ${i}`)
    if (items.length > 8) console.log(`      ... and ${items.length - 8} more`)
  }
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write.')
  process.exit(0)
}

console.log('\napplying...')
let ok = 0, failed = 0
for (const p of plan) {
  const { error } = await db.from('clients').update({ salesperson: p.to }).eq('id', p.client.id)
  if (error) { failed++; console.error(`  FAILED ${p.client.name}: ${error.message}`) } else ok++
}
console.log(`written: ${ok}   failed: ${failed}`)

// What the sales scope looks like afterwards — the number that actually matters.
const { data: after } = await db
  .from('clients').select('id, salesperson').is('deleted_at', null)
const { data: proj } = await db
  .from('survey_projects').select('client_id, salesperson').is('deleted_at', null)
const ownerById = new Map((after ?? []).map(c => [c.id, c.salesperson]))
const reachable = (proj ?? []).filter(p => ownerById.get(p.client_id) || p.salesperson).length
console.log(`\naccounts with an owner: ${(after ?? []).filter(c => c.salesperson).length} of ${(after ?? []).length}`)
console.log(`projects now reachable by SOME salesperson: ${reachable} of ${(proj ?? []).length}`)

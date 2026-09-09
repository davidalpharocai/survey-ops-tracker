/**
 * Read back the filled-in unowned-accounts.xlsx and set clients.salesperson.
 *
 *   node scripts/import-account-owners.mjs scripts/out/unowned-accounts.xlsx
 *   node scripts/import-account-owners.mjs <file> --apply
 *
 * DRY RUN BY DEFAULT, same as scripts/import-ccm-account-owners.mjs. It prints
 * every change it would make and writes nothing without --apply.
 *
 * Matches on the client_id in column A, never on the account NAME: two accounts
 * can share a display name, names get renamed, and a fuzzy re-match on a
 * spreadsheet round trip is how the wrong account silently gets reassigned.
 *
 * REFUSES to overwrite an account that already has an owner unless --force is
 * given. The sheet was generated from the UNOWNED list, so an owner appearing in
 * the meantime means somebody set it another way, and a stale spreadsheet should
 * not quietly undo that.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const file = process.argv[2]
const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
if (!file) { console.error('usage: node scripts/import-account-owners.mjs <file.xlsx> [--apply] [--force]'); process.exit(1) }

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const salesFile = readFileSync('lib/utils/salespeople.ts', 'utf8')
const block = salesFile.slice(salesFile.indexOf('export const SALESPEOPLE = ['))
const CANON = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map(m => m[1])
const VALID = new Set(CANON)

/**
 * Resolve what a human actually typed to a canonical name.
 *
 * The first pass of this script demanded an exact match and rejected all 15
 * filled-in rows because David typed "Alex" rather than "Alex Pinsky" — which is
 * a validator being pedantic about something entirely unambiguous, and the cost
 * of that pedantry is a person redoing a spreadsheet.
 *
 * So: exact wins; otherwise a UNIQUE case-insensitive match on the full name or
 * the first name is accepted and the resolution is printed, so nothing is
 * coerced silently. Two people sharing a first name would make it ambiguous
 * again, and that is still refused rather than guessed — the failure mode of
 * guessing is an account assigned to the wrong person.
 */
function resolveName(raw) {
  const t = raw.trim()
  if (VALID.has(t)) return { name: t }
  const low = t.toLowerCase()
  const hits = CANON.filter(c =>
    c.toLowerCase() === low ||
    c.toLowerCase().split(' ')[0] === low ||
    c.toLowerCase().startsWith(low + ' '))
  if (hits.length === 1) return { name: hits[0], resolvedFrom: t }
  if (hits.length > 1) return { error: `"${t}" matches ${hits.join(' and ')} — write the full name.` }
  return { error: `"${t}" is not a salesperson (${CANON.join(', ')}).` }
}

// XLSX.read on a buffer, not XLSX.readFile: the ESM build needs fs bound via
// XLSX.set_fs() before readFile works, and reading the bytes ourselves avoids
// the whole question.
const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Accounts'] ?? wb.Sheets[wb.SheetNames[0]])
console.log(`${rows.length} rows in ${file}\n`)

const { data: clients } = await db.from('clients').select('id, name, salesperson').is('deleted_at', null)
const byId = Object.fromEntries(clients.map(c => [c.id, c]))

const todo = [], skipped = [], problems = [], resolutions = []
for (const [i, r] of rows.entries()) {
  const line = i + 2
  const id = String(r['Client ID (do not edit)'] ?? '').trim()
  const name = String(r['Salesperson'] ?? '').trim()
  if (!id) { problems.push(`row ${line}: no client id — column A was edited or removed`); continue }
  const c = byId[id]
  if (!c) { problems.push(`row ${line}: client ${id} not found (deleted or merged since the export)`); continue }
  if (!name) { skipped.push(`${c.name} — left blank`); continue }
  const res = resolveName(name)
  if (res.error) { problems.push(`row ${line}: ${res.error} — for ${c.name}`); continue }
  const resolved = res.name
  if (res.resolvedFrom) resolutions.push(`${c.name}: "${res.resolvedFrom}" -> ${resolved}`)
  if (c.salesperson && c.salesperson !== resolved && !FORCE) {
    problems.push(`row ${line}: ${c.name} is ALREADY owned by ${c.salesperson}; the sheet says ${resolved}. Someone set it since the export — re-run with --force only if the sheet is right.`)
    continue
  }
  if (c.salesperson === resolved) { skipped.push(`${c.name} — already ${resolved}`); continue }
  todo.push({ id, name: resolved, was: c.salesperson, account: c.name })
}

if (problems.length) {
  console.log(`PROBLEMS (${problems.length}) — nothing below is applied until these are resolved or the rows removed:`)
  for (const p of problems) console.log('  ! ' + p)
  console.log('')
}
if (resolutions.length) {
  console.log(`RESOLVED what you typed to a full name (${resolutions.length}) — check these read right:`)
  for (const r of resolutions) console.log('  · ' + r)
  console.log('')
}
console.log(`WOULD SET (${todo.length}):`)
for (const t of todo) console.log(`  ${t.account.padEnd(38)} ${t.was ? t.was + ' -> ' : ''}${t.name}`)
if (skipped.length) {
  console.log(`\nskipped (${skipped.length}): ${skipped.slice(0, 8).join('; ')}${skipped.length > 8 ? ` … +${skipped.length - 8}` : ''}`)
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to write.'); process.exit(problems.length ? 1 : 0) }
if (problems.length && !FORCE) { console.error('\nRefusing to apply with unresolved problems. Fix the sheet, or pass --force.'); process.exit(1) }

let n = 0
for (const t of todo) {
  const { error } = await db.from('clients').update({ salesperson: t.name }).eq('id', t.id)
  if (error) console.error(`  FAILED ${t.account}: ${error.message}`)
  else { n++; console.log(`  set ${t.account} -> ${t.name}`) }
}
console.log(`\napplied ${n} of ${todo.length}.`)

// The point of setting these is that they become visible to that salesperson,
// so report the actual effect rather than just the row count.
const { data: after } = await db.from('clients').select('id, salesperson').is('deleted_at', null)
const owned = after.filter(c => c.salesperson).length
console.log(`accounts with an owner: ${owned}/${after.length}`)
const { data: p } = await db.from('survey_projects').select('client_id, salesperson').is('deleted_at', null)
const ownerOf = Object.fromEntries(after.map(c => [c.id, c.salesperson]))
const invisible = p.filter(x => !x.salesperson && !ownerOf[x.client_id]).length
console.log(`surveys visible to nobody in sales: ${invisible} (was 7)`)

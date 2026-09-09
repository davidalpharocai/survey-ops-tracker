/**
 * Promote the staged CCM users into client_contacts.
 *
 *   node scripts/promote-ccm-contacts.mjs           # dry run
 *   node scripts/promote-ccm-contacts.mjs --apply
 *
 * Reads ccm_contact_staging (migration 103), which the loader filled with all
 * 138 CCM users and a flag saying which of them SOCC already had. Creates only
 * the ones it does not.
 *
 * MATCHES ON EMAIL, freshly, rather than trusting the `already_in_socc` flag the
 * loader stamped: that flag records what was true when the export was staged,
 * and contacts have been added since. A stale flag would create a duplicate
 * person, which is worse than doing the comparison twice.
 *
 * A CCM user with no email is SKIPPED, not created. 15 of the 138 have none, and
 * a contact with a name and nothing else cannot be matched, mailed, or
 * deduplicated later — it is a row that looks like data and is not.
 *
 * `promoted_at` and `promoted_contact_id` are stamped back onto the staging row,
 * so a second run does nothing and the provenance survives.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const APPLY = process.argv.includes('--apply')
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: staged, error } = await db.from('ccm_contact_staging').select('*')
if (error) {
  console.error(error.message.includes('does not exist')
    ? 'ccm_contact_staging is missing — apply migration 103 and run scripts/load-ccm-staging.mjs first.'
    : error.message)
  process.exit(1)
}
if (!staged.length) {
  console.log('Nothing staged. Run: node scripts/load-ccm-staging.mjs "<ccm-data.xlsx>" --apply')
  process.exit(0)
}

const { data: existing } = await db.from('client_contacts').select('id, client_id, email, first_name, last_name')
const byEmail = new Map((existing ?? [])
  .filter(c => c.email)
  .map(c => [String(c.email).toLowerCase().trim(), c]))

/** "Laura Mehegan" -> first/last. CCM stores one `Name`; SOCC stores two.
 *  Everything after the first token is the surname, so "Anne van der Berg"
 *  keeps its particles together rather than losing them. */
function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: null, last: null }
  if (parts.length === 1) return { first: parts[0], last: null }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

const create = [], haveIt = [], noEmail = [], noClient = [], done = []
for (const s of staged) {
  if (s.promoted_at) { done.push(s); continue }
  const email = String(s.email ?? '').toLowerCase().trim()
  if (!email) { noEmail.push(s); continue }
  if (!s.socc_client_id) { noClient.push(s); continue }
  const hit = byEmail.get(email)
  if (hit) { haveIt.push({ s, hit }); continue }
  const { first, last } = splitName(s.full_name)
  create.push({ s, row: { client_id: s.socc_client_id, first_name: first, last_name: last, email: s.email, created_by: 'CCM import' } })
}

console.log(`staged: ${staged.length}`)
console.log(`  already promoted in an earlier run : ${done.length}`)
console.log(`  SOCC already has this email        : ${haveIt.length}`)
console.log(`  no email in CCM — SKIPPED          : ${noEmail.length}`)
console.log(`  no matching SOCC client — SKIPPED  : ${noClient.length}`)
console.log(`  WOULD CREATE                       : ${create.length}`)

if (noEmail.length) {
  console.log(`\n  without an email (not created — a name alone cannot be matched or mailed):`)
  for (const s of noEmail.slice(0, 20)) console.log(`    ${String(s.full_name ?? '(no name)').padEnd(28)} ${s.client_name}`)
  if (noEmail.length > 20) console.log(`    … +${noEmail.length - 20} more`)
}

const byClient = {}
for (const c of create) (byClient[c.s.client_name] ??= []).push(c.row)
console.log('\n  by account:')
for (const [name, rows] of Object.entries(byClient).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(rows.length).padStart(3)}  ${name}`)
}

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply.'); process.exit(0) }

console.log('\napplying…')
let n = 0, failed = 0
for (const c of create) {
  const { data, error: e } = await db.from('client_contacts').insert(c.row).select('id').single()
  if (e) { failed++; console.error(`  FAILED ${c.row.email}: ${e.message}`); continue }
  n++
  await db.from('ccm_contact_staging')
    .update({ promoted_at: new Date().toISOString(), promoted_contact_id: data.id })
    .eq('ccm_user_id', c.s.ccm_user_id)
}
// Rows SOCC already had are marked promoted too — they need no action, and
// leaving them unmarked means every future run re-reports them as pending.
for (const { s, hit } of haveIt) {
  await db.from('ccm_contact_staging')
    .update({ promoted_at: new Date().toISOString(), promoted_contact_id: hit.id })
    .eq('ccm_user_id', s.ccm_user_id)
}
console.log(`created ${n}${failed ? `, ${failed} FAILED` : ''}; marked ${haveIt.length} as already present.`)

const { count } = await db.from('client_contacts').select('*', { count: 'exact', head: true })
console.log(`client_contacts now: ${count}`)

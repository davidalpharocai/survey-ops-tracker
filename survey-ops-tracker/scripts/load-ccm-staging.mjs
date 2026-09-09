/**
 * Load the CCM export into the inert staging tables from migration 103.
 *
 *   node scripts/load-ccm-staging.mjs "C:/path/ccm-data-2026-07-20.xlsx"
 *   node scripts/load-ccm-staging.mjs "<path>" --apply
 *
 * DRY RUN BY DEFAULT. Idempotent: upserts on the CCM primary key, so re-running
 * with a newer export updates in place rather than duplicating. Never touches a
 * row that has already been promoted.
 *
 * Deliberately does NOT load the Studies sheet: all 221 rows have Cost = 0, so
 * there is no per-survey credit consumption in CCM to migrate. See 103's header.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const file = process.argv[2]
const APPLY = process.argv.includes('--apply')
if (!file) { console.error('usage: node scripts/load-ccm-staging.mjs <ccm-data.xlsx> [--apply]'); process.exit(1) }

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const sheet = n => XLSX.utils.sheet_to_json(wb.Sheets[n] ?? {})
const src = file.split(/[\/]/).pop()

const { data: clients } = await db.from('clients').select('id, name, code').is('deleted_at', null)
const byCode = Object.fromEntries(clients.filter(c => c.code).map(c => [c.code, c.id]))
const byName = Object.fromEntries(clients.map(c => [c.name.toLowerCase().trim(), c.id]))
const resolve = (code, name) => byCode[String(code ?? '').trim()] ?? byName[String(name ?? '').toLowerCase().trim()] ?? null

// NULL, not 0, when CCM recorded nothing — 0 would assert "this contract bought
// no credits", which is a different claim from "nobody filled it in".
const numOrNull = v => (v === '' || v == null ? null : Number(v) || null)
const dateOrNull = v => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }

const contracts = sheet('Contracts').map(c => ({
  ccm_contract_id: Number(c['Contract_ID']),
  ccm_client_id: Number(c['Client_Id']) || null,
  client_name: String(c['Client'] ?? ''),
  client_code: String(c['Client Code'] ?? '') || null,
  socc_client_id: resolve(c['Client Code'], c['Client']),
  contract_name: String(c['Contract Name'] ?? '') || null,
  project_code: String(c['Project Code'] ?? '') || null,
  contract_date: dateOrNull(c['Contract Date']),
  renewal_date: dateOrNull(c['Renewal Date']),
  credits: numOrNull(c['Credits']),
  dollars: numOrNull(c['Dollars']),
  source_file: src,
}))

const { data: existing } = await db.from('client_contacts').select('email')
const have = new Set((existing ?? []).map(c => String(c.email ?? '').toLowerCase()).filter(Boolean))
const contacts = sheet('Users').map(u => ({
  ccm_user_id: Number(u['User_Id']),
  ccm_client_id: Number(u['Client_Id']) || null,
  client_name: String(u['Client'] ?? ''),
  client_code: String(u['Client Code'] ?? '') || null,
  socc_client_id: resolve(u['Client Code'], u['Client']),
  full_name: String(u['Name'] ?? '') || null,
  email: String(u['Email'] ?? '') || null,
  already_in_socc: have.has(String(u['Email'] ?? '').toLowerCase()),
  source_file: src,
}))

const studies = sheet('Studies')
const nonZero = studies.filter(s => Number(s['Cost']) > 0).length

console.log(`source: ${src}`)
console.log(`\nContracts  ${contracts.length} rows`)
console.log(`  resolve to a SOCC client : ${contracts.filter(c => c.socc_client_id).length}`)
console.log(`  carry credits            : ${contracts.filter(c => c.credits).length}  (${contracts.reduce((t, c) => t + (c.credits ?? 0), 0).toLocaleString()} total)`)
console.log(`  carry a contract date    : ${contracts.filter(c => c.contract_date).length}`)
console.log(`  carry dollars            : ${contracts.filter(c => c.dollars).length}`)
const orphanC = contracts.filter(c => !c.socc_client_id)
if (orphanC.length) console.log(`  ! unresolved: ${orphanC.map(c => c.client_name).join(', ')}`)

console.log(`\nContacts   ${contacts.length} rows`)
console.log(`  resolve to a SOCC client : ${contacts.filter(c => c.socc_client_id).length}`)
console.log(`  NOT already in SOCC      : ${contacts.filter(c => !c.already_in_socc && c.email).length}`)
console.log(`  no email at all          : ${contacts.filter(c => !c.email).length}`)

console.log(`\nStudies    ${studies.length} rows — NOT loaded`)
console.log(`  rows with a credit cost > 0: ${nonZero}`)
console.log(nonZero === 0
  ? '  => nothing to migrate. CCM holds the ALLOWANCE side only; per-survey consumption starts fresh in SOCC.'
  : `  => ${nonZero} rows DO carry credits — 103's premise was that none did. Re-check before promoting.`)

if (!APPLY) { console.log('\nDRY RUN. Re-run with --apply to write into the staging tables.'); process.exit(0) }

for (const [table, rows, key] of [
  ['ccm_contract_staging', contracts, 'ccm_contract_id'],
  ['ccm_contact_staging', contacts, 'ccm_user_id'],
]) {
  // Never overwrite a row already promoted into a real term/contact.
  const { data: done } = await db.from(table).select(key).not('promoted_at', 'is', null)
  const locked = new Set((done ?? []).map(r => r[key]))
  const toWrite = rows.filter(r => !locked.has(r[key]))
  const { error } = await db.from(table).upsert(toWrite, { onConflict: key })
  console.log(error
    ? `  ${table}: FAILED ${error.message}`
    : `  ${table}: ${toWrite.length} rows upserted${locked.size ? `, ${locked.size} left alone (already promoted)` : ''}`)
}
console.log('\nStaged. Nothing in the app reads these tables; promoting is a separate, deliberate step.')

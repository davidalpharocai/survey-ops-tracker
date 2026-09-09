/**
 * Export the accounts with no salesperson, for David to fill in and hand back.
 *
 * Round-trippable ON PURPOSE. The sheet carries the client_id in column A so the
 * re-import matches on the immutable key rather than on the NAME — two accounts
 * can share a display name, names get renamed, and a fuzzy re-match on a
 * spreadsheet round trip is how the wrong account gets reassigned. Column A is
 * marked do-not-edit; the only cell to touch is Salesperson.
 *
 *   node scripts/unowned-accounts-xlsx.mjs            -> writes the file
 *   node scripts/import-account-owners.mjs <file>     -> dry run
 *   node scripts/import-account-owners.mjs <file> --apply
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: clients } = await db.from('clients')
  .select('id, name, code, salesperson').is('deleted_at', null)
const { data: projects } = await db.from('survey_projects')
  .select('client_id, project_code, project_name, salesperson, submitted_date, deliver_date, status')
  .is('deleted_at', null)
const { data: contacts } = await db.from('client_contacts')
  .select('client_id, first_name, last_name, archived')

const byClient = {}
for (const p of projects) (byClient[p.client_id] ??= []).push(p)
const contactsBy = {}
for (const c of contacts) if (!c.archived) (contactsBy[c.client_id] ??= []).push(c)

// The canonical dropdown list, so David picks a name the app already recognises
// rather than inventing a variant that lib/mcp/health.ts check 6 then flags.
//
// Read from the SALESPEOPLE array itself, not scraped with a name-shaped regex —
// that missed "Internal", which is a legitimate value (7 projects carry it) and
// the right answer for our own AlphaROC account and internal test work. Former
// salespeople are deliberately absent: nobody should be newly assigned to one.
const salesFile = readFileSync('lib/utils/salespeople.ts', 'utf8')
const block = salesFile.slice(salesFile.indexOf('export const SALESPEOPLE = ['))
const active = [...block.slice(0, block.indexOf(']')).matchAll(/'([^']+)'/g)].map(m => m[1])
if (active.length < 3) { console.error('could not parse SALESPEOPLE — check lib/utils/salespeople.ts'); process.exit(1) }
console.log('canonical salespeople for the dropdown:', active.join(', '))

const unowned = clients.filter(c => !c.salesperson)
const rows = unowned.map(c => {
  const ps = byClient[c.id] ?? []
  const dates = ps.map(p => p.submitted_date).filter(Boolean).sort()
  // What the PROJECTS say, where they say anything — often the answer is already
  // sitting on the project rows and just never made it onto the account.
  const hinted = [...new Set(ps.map(p => p.salesperson).filter(Boolean))]
  return {
    'Client ID (do not edit)': c.id,
    'Account': c.name,
    'Code': c.code ?? '',
    'Salesperson': '',                       // <- the only column to fill in
    'Suggested (from their surveys)': hinted.join(' / '),
    'Surveys': ps.length,
    'Open surveys': ps.filter(p => p.status === 'Open').length,
    'Contacts': (contactsBy[c.id] ?? []).length,
    'First survey': dates[0] ?? '',
    'Latest survey': dates[dates.length - 1] ?? '',
    'Example survey': ps.length ? `${ps[0].project_code} ${String(ps[0].project_name).slice(0, 44)}` : '',
  }
})
rows.sort((a, b) => b['Surveys'] - a['Surveys'] || a['Account'].localeCompare(b['Account']))

const ws = XLSX.utils.json_to_sheet(rows)
ws['!cols'] = [{ wch: 38 }, { wch: 34 }, { wch: 9 }, { wch: 20 }, { wch: 26 }, { wch: 8 },
               { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 13 }, { wch: 50 }]
ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 10 } }) }
ws['!freeze'] = { xSplit: 0, ySplit: 1 }

// A real dropdown on the Salesperson column, so a typo can't become a new
// "salesperson" that silently hides an account from everyone.
ws['!dataValidation'] = [{
  sqref: `D2:D${rows.length + 1}`,
  type: 'list', formula1: `"${active.join(',')}"`, allowBlank: true,
  showErrorMessage: true, errorTitle: 'Pick from the list',
  error: 'Use one of the canonical names, or leave blank if unknown.',
}]

const notes = XLSX.utils.aoa_to_sheet([
  ['How to fill this in'],
  [''],
  ['1. Fill in column D (Salesperson) only. Leave anything you are unsure about BLANK —'],
  ['   blank is skipped on import, so a guess is worse than nothing.'],
  ['2. Use one of these exact names (column D has a dropdown):'],
  ...active.map(n => ['   ' + n]),
  [''],
  ['3. Do NOT edit column A. It is the database key the import matches on. Names are not'],
  ['   used for matching, because two accounts can share a name and names get renamed.'],
  ['4. Do not add, delete or reorder rows. Extra rows are ignored; missing ones are skipped.'],
  ['5. Send the file back and it gets imported with:'],
  ['      node scripts/import-account-owners.mjs <file>          (dry run, shows every change)'],
  ['      node scripts/import-account-owners.mjs <file> --apply  (writes)'],
  [''],
  ['"Suggested (from their surveys)" is what the SURVEYS on that account already say. Where'],
  ['it names one person, that is very likely the answer — the account row just never got set.'],
  ['Where it is blank or names two people, it genuinely needs your call.'],
])
notes['!cols'] = [{ wch: 92 }]

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Accounts')
XLSX.utils.book_append_sheet(wb, notes, 'How to fill this in')
const out = 'scripts/out/unowned-accounts.xlsx'
writeFileSync(out, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log(`\nwrote ${out} — ${rows.length} accounts`)
const withHint = rows.filter(r => r['Suggested (from their surveys)'])
console.log(`${withHint.length} already have a salesperson named on their surveys:`)
for (const r of withHint) console.log(`   ${String(r['Surveys']).padStart(3)} surveys  ${r['Account'].padEnd(36)} -> ${r['Suggested (from their surveys)']}`)
console.log(`${rows.length - withHint.length} have no signal at all and need your call.`)

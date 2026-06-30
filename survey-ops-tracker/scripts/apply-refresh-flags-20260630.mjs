// One-off: David's calls on the 2026-06-30 refresh flagged disagreements + the
// Junction AI client unification. Dry-run by default; --apply to write.
//   node scripts/apply-refresh-flags-20260630.mjs           (dry run)
//   node scripts/apply-refresh-flags-20260630.mjs --apply
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}

// David's per-project calls (genuine disagreements he resolved)
const FIXES = [
  { code: 'PR00119', patch: { salesperson: 'Vineet Kapur' } },                                   // not Alex/Jenna — it's Vineet
  { code: 'PR00011', patch: { survey_tool_id: 'ALYUAI20260521' } },                              // app value was a dup of PR00012's id
  { code: 'PR00194', patch: { survey_tool_id: 'ALSEMANOEM20260615A' } },                         // replace AJ183 placeholder
  { code: 'PR00197', patch: { survey_tool_id: 'B2B_JTSWKCONSTRUCTIONV220260617, JTSWKCONSTRUCTIONV220260619, B2B_JTSWKCONSTRUCTIONV220260623' } },
  { code: 'PR00001', patch: { project_type: 'B2B', status: 'Open' } },
]

console.log('=== FIELD FIXES ===')
for (const f of FIXES) console.log(`  ${f.code}: ${JSON.stringify(f.patch)}`)

// Junction AI: "Vance Junction AI" / "Junction AI" / "Main Fraim|Mainframe ... Vance" are ONE client.
// Canonical = "Junction AI"; Vance is the contact. Unify the client text on existing projects.
const JUNCTION = 'Junction AI'
// Match only on "junction" — all real variants contain it (Main Fraim/Junction.AI, Junction.AI - Vance Reavie,
// Vance Junction AI, Junction AI). NOTE: do NOT match "mainframe" — that hits the unrelated "Iowa - IC MainFrame".
const variants = await rest('GET', `survey_projects?select=project_code,project_name,client,requested_by_name&deleted_at=is.null&client=ilike.*junction*`)
const toUnify = variants.filter(p => p.client !== JUNCTION)
console.log(`\n=== JUNCTION CLIENT UNIFY (-> "${JUNCTION}") ===`)
for (const p of variants) console.log(`  ${p.project_code} "${p.project_name}"  client="${p.client}"${p.client === JUNCTION ? '  (already canonical)' : '  => Junction AI'}`)

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to write.')
} else {
  for (const f of FIXES) { await rest('PATCH', `survey_projects?project_code=eq.${f.code}`, f.patch); console.log(`patched ${f.code}`) }
  for (const p of toUnify) {
    // keep the existing requested_by_name if set, else record Vance Reavie as the contact
    const patch = { client: JUNCTION }
    if (!p.requested_by_name && /vance/i.test(p.client)) patch.requested_by_name = 'Vance Reavie'
    await rest('PATCH', `survey_projects?project_code=eq.${p.project_code}`, patch)
    console.log(`unified ${p.project_code} -> ${JUNCTION}`)
  }
  console.log(`\nDone: ${FIXES.length} field fixes, ${toUnify.length} client unifications.`)
}

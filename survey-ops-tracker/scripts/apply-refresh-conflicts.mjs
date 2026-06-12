// Apply David's calls on the June 12 refresh conflicts:
// 1. close five sheet-Done projects, 2. true-up n_collected from the sheet,
// 3. take the sheet's date pushes, 4. Techforce salesperson = Alex Pinsky,
// 5. merge the duplicate Techforce "Employers" (PR00125 -> PR00119, keeping
//    PR00125's links and notes on the survivor since their Edwin links differ).
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), quiet: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: key, Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
}
async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}
const byCode = async code =>
  (await rest('GET', `survey_projects?project_code=eq.${code}&select=id,latest_next_steps,linked_documents,n_collected`))[0]

// 1. close
for (const code of ['PR00017', 'PR00025', 'PR00027', 'PR00034', 'PR00036']) {
  await rest('PATCH', `survey_projects?project_code=eq.${code}`, { status: 'Closed' })
  console.log(`closed ${code}`)
}

// 2. n_collected true-up (PR00125's 323 lives on the merge survivor PR00119 already)
const N = { PR00003: 27, PR00017: 31, PR00022: 643, PR00025: 43, PR00027: 44, PR00182: 33, PR00035: 1382 }
for (const [code, n] of Object.entries(N)) {
  await rest('PATCH', `survey_projects?project_code=eq.${code}`, { n_collected: n })
  console.log(`${code} n_collected -> ${n}`)
}

// 3. dates
await rest('PATCH', 'survey_projects?project_code=eq.PR00024', { due_date: '2026-06-15' })
await rest('PATCH', 'survey_projects?project_code=eq.PR00028', { due_date: '2026-06-16', deliver_date: '2026-06-17' })
console.log('dates: PR00024 due 6/15; PR00028 due 6/16 deliver 6/17')

// 4. Techforce salesperson
const tf = await rest('PATCH', `survey_projects?client=like.${encodeURIComponent('Techforce*')}`, { salesperson: 'Alex Pinsky' })
console.log(`Techforce salesperson -> Alex Pinsky (${tf.length} projects)`)

// 5. merge PR00125 into PR00119
const survivor = await byCode('PR00119')
const dupe = await byCode('PR00125')
if (dupe) {
  // union of linked documents; relabel the duplicate's Edwin link so both survive
  const dupeDocs = (dupe.linked_documents ?? []).map(d => {
    try {
      const o = JSON.parse(d)
      if (o.name === 'Edwin') o.name = 'Edwin (merged PR00125)'
      return JSON.stringify(o)
    } catch { return d }
  })
  const docs = [...(survivor.linked_documents ?? []), ...dupeDocs.filter(d => !(survivor.linked_documents ?? []).includes(d))]
  const note = [survivor.latest_next_steps, `[Merged from duplicate PR00125]: ${dupe.latest_next_steps ?? '(no notes)'}`]
    .filter(Boolean).join('\n')
  await rest('PATCH', `survey_projects?project_code=eq.PR00119`, { linked_documents: docs, latest_next_steps: note })
  // move child records, then delete the duplicate
  for (const table of ['project_steps', 'project_bids', 'project_activity', 'project_data_changes']) {
    await rest('PATCH', `${table}?project_id=eq.${dupe.id}`, { project_id: survivor.id }).catch(() => {})
  }
  await rest('DELETE', `project_seen?project_id=eq.${dupe.id}`)
  await rest('DELETE', `survey_projects?project_code=eq.PR00125`)
  console.log('merged PR00125 into PR00119 (PR00125 retired — codes are never reused)')
}
console.log('done')

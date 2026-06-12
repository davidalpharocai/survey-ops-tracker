// Round 2 per David (June 12): Rerun -> BAM (Tinder User study, contact
// Elliot), US CoC -> US Chamber (keeps Cl00054, Cl00043 freed for Maine),
// A4A -> Airlines 4 America (A4A) (keeps Cl00049, Cl00001 freed),
// HingeVoter/Carah gets the freed Cl00001 (oldest free id, oldest codeless client).
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function rest(method, p, body) {
  const res = await fetch(`${url}/rest/v1/${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p}: ${text}`)
  return text ? JSON.parse(text) : []
}

const clients = await rest('GET', 'clients?select=id,name,code')
const byName = new Map(clients.map(c => [c.name, c]))
const id = n => byName.get(n)?.id

// 1. Rerun -> BAM (contact Elliot, same engagement as the original Tinder study)
const r1 = await rest('PATCH', `survey_projects?client=eq.${encodeURIComponent('Rerun - and then set up quarterly')}`, {
  client: 'BAM - Elliot',
})
console.log(`Tinder User study -> BAM - Elliot (${r1.length} project, ${r1[0]?.project_code})`)
if (id('Rerun')) {
  await rest('PATCH', `survey_projects?client_id=eq.${id('Rerun')}`, { client_id: id('BAM') })
  await rest('DELETE', `clients?id=eq.${id('Rerun')}`)
  console.log('Rerun client row deleted')
}

// 2. US CoC -> US Chamber (survivor keeps Cl00054; Cl00043 freed for Maine later)
const r2 = await rest('PATCH', `survey_projects?client=eq.${encodeURIComponent('US CoC')}`, {
  client: 'US Chamber',
})
console.log(`US CoC project texts -> US Chamber (${r2.length})`)
if (id('US CoC')) {
  await rest('PATCH', `survey_projects?client_id=eq.${id('US CoC')}`, { client_id: id('US Chamber') })
  await rest('PATCH', `profiles?client_id=eq.${id('US CoC')}`, { client_id: id('US Chamber') })
  await rest('DELETE', `clients?id=eq.${id('US CoC')}`)
  console.log('US CoC merged into US Chamber (Cl00043 now free)')
}

// 3. A4A -> Airlines 4 America (A4A) (survivor keeps Cl00049; Cl00001 freed)
const r3 = await rest('PATCH', `survey_projects?client=eq.A4A`, {
  client: 'Airlines 4 America (A4A)',
})
console.log(`A4A project texts -> Airlines 4 America (A4A) (${r3.length})`)
if (id('A4A')) {
  await rest('PATCH', `survey_projects?client_id=eq.${id('A4A')}`, { client_id: id('Airlines 4 America (A4A)') })
  await rest('PATCH', `profiles?client_id=eq.${id('A4A')}`, { client_id: id('Airlines 4 America (A4A)') })
  await rest('DELETE', `clients?id=eq.${id('A4A')}`)
  console.log('A4A merged into Airlines 4 America (A4A) (Cl00001 now free)')
}

// 4. HingeVoter/Carah takes the freed Cl00001
await rest('PATCH', `clients?name=eq.${encodeURIComponent('HingeVoter/Carah')}`, { code: 'Cl00001' })
console.log('HingeVoter/Carah -> Cl00001')

const final = await rest('GET', 'clients?select=name,code&order=name')
console.log(`\nFINAL ${final.length} accounts; codeless: ${final.filter(c => !c.code).map(c => c.name).join(', ') || 'none'}`)

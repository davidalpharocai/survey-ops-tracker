import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local'), quiet: true })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const h = { apikey: key, Authorization: `Bearer ${key}` }

const get = async p => (await fetch(`${url}/rest/v1/${p}`, { headers: h })).json()

const clients = await get('clients?select=id,name,code&order=name')
const matches = clients.filter(c => /main\s*frame|junction/i.test(c.name))
console.log('MATCHING CLIENTS:')
for (const c of matches) console.log(`  ${c.code ?? '------'}  "${c.name}"  (${c.id})`)

const projects = await get('survey_projects?select=client,client_id,project_name,deleted_at')
const counts = new Map()
for (const p of projects) {
  if (/main\s*frame|junction|vance|reavie/i.test(p.client)) {
    const k = p.client
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
}
console.log('\nMATCHING PROJECT client TEXTS (count):')
for (const [name, n] of [...counts.entries()].sort()) console.log(`  ${n}\t"${name}"`)

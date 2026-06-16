// "Main Frame" is the codename for Junction.AI (contact Vance Reavie). Junction.AI
// doesn't exist yet, so this is a rename: keep client Cl00029, rename to
// Junction.AI, and stamp the contact on its project. NOT "Iowa - IC MainFrame"
// (that's the separate Iowa client).
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

// 1. Rename the client row (keeps Cl00029)
const c = await rest('PATCH', 'clients?name=eq.Main%20Frame', { name: 'Junction.AI' })
console.log('client renamed:', c.map(x => `${x.code} ${x.name}`).join(', '))

// 2. Stamp the contact on the project(s) — the sync trigger re-derives client_id
//    to the (now Junction.AI) Cl00029 row via the firm prefix.
const p = await rest('PATCH', 'survey_projects?client=eq.Main%20Frame', { client: 'Junction.AI - Vance Reavie' })
console.log('projects updated:', p.map(x => `${x.project_code} ${x.project_name} -> ${x.client} (client_id ${x.client_id ? 'set' : 'NULL'})`).join('; ') || 'none')

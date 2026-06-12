// Maine/Main merge (David, June 12): "Main" (Cl00053, no projects) was a
// typo-row for "Maine" (has Primary Poll, no code). Keep Maine, give it Cl00053.
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

await rest('DELETE', 'clients?name=eq.Main')
console.log('deleted "Main" (no projects)')
const rows = await rest('PATCH', 'clients?name=eq.Maine', { code: 'Cl00053' })
console.log(`Maine -> ${rows[0]?.code}`)
const codeless = await rest('GET', 'clients?code=is.null&select=name')
console.log('codeless clients remaining:', codeless.length ? codeless.map(c => c.name).join(', ') : 'none')

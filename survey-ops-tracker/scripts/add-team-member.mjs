// Add one (or more) team members to the roster, idempotently (skips existing
// emails). Usage: node scripts/add-team-member.mjs
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1'
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: KEY, Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json', Prefer: 'return=representation',
}
async function api(method, path, body) {
  const res = await fetch(`${URL_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const TO_ADD = [
  { name: 'Julia Tibbetts', initials: 'JT', email: 'julia@alpharoc.ai' },
]

const existing = await api('GET', '/team_members?select=id,name,initials,email')
for (const m of TO_ADD) {
  if (existing.some(e => e.email.toLowerCase() === m.email.toLowerCase())) {
    console.log('Already present, skipping:', m.email)
    continue
  }
  const [row] = await api('POST', '/team_members', m)
  console.log('Added:', row.name, `(${row.initials}) <${row.email}>`)
}

const final = await api('GET', '/team_members?select=name,initials,email&order=name')
console.log('\nRoster now:')
for (const m of final) console.log(` ${(m.initials || '').padEnd(4)} ${m.name} <${m.email}>`)

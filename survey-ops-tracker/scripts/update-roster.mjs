// One-off: replace placeholder team members with the real AlphaRoc roster.
// Usage: node scripts/update-roster.mjs
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

const ROSTER = [
  { name: 'David Schwartzman', initials: 'DS', email: 'david@alpharoc.ai' },
  { name: 'Alden', initials: 'AL', email: 'alden@alpharoc.ai' },
  { name: 'Anne', initials: 'AW', email: 'anne@alpharoc.ai' },
  { name: 'Sreerag', initials: 'SC', email: 'sreerag@alpharoc.ai' },
  { name: 'Caitlin', initials: 'CT', email: 'caitlin@alpharoc.ai' },
  { name: 'Sarah', initials: 'SA', email: 'sarah@alpharoc.ai' },
  { name: 'TBD', initials: 'TBD', email: 'tbd@alpharoc.ai' },
]
const FAKE_EMAILS = ['sam.test@alpharoc.ai', 'priya.test@alpharoc.ai', 'marcus.test@alpharoc.ai']

const existing = await api('GET', '/team_members?select=id,name,initials,email')

// 1. Ensure the real roster exists
const members = [...existing]
for (const m of ROSTER) {
  if (!members.some(e => e.email === m.email)) {
    const [row] = await api('POST', '/team_members', m)
    members.push(row)
    console.log('Added:', row.name, `(${row.initials})`)
  }
}

// 2. Reassign test projects away from the fake members
const byEmail = e => members.find(m => m.email === e)?.id
const reassign = {
  [byEmail('sam.test@alpharoc.ai')]: byEmail('alden@alpharoc.ai'),
  [byEmail('priya.test@alpharoc.ai')]: byEmail('anne@alpharoc.ai'),
  [byEmail('marcus.test@alpharoc.ai')]: byEmail('sreerag@alpharoc.ai'),
}
for (const [from, to] of Object.entries(reassign)) {
  if (!from || from === 'undefined' || !to) continue
  const updated = await api('PATCH', `/survey_projects?captain_id=eq.${from}`, { captain_id: to })
  console.log(`Reassigned ${updated.length} project(s)`)
}

// 3. Remove the fakes
for (const email of FAKE_EMAILS) {
  const id = byEmail(email)
  if (!id) continue
  await api('DELETE', `/team_members?id=eq.${id}`)
  console.log('Removed fake member:', email)
}

const final = await api('GET', '/team_members?select=name,initials,email&order=name')
console.log('\nFinal roster:')
for (const m of final) console.log(` ${m.initials.padEnd(4)} ${m.name} <${m.email}>`)

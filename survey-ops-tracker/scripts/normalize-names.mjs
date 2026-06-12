// One-off: full names for PMs and salespeople (June 2026).
// PMs: Anne Wei, Sree Cheeroth, Bryan Fok, Alden Levy, Shanu Aggarwal.
// Sarah -> Sarah Li (initials SL) so Shanu Aggarwal can take SA.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function patch(table, filter, body) {
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  const rows = await res.json()
  if (!res.ok) throw new Error(`${table} ${filter}: ${JSON.stringify(rows)}`)
  console.log(`${table} ${filter} -> ${rows.length} row(s)`)
}

async function insert(table, body) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const rows = await res.json()
  if (!res.ok) throw new Error(`insert ${table}: ${JSON.stringify(rows)}`)
  console.log(`insert ${table} -> ${rows[0]?.name}`)
}

// Team members (exact-name matches so reruns are no-ops)
await patch('team_members', 'name=eq.Alden', { name: 'Alden Levy' })
await patch('team_members', 'name=eq.Anne', { name: 'Anne Wei' })
await patch('team_members', 'name=eq.Sreerag', { name: 'Sree Cheeroth' })
await patch('team_members', 'name=eq.Sarah', { name: 'Sarah Li', initials: 'SL' })

const existing = await (
  await fetch(`${url}/rest/v1/team_members?email=eq.shanu@alpharoc.ai&select=id`, { headers })
).json()
if (existing.length === 0) {
  await insert('team_members', { name: 'Shanu Aggarwal', initials: 'SA', email: 'shanu@alpharoc.ai' })
} else {
  console.log('Shanu already exists, skipping insert')
}

// Salespeople on projects (exact matches only — odd values left alone on purpose)
await patch('survey_projects', 'salesperson=eq.Alex', { salesperson: 'Alex Pinsky' })
await patch('survey_projects', 'salesperson=eq.Jenna', { salesperson: 'Jenna Strova' })
await patch('survey_projects', 'salesperson=eq.Vineet', { salesperson: 'Vineet Kapur' })
await patch('survey_projects', 'salesperson=eq.Steve', { salesperson: 'Steven Stubbs' })
await patch('survey_projects', 'salesperson=eq.Shanu', { salesperson: 'Shanu Aggarwal' })

console.log('done')

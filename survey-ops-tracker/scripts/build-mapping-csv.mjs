// Rebuild project-id-mapping.csv with a "Lookup Key" first column
// (Client | Project Name) so the sheet XLOOKUP is exact even when
// project names repeat across clients/waves.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const headers = { apikey: key, Authorization: `Bearer ${key}` }

const rows = await (
  await fetch(
    `${url}/rest/v1/survey_projects?select=project_code,project_name,client,submitted_date,status&order=project_code`,
    { headers }
  )
).json()

const esc = v => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = [
  'Lookup Key,Project ID,Project Name,Client,Submitted,Status',
  ...rows.map(p =>
    [`${p.client} | ${p.project_name}`, p.project_code, p.project_name, p.client, p.submitted_date, p.status]
      .map(esc)
      .join(',')
  ),
].join('\n')

fs.writeFileSync(path.join(dir, 'project-id-mapping.csv'), csv)
console.log('rows:', rows.length, 'bytes:', csv.length)

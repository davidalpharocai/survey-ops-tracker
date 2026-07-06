// Full-data export: every table in the Command Center's Supabase DB, one tab each,
// into a single multi-tab Excel workbook. Rerunnable — always writes a fresh dated file.
//
//   node scripts/export-all.mjs
//
// Mirrors the env/client setup used by scripts/sheet-sync.mjs.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { persistSession: false } })

// table -> tab name. Order matters (Projects first). Sheet names must be <=31 chars.
const TABLES = [
  ['survey_projects', 'Projects'],
  ['clients', 'Clients'],
  ['client_contacts', 'Client Contacts'],
  ['client_notes', 'Client Notes'],
  ['project_bids', 'Bids'],
  ['project_blasts', 'Blasts'],
  ['project_steps', 'Next Steps'],
  ['project_activity', 'Activity'],
  ['project_data_changes', 'Data Changes'],
  ['project_segments', 'Segments'],
  ['project_audit', 'Audit Log'],
  ['deliverables', 'Deliverables'],
  ['project_recipients', 'Recipients'],
  ['question_submissions', 'Submissions'],
  ['team_members', 'Team'],
  ['profiles', 'Profiles'],
  ['system_events', 'System Events'],
  // Extra tables found in supabase/migrations/*.sql that hold real user/operational
  // data (not pure singleton config) — added beyond the requested minimum list:
  ['questions', 'Questions'],
  ['notification_log', 'Notification Log'],
  ['project_seen', 'Project Seen'],
]

const PAGE = 1000
const MAX_CELL = 32000

function safeCell(v) {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x))).join('; ')
  if (typeof v === 'object') {
    try { v = JSON.stringify(v) } catch { v = String(v) }
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string' && v.length > MAX_CELL) return v.slice(0, MAX_CELL) + '…[truncated]'
  return v
}

function sanitizeRows(rows) {
  return rows.map(r => {
    const out = {}
    for (const [k, v] of Object.entries(r)) out[k] = safeCell(v)
    return out
  })
}

async function fetchAll(table) {
  // Try ordering by created_at; fall back to no explicit order if the column doesn't exist.
  let orderCol = 'created_at'
  const rows = []
  let offset = 0
  let useOrder = true
  while (true) {
    let query = supabase.from(table).select('*').range(offset, offset + PAGE - 1)
    if (useOrder) query = query.order(orderCol, { ascending: true })
    const { data, error } = await query
    if (error) {
      if (useOrder && /column .* does not exist/i.test(error.message)) {
        useOrder = false
        continue // retry same offset without order
      }
      throw error
    }
    rows.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return rows
}

async function main() {
  const wb = XLSX.utils.book_new()
  const results = []
  const skipped = []

  for (const [table, tabName] of TABLES) {
    process.stdout.write(`Fetching ${table} ... `)
    try {
      const rows = await fetchAll(table)
      console.log(`${rows.length} rows`)
      const sheetRows = rows.length ? sanitizeRows(rows) : []
      const ws = rows.length
        ? XLSX.utils.json_to_sheet(sheetRows)
        : XLSX.utils.aoa_to_sheet([['(no rows)']])
      XLSX.utils.book_append_sheet(wb, ws, tabName)
      results.push({ table, tab: tabName, rows: rows.length })
    } catch (err) {
      if (/relation .* does not exist/i.test(err.message || '')) {
        console.log(`SKIPPED (relation does not exist)`)
        skipped.push({ table, reason: 'relation does not exist' })
        continue
      }
      console.log(`ERROR: ${err.message}`)
      skipped.push({ table, reason: err.message })
    }
  }

  const exportsDir = path.join(dir, '..', 'exports')
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true })
  const dateStr = '2026-07-06'
  const outPath = path.join(exportsDir, `survey-ops-export-${dateStr}.xlsx`)
  XLSX.writeFile(wb, outPath)
  console.log(`\nWrote workbook: ${outPath}`)

  // Copy to Desktop for easy access. Desktop may be OneDrive-redirected on this machine.
  const home = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\david'
  const desktopCandidates = [
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Desktop'),
  ]
  const desktopDir = desktopCandidates.find(p => fs.existsSync(p))
  if (desktopDir) {
    const desktopPath = path.join(desktopDir, `survey-ops-export-${dateStr}.xlsx`)
    try {
      fs.copyFileSync(outPath, desktopPath)
      console.log(`Copied to: ${desktopPath}`)
    } catch (err) {
      console.log(`Could not copy to Desktop (${err.message}) — skipping.`)
    }
  } else {
    console.log('Could not locate a Desktop directory — skipping copy.')
  }

  console.log('\n=== SUMMARY ===')
  for (const r of results) console.log(`  ${r.tab.padEnd(20)} <- ${r.table.padEnd(24)} ${r.rows} rows`)
  if (skipped.length) {
    console.log('\n=== SKIPPED ===')
    for (const s of skipped) console.log(`  ${s.table}: ${s.reason}`)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})

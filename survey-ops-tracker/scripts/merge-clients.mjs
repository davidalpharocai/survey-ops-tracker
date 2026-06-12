// One-off client consolidation per David's instructions (June 12, 2026).
// Sequence: (1) rename/recode survivor rows, (2) rewrite project client text
// + repoint client_id, (3) repoint portal profiles, (4) delete orphaned
// loser rows, (5) import every coded client from the Unique Clients tab.
// Left alone pending David's answers: Rerun, Maine, US CoC vs US Chamber,
// A4A vs Airlines 4 America.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(dir, '..', '.env.local'), quiet: true })

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
const id = name => byName.get(name)?.id

// --- 1. survivor renames / code moves (1:1 — row keeps its id) ---
const RENAMES = [
  { from: 'Black kIte Capital', to: 'Black Kite Capital (Millenium)', code: 'Cl00011' },
  { from: 'Jenna', to: 'FIRE', code: 'Cl00023' },
  { from: 'IC MainFrame', to: 'Iowa', code: 'Cl00050' },
  { from: 'Berman', to: 'Berman & Co.', code: 'Cl00051' },
  { from: 'Columbia', to: 'Columbia University', code: 'Cl00046' },
  { from: 'Select equity', to: 'Select Equity', code: null }, // keeps Cl00037
]
for (const r of RENAMES) {
  if (!byName.has(r.from)) { console.log(`rename skip (missing): ${r.from}`); continue }
  const body = { name: r.to }
  if (r.code) body.code = r.code
  await rest('PATCH', `clients?id=eq.${id(r.from)}`, body)
  console.log(`renamed: ${r.from} -> ${r.to}${r.code ? ' (' + r.code + ')' : ''}`)
}

// GoldenTree: code Cl00026 currently sits on lowercase "Goldentree" — move it
if (byName.has('Goldentree') && byName.has('GoldenTree')) {
  await rest('PATCH', `clients?id=eq.${id('Goldentree')}`, { code: null })
  await rest('PATCH', `clients?id=eq.${id('GoldenTree')}`, { code: 'Cl00026' })
  console.log('moved Cl00026 to GoldenTree')
}

// --- 2. merges: losers -> survivor, with project text rewrites ---
// [survivorName, loserNames, textRewrites {oldText: newText}]
const MERGES = [
  ['Coatue', ['COATUE'], { COATUE: 'Coatue' }],
  ['GoldenTree', ['Goldentree', 'Adam Philips', 'Adam Phillips'], {
    'Goldentree - Adam Phillips': 'GoldenTree - Adam Phillips',
    'Adam Philips': 'GoldenTree - Adam Phillips',
    'Adam Phillips': 'GoldenTree - Adam Phillips',
    Goldentree: 'GoldenTree',
  }],
  ['Sportclips', ['SportClips'], { SportClips: 'Sportclips' }],
  ['Oklahoma Chamber', ['OK Chamber', 'State Chamber of OK', 'Luke Reynolds'], {
    'OK Chamber': 'Oklahoma Chamber',
    'State Chamber of OK - Luke': 'Oklahoma Chamber - Luke Reynolds',
    'State Chamber of OK': 'Oklahoma Chamber',
    'Luke Reynolds': 'Oklahoma Chamber - Luke Reynolds',
  }],
  ['US Chamber', ['James Kenny Chamber'], {
    'James Kenny Chamber': 'US Chamber - James Kenny',
  }],
  ['Alaska Chamber', ['Alaska State Chamber'], { 'Alaska State Chamber': 'Alaska Chamber' }],
  ['AlphaROC', ['Internal'], { Internal: 'AlphaROC' }],
  ['Foulkes for Gov', ['Frank'], { Frank: 'Foulkes for Gov - Frank' }],
  ['HingeVoter/Carah', ['HingeVoter/Cara', 'HingeVoter/Jenna'], {
    'HingeVoter/Cara': 'HingeVoter/Carah',
    'HingeVoter/Jenna': 'HingeVoter/Carah',
  }],
  ['SEMA', ['SEMA-Lauren'], { 'SEMA-Lauren': 'SEMA - Lauren' }],
]

// text rewrites from the 1:1 renames too
const RENAME_TEXTS = {
  'Black kIte Capital': 'Black Kite Capital (Millenium)',
  Jenna: 'FIRE - Jenna',
  'IC MainFrame': 'Iowa - IC MainFrame',
  Berman: 'Berman & Co.',
  Columbia: 'Columbia University',
  'Select equity': 'Select Equity',
}

const allRewrites = { ...RENAME_TEXTS }
for (const [, , rewrites] of MERGES) Object.assign(allRewrites, rewrites)

for (const [oldText, newText] of Object.entries(allRewrites)) {
  const rows = await rest(
    'PATCH',
    `survey_projects?client=eq.${encodeURIComponent(oldText)}`,
    { client: newText }
  )
  if (rows.length) console.log(`text: "${oldText}" -> "${newText}" (${rows.length})`)
}

// repoint client_id + profiles, then delete losers
for (const [survivor, losers] of MERGES) {
  const sid = id(survivor)
  if (!sid) { console.log(`MISSING SURVIVOR: ${survivor}`); continue }
  for (const loser of losers) {
    const lid = id(loser)
    if (!lid) continue
    await rest('PATCH', `survey_projects?client_id=eq.${lid}`, { client_id: sid })
    await rest('PATCH', `profiles?client_id=eq.${lid}`, { client_id: sid })
    await rest('DELETE', `clients?id=eq.${lid}`)
    console.log(`merged: ${loser} -> ${survivor}`)
  }
}

// --- 3. import every coded client from the Unique Clients tab ---
const SKIP_TAB_NAMES = new Set(['Frank (Foulkes)']) // retired by the Foulkes merge
const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'))
const tab = wb.SheetNames.find(n => n.toLowerCase().startsWith('unique clients'))
const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: null })

const fresh = await rest('GET', 'clients?select=id,name,code')
const byLower = new Map(fresh.map(c => [c.name.trim().toLowerCase(), c]))
const usedCodes = new Set(fresh.map(c => c.code).filter(Boolean))

let created = 0, coded = 0
for (const r of rows.slice(1)) {
  const name = typeof r[0] === 'string' ? r[0].trim() : null
  const code = typeof r[4] === 'string' ? r[4].trim() : null
  if (!name || !code || !/^Cl\d+$/i.test(code) || SKIP_TAB_NAMES.has(name)) continue
  const existing = byLower.get(name.toLowerCase())
  if (existing) {
    if (!existing.code && !usedCodes.has(code)) {
      await rest('PATCH', `clients?id=eq.${existing.id}`, { code })
      usedCodes.add(code)
      coded++
    }
  } else if (!usedCodes.has(code)) {
    await rest('POST', 'clients', { name, code })
    usedCodes.add(code)
    created++
    console.log(`created (no projects yet): ${name} ${code}`)
  }
}
console.log(`tab import: ${created} created, ${coded} codes filled`)

const final = await rest('GET', 'clients?select=name,code&order=name')
console.log(`\nFINAL ${final.length} clients:`)
for (const c of final) console.log(`${c.code ?? '------'}  ${c.name}`)

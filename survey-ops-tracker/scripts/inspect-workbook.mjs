// One-off: dump the structure of the Survey Ops workbook so we can see the new
// Compliance tab columns (and other tabs) without guessing. Read-only.
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node inspect-workbook.mjs "<path to .xlsx>"')
  process.exit(1)
}

// The CDN/ESM SheetJS build has no bound fs, so XLSX.readFile fails — read the
// bytes ourselves and parse the buffer (same as the app's extract-text.ts).
const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
console.log('SHEETS:', wb.SheetNames.join(' | '))
console.log('='.repeat(70))

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
  const headerIdx = rows.findIndex(r => r.some(c => String(c).trim() !== ''))
  const header = headerIdx >= 0 ? rows[headerIdx] : []
  console.log(`\n### ${name}  (${rows.length} rows)`)
  console.log('HEADERS:', JSON.stringify(header))
  // a few sample data rows after the header
  const sample = rows.slice(headerIdx + 1, headerIdx + 5)
  sample.forEach((r, i) => console.log(`row${i + 1}:`, JSON.stringify(r)))
}

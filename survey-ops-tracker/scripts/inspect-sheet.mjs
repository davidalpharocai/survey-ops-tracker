// Inspect the Survey Ops workbook: tab names, client-list tabs, and the
// survey_v2 formulas that pull client IDs.
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)
const dir = path.dirname(fileURLToPath(import.meta.url))
const wb = XLSX.readFile(path.join(dir, 'survey-ops.xlsx'), { cellFormula: true })

console.log('TABS:', wb.SheetNames.join(' | '))

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const ref = ws['!ref'] ?? '(empty)'
  console.log(`\n=== ${name} (${ref}) ===`)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  // headers + first 3 data rows, truncated cells
  rows.slice(0, 4).forEach((r, i) =>
    console.log(i, JSON.stringify(r.map(c => (typeof c === 'string' && c.length > 40 ? c.slice(0, 40) + '…' : c)).slice(0, 15)))
  )
  // formulas: show up to 5 unique formula cells per sheet
  const formulas = []
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue
    const cell = ws[addr]
    if (cell && cell.f) formulas.push(`${addr}: =${cell.f}`)
    if (formulas.length >= 5) break
  }
  if (formulas.length) console.log('FORMULAS:', formulas.join('\n  '))
}
